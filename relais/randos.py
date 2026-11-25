"""Prépare corse/randos.geojson à partir des GPX déposés dans corse/gpx/.

    python relais/randos.py            (depuis la racine du dépôt)

Pour chaque GPX, on calcule distance, dénivelés et altitudes extrêmes. Si un fichier « même-nom.komoot » est posé à
côté (une ligne : le numéro du tour Komoot, ou son adresse complète, éventuellement avec ?share_token=…), on demande
aussi à Komoot le type de chemin et la nature du sol le long du tracé. Un tour privé demande les identifiants Komoot,
passés par l'environnement (KOMOOT_EMAIL, KOMOOT_PASSWORD) et jamais écrits dans le dépôt. La réponse de Komoot est
gardée dans « même-nom.komoot.json » : on ne la redemande pas tant que ce fichier existe.

À défaut du détail le long du tracé, « même-nom.bilan.json » peut porter les totaux relevés sur la page Komoot du tour
({"chemin": [["Sentier de montagne", 77.9], …], "sol": [["Alpin", 66.3], …]}, en kilomètres) : la carte les montre en barres.

L'interface de Komoot n'est pas documentée publiquement : si elle change, la carte garde le GPX seul.
"""
import base64, glob, json, math, os, re, sys, urllib.request, xml.etree.ElementTree as ET

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
DOSSIER = os.path.join(RACINE, 'corse', 'gpx')
SORTIE = os.path.join(RACINE, 'corse', 'randos.geojson')
NS = {'g': 'http://www.topografix.com/GPX/1/1'}
API = 'https://api.komoot.de/v007/tours/{id}?_embedded=coordinates,way_types,surfaces&format=coordinate_array'


def dist(a, b):
    r = math.radians
    p1, p2, dp, dl = r(a[1]), r(b[1]), r(b[1] - a[1]), r(b[0] - a[0])
    return 2 * 6371000 * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def lire_gpx(chemin):
    root = ET.parse(chemin).getroot()
    nom = (root.findtext('.//g:trk/g:name', namespaces=NS) or root.findtext('.//g:metadata/g:name', namespaces=NS) or '').strip()
    t0 = root.findtext('.//g:trkpt/g:time', namespaces=NS)
    pts = [[float(p.get('lon')), float(p.get('lat')), float(p.findtext('g:ele', 'nan', NS))] for p in root.iterfind('.//g:trkpt', NS)]
    if not pts:   # un itinéraire (rte) plutôt qu'une trace
        pts = [[float(p.get('lon')), float(p.get('lat')), float(p.findtext('g:ele', 'nan', NS))] for p in root.iterfind('.//g:rtept', NS)]
    return nom, (t0[:10] if t0 else None), pts


def komoot(base):
    """Réponse de Komoot pour ce GPX : depuis le cache, sinon demandée (et mise en cache). None si rien."""
    cache, ref = base + '.komoot.json', base + '.komoot'
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    if not os.path.exists(ref):
        return None
    texte = open(ref, encoding='utf-8').read().strip()
    m = re.search(r'(\d{5,})', texte)
    if not m:
        print(f'  {os.path.basename(ref)} : pas de numéro de tour', file=sys.stderr)
        return None
    url = API.format(id=m.group(1))
    jeton = re.search(r'share_token=([\w-]+)', texte)
    if jeton:
        url += '&share_token=' + jeton.group(1)
    req = urllib.request.Request(url, headers={'Accept': 'application/hal+json', 'User-Agent': 'cartes-relais'})
    email, mdp = os.environ.get('KOMOOT_EMAIL'), os.environ.get('KOMOOT_PASSWORD')
    if email and mdp:
        req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{email}:{mdp}'.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.load(r)
    except Exception as e:
        print(f'  Komoot ne répond pas pour le tour {m.group(1)} ({e}) : GPX seul', file=sys.stderr)
        return None
    j = alleger(j)
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(j, f, ensure_ascii=False, separators=(',', ':'))
    return j


def alleger(j):
    """Ne garde de la réponse de Komoot que ce dont la carte se sert : ni profil du compte, ni liens, ni images."""
    emb = j.get('_embedded', {})
    return {'id': j.get('id'), 'name': j.get('name'), 'sport': j.get('sport'), 'difficulty': {'grade': (j.get('difficulty') or {}).get('grade')},
            '_embedded': {c: {'items': (emb.get(c) or {}).get('items') or []} for c in ('coordinates', 'way_types', 'surfaces')}}


def troncons(items, n):
    """[[début, fin, code], …] en indices de points, codes Komoot sans préfixe (wt#, sb#, sf#)."""
    out = []
    for it in items or []:
        a, b, code = it.get('from'), it.get('to'), str(it.get('element', ''))
        if a is None or b is None:
            continue
        out.append([max(0, int(a)), min(n - 1, int(b)), code.split('#', 1)[-1]])
    return out


features = []
for chemin in sorted(glob.glob(os.path.join(DOSSIER, '*.gpx'))):
    base = chemin[:-4]
    ident = os.path.basename(base)
    nom, date, pts = lire_gpx(chemin)
    props = {'id': ident, 'nom': nom or ident, 'date': date, 'source': 'GPX'}
    k = komoot(base)
    if k:
        emb = k.get('_embedded', {})
        coords = (emb.get('coordinates') or {}).get('items') or []
        if len(coords) > 1:
            pts = [[c['lng'], c['lat'], c.get('alt', float('nan'))] for c in coords]
        props.update({'source': 'Komoot', 'komoot': k.get('id'), 'nom': k.get('name') or props['nom'],
                      'sport': k.get('sport'), 'difficulte': (k.get('difficulty') or {}).get('grade')})
        props['chemin'] = troncons((emb.get('way_types') or {}).get('items'), len(pts))
        props['sol'] = troncons((emb.get('surfaces') or {}).get('items'), len(pts))
    if os.path.exists(base + '.bilan.json'):
        with open(base + '.bilan.json', encoding='utf-8') as f:
            props['bilan'] = json.load(f)
    if len(pts) < 2:
        continue
    for i, p in enumerate(pts):   # altitudes manquantes : celle du point précédent
        if p[2] != p[2]:
            p[2] = pts[i - 1][2] if i else next((q[2] for q in pts if q[2] == q[2]), 0)
    # dénivelés comptés au-delà de 3 m, comme le thème Itinéraire du socle, pour ne pas additionner le grain du relevé
    plus = moins = 0.0
    ref = pts[0][2]
    for p in pts:
        if p[2] - ref > 3: plus += p[2] - ref; ref = p[2]
        elif ref - p[2] > 3: moins += ref - p[2]; ref = p[2]
    props.update({'km': round(sum(dist(a, b) for a, b in zip(pts, pts[1:])) / 1000, 1), 'dplus': round(plus),
                  'dmoins': round(moins), 'altmax': round(max(p[2] for p in pts)), 'altmin': round(min(p[2] for p in pts))})
    features.append({'type': 'Feature', 'properties': props, 'geometry': {
        'type': 'LineString', 'coordinates': [[round(p[0], 5), round(p[1], 5), round(p[2])] for p in pts]}})
    print(f"  {ident} : {props['km']} km, +{props['dplus']} m, {props['source']}")

with open(SORTIE, 'w', encoding='utf-8') as f:
    f.write('{"type":"FeatureCollection","features":[\n' + ',\n'.join(json.dumps(ft, ensure_ascii=False, separators=(',', ':')) for ft in features) + '\n]}\n')
print(f'{len(features)} rando(s) -> corse/randos.geojson')
