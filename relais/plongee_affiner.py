"""Affine les aplats du thème « Fonds » d'une carte de plongée, sans rien retélécharger.

Deux défauts des données préparées par plongee_fonds.py :
  - les contours des herbiers (simplifiés à 5 m) sont anguleux, hérissés de pointes et criblés de petits trous ;
  - les aplats se recouvrent : l'herbier sur la roche, la roche sur le sable, et les couleurs se mélangent.

Ce script relit herbiers.json et fonds.json et les réécrit :
  - herbier vivant et matte morte : contours arrondis (fermeture puis ouverture de quelques mètres), trous de moins de
    TROU m² rebouchés, lambeaux de moins de MIETTE m² retirés ; la matte s'arrête où commence l'herbier vivant ;
  - natures de fond : dans l'ordre herbier, matte, roche, sable, vase, chaque aplat perd ce que les précédents couvrent
    déjà ; les éclats de moins de 2 m de large disparaissent. Chaque point du fond n'a plus qu'une seule couleur.

Arrondir ne rend pas la donnée plus exacte : le contour reste celui de l'inventaire, à quelques mètres près ; il est
seulement plus plausible à l'œil qu'une ligne brisée. Le script peut être relancé : un fichier déjà affiné change peu.

Usage : python3 relais/plongee_affiner.py [dossier de la carte, « plongee » par défaut]
"""
import json
import math
import os
import sys

import shapely
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union

SORTIE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), sys.argv[1] if len(sys.argv) > 1 else 'plongee')
FERME, OUVRE = 3.0, 2.5       # rayons (m) de la fermeture (rebouche les entailles) puis de l'ouverture (rabote les pointes)
TROU, MIETTE = 250.0, 120.0   # m² : trous rebouchés, lambeaux retirés
ECLAT = 1.0                   # m : demi-largeur des éclats retirés des natures de fond
FIN = 0.6                     # m : simplification finale


def polygones(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for q in getattr(g, 'geoms', []) for p in polygones(q)]


def arrondir(g):
    """Contour adouci : fermeture, ouverture, petits trous rebouchés, lambeaux retirés."""
    g = g.buffer(FERME, quad_segs=3).buffer(-FERME - OUVRE, quad_segs=3).buffer(OUVRE, quad_segs=3)
    out = []
    for p in polygones(g):
        if p.area < MIETTE:
            continue
        out.append(Polygon(p.exterior, [r for r in p.interiors if Polygon(r).area >= TROU]))
    return unary_union(out).simplify(FIN) if out else Polygon()


def main():
    fh, ff = os.path.join(SORTIE, 'herbiers.json'), os.path.join(SORTIE, 'fonds.json')
    fonds = json.load(open(ff))
    o, s, e, n = fonds['emprise']
    lat0 = (s + n) / 2
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
    metres = lambda g: shapely.transform(g, lambda c: c * [kx, ky])
    degres = lambda g: shapely.transform(g, lambda c: (c / [kx, ky]).round(6))
    aire = lambda g: sum(p.area for p in polygones(g))

    couvert = Polygon()
    if os.path.exists(fh):
        herb = json.load(open(fh))
        par = {f['properties']['k']: metres(shape(f['geometry']).buffer(0)) for f in herb['features']}
        vivant = arrondir(par.get('herbier', Polygon()))
        morte = arrondir(par.get('matte', Polygon())).difference(vivant).buffer(-ECLAT, quad_segs=2).buffer(ECLAT, quad_segs=2).simplify(FIN)
        for k, avant, apres in [('herbier', par.get('herbier'), vivant), ('matte', par.get('matte'), morte)]:
            if avant is not None:
                print(f'  {k} : {aire(avant) / 1e6:.2f} km² -> {aire(apres) / 1e6:.2f} km², {len(polygones(avant))} -> {len(polygones(apres))} polygones')
        out = []
        for k, g in [('herbier', vivant), ('matte', morte)]:
            ps = [p for p in polygones(degres(g)) if not p.is_empty]
            if ps:
                out.append({'type': 'Feature', 'properties': {'k': k}, 'geometry': mapping(MultiPolygon(ps))})
        json.dump({'type': 'FeatureCollection', 'features': out}, open(fh, 'w'), separators=(',', ':'))
        print('  herbiers.json :', os.path.getsize(fh) // 1024, 'ko')
        couvert = unary_union([vivant, morte])

    # Natures de fond : une seule couleur par endroit. La roche l'emporte sur le sable et la vase (c'est déjà la règle de
    # la carte quand on touche le fond) ; l'herbier et la matte l'emportent sur les trois.
    nat = [f for f in fonds['features'] if f['properties'].get('k') == 'nature']
    autres = [f for f in fonds['features'] if f['properties'].get('k') != 'nature']
    rang = {'roche': 0, 'sable': 1, 'vase': 2}
    nat.sort(key=lambda f: rang.get(f['properties'].get('m'), 3))      # tri stable : la roche d'abord, puis le sable, la vase
    geo = [metres(shape(f['geometry']).buffer(0)) for f in nat]
    neufs, avant, apres, pris = [], 0.0, 0.0, couvert
    for f, g in zip(nat, geo):
        avant += aire(g)
        # Ce qui est déjà couvert (herbier, matte, puis les natures passées avant) est retiré : aucun recouvrement ne reste.
        reste = g.difference(pris)
        pris = unary_union([pris, g])
        g = reste.buffer(-ECLAT, quad_segs=2).buffer(ECLAT, quad_segs=2).simplify(FIN)
        for p in polygones(degres(g)):
            if p.is_empty or p.area * kx * ky < 40:
                continue
            apres += p.area * kx * ky
            neufs.append({'type': 'Feature', 'properties': f['properties'], 'geometry': mapping(p)})
    fonds['features'] = neufs + autres
    json.dump(fonds, open(ff, 'w'), separators=(',', ':'))
    print(f'  natures de fond : {len(nat)} -> {len(neufs)} polygones, {avant / 1e6:.2f} -> {apres / 1e6:.2f} km² (recouvrements retirés)')
    print('  fonds.json :', os.path.getsize(ff) // 1024, 'ko')


if __name__ == '__main__':
    main()
