#!/usr/bin/env python3
"""Fonds de la carte Plongée (cap d'Antibes, golfe Juan, îles de Lérins) : un seul relief terre-mer, en tuiles.

Trois sources, assemblées sur une grille Mercator au pas du zoom 15 (4,78 m en Mercator, 3,5 m au sol ici) :
  1. Litto3D PACA 2015 (Shom, IGN ; Licence Ouverte 2.0) : MNT au mètre, terre et mer, lidar bathymétrique jusqu'à
     une quarantaine de mètres de fond selon la clarté de l'eau. Dalles prépaquetées du Shom, à télécharger (voir
     telecharger()) : environ 1 Go pour le secteur.
  2. Au-delà de ce que voit le lidar : le MNT de façade HOMONIM du Shom (maille de 100 m), relu sur sa palette de
     couleurs comme dans socle/fonds.js. Le raccord se fait en fondu sur 400 m, depuis le bord du Litto3D.
  3. À terre, au-delà du Litto3D : le RGE ALTI de l'IGN (Géoplateforme).
Altitudes en mètres (négatives sous l'eau), dans le système du Litto3D (IGN69, à quelques décimètres du zéro des
cartes en Méditerranée).

Produits (dans plongee/) :
  relief/{z}/{x}/{y}.png   relief terre-mer, tuiles « terrarium » de 512 points, zooms 10 à 14, au huitième de mètre ;
  fond/{z}/{x}/{y}.webp    le fond « vidé » : teinte du sédiment et ombrage, transparent à terre ;
  fonds.json               isobathes, secs, tombants, emprise du lidar, eau claire, épaves, obstructions et natures de
                           fond du Shom, masque terre-mer à 60 m, aire du fond par mètre de profondeur ;
  habitats.json            points d'habitat tous les 70 m (profondeur, milieu, pente), pour placer les poissons.
Un fichier plongee/herbiers.json (polygones d'herbiers, GeoJSON), s'il existe, est signalé dans fonds.json et la page
l'affiche en motif animé : la donnée de l'OFB reste à y verser.

Les épaves, obstructions et natures de fond se lisent une fois auprès du Shom (WFS) : epaves.json, obstructions.json et
ndf.json dans le dossier des données (voir sediments()).

Usage : python3 relais/plongee_fonds.py [dossier_des_donnees] [--refaire] [--tuiles] [--vecteurs] [--texture]
        (dossier par défaut : ../donnees à côté du dépôt ; sans option d'étape, tout est produit)
Dépendances : numpy, scipy, scikit-image, shapely, pyproj, py7zr, Pillow, matplotlib.
"""
import io, json, math, os, sys, glob, urllib.request
import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
DEPOT = os.path.dirname(ICI)
DONNEES = next((a for a in sys.argv[1:] if not a.startswith('--')), None) or os.path.join(os.path.dirname(DEPOT), 'donnees')
SORTIE = os.path.join(DEPOT, 'plongee')

# Emprise du secteur (degrés) : de la pointe de la Croisette au cap d'Antibes, Lérins et le large jusqu'au canyon.
OUEST, SUD, EST, NORD = 6.905, 43.455, 7.165, 43.598
ZMAX, ZMIN = 15, 10
R = 20037508.342789244
TAILLE = 2 * R / (256 << ZMAX)          # pas de la grille au zoom 15, en mètres Mercator
PACKS = ['1015_6275', '1015_6280', '1015_6285', '1020_6275', '1020_6280', '1020_6285', '1025_6275', '1025_6280',
         '1025_6285', '1025_6290', '1030_6280', '1030_6285', '1030_6290', '1035_6285']
URL_PACK = 'https://services.data.shom.fr/INSPIRE/telechargement/prepackageGroup/LITTO3D_PACA_2015_PACK_DL/prepackage/{0}/file/{0}.7z'
SHOM_WMS = 'https://services.data.shom.fr/INSPIRE/wms/r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857'
SHOM_WFS = 'https://services.data.shom.fr/INSPIRE/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&OUTPUTFORMAT=application/json'
IGN_WMS = 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&FORMAT=image/x-bil;bits=32&CRS=EPSG:3857'


def merc(lon, lat):
    return lon * R / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * R / math.pi


def geo(x, y):
    return x * 180 / R, math.atan(math.exp(y * math.pi / R)) * 360 / math.pi - 90


def lire_url(url, essais=3):
    for k in range(essais):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return r.read()
        except Exception:
            if k == essais - 1:
                raise


# ---------- Grille Mercator alignée sur les tuiles du zoom 15 ----------
x0, y1 = merc(OUEST, NORD)
x1, y0 = merc(EST, SUD)
TX0, TY0 = int((x0 + R) // (TAILLE * 256)), int((R - y1) // (TAILLE * 256))
TX1, TY1 = int((x1 + R) // (TAILLE * 256)), int((R - y0) // (TAILLE * 256))
GX0, GY1 = -R + TX0 * 256 * TAILLE, R - TY0 * 256 * TAILLE      # coin nord-ouest de la grille
W, H = (TX1 - TX0 + 1) * 256, (TY1 - TY0 + 1) * 256
print(f'Grille : {W} × {H} points, tuiles z15 x {TX0}-{TX1}, y {TY0}-{TY1}')
XS = GX0 + (np.arange(W) + 0.5) * TAILLE
YS = GY1 - (np.arange(H) + 0.5) * TAILLE


def telecharger():
    os.makedirs(os.path.join(DONNEES, 'l3d'), exist_ok=True)
    for p in PACKS:
        f = os.path.join(DONNEES, 'l3d', p + '.7z')
        if not os.path.exists(f):
            print('Téléchargement', p)
            open(f, 'wb').write(lire_url(URL_PACK.format(p)))


def sediments():
    """Épaves, obstructions et natures de fond au 1/50 000 du Shom sur l'emprise, lues une fois par le WFS."""
    bx0, by0 = merc(OUEST, SUD)
    bx1, by1 = merc(EST, NORD)
    for couche, nom in [('EPAVES_BDD_WFS:wrecks', 'epaves.json'), ('EPAVES_BDD_WFS:obstrn', 'obstructions.json'), ('NDF_BDD_WLD_WGS84G_WFS:natures_fond_50000', 'ndf.json')]:
        f = os.path.join(DONNEES, nom)
        if not os.path.exists(f):
            open(f, 'wb').write(lire_url(f'{SHOM_WFS}&SRSNAME=EPSG:4326&TYPENAMES={couche}&BBOX={bx0},{by0},{bx1},{by1},EPSG:3857'))


def litto3d():
    """Mosaïque Lambert-93 au pas de 2 m (moyenne des points du MNT au mètre), puis relue sur la grille Mercator."""
    cache = os.path.join(DONNEES, 'l3d_merc.npy')
    if os.path.exists(cache):
        return np.load(cache)
    import py7zr
    from pyproj import Transformer
    LX0, LY0, PAS = 1014000, 6266000, 2.0
    LW, LH = int(25000 / PAS), int(22000 / PAS)
    som = np.zeros((LH, LW), np.float32)
    nb = np.zeros((LH, LW), np.uint8)
    for p in PACKS:
        f = os.path.join(DONNEES, 'l3d', p + '.7z')
        if not os.path.exists(f):
            print('  manque', p)
            continue
        import shutil, tempfile
        tmp = tempfile.mkdtemp(dir=DONNEES)
        with py7zr.SevenZipFile(f) as z:
            cibles = [n for n in z.getnames() if n.endswith('.asc') and '/MNT1m/' in n]
        with py7zr.SevenZipFile(f) as z:
            z.extract(path=tmp, targets=cibles)
        lus = {n: os.path.join(tmp, n) for n in cibles}
        for n, chemin in lus.items():
            txt = open(chemin, 'rb').read()
            tete, corps = txt.split(b'nodata_value', 1)
            entete = dict(l.split() for l in tete.decode().strip().splitlines())
            corps = corps.split(b'\n', 1)[1]
            nc, nr = int(entete['ncols']), int(entete['nrows'])
            a = np.fromstring(corps, dtype=np.float32, sep=' ')
            if a.size != nc * nr:
                print('  dalle incomplète', n)
                continue
            a = a.reshape(nr, nc)
            xll, yll = float(entete['xllcenter']), float(entete['yllcenter'])
            # Agrégation 2 × 2 : ligne 0 = nord.
            a = a[: nr // 2 * 2, : nc // 2 * 2].reshape(nr // 2, 2, nc // 2, 2)
            ok = (a > -9000)
            s = np.where(ok, a, 0).sum(axis=(1, 3))
            c = ok.sum(axis=(1, 3))
            m = c > 0
            moy = np.where(m, s / np.maximum(c, 1), 0).astype(np.float32)
            nord = yll + (nr - 1)   # centre de la ligne du haut
            i0 = int(round((xll - LX0) / PAS))
            j0 = int(round((LY0 + LH * PAS - nord - 0.5) / PAS))
            hh, ww = moy.shape
            if i0 < 0 or j0 < 0 or i0 + ww > LW or j0 + hh > LH:
                ii0, jj0 = max(0, i0), max(0, j0)
                ii1, jj1 = min(LW, i0 + ww), min(LH, j0 + hh)
                if ii1 <= ii0 or jj1 <= jj0:
                    continue
                moy = moy[jj0 - j0: jj1 - j0, ii0 - i0: ii1 - i0]
                m = m[jj0 - j0: jj1 - j0, ii0 - i0: ii1 - i0]
                i0, j0, hh, ww = ii0, jj0, jj1 - jj0, ii1 - ii0
            som[j0:j0 + hh, i0:i0 + ww] += np.where(m, moy, 0)
            nb[j0:j0 + hh, i0:i0 + ww] += m.astype(np.uint8)
        shutil.rmtree(tmp, ignore_errors=True)
        print('  lu', p, len(lus), 'dalles')
    mos = np.where(nb > 0, som / np.maximum(nb, 1), np.nan).astype(np.float32)
    del som, nb
    t = Transformer.from_crs(3857, 2154, always_xy=True)
    out = np.full((H, W), np.nan, np.float32)
    for j in range(0, H, 256):
        xx, yy = np.meshgrid(XS, YS[j:j + 256])
        lx, ly = t.transform(xx, yy)
        fi = (lx - LX0) / PAS - 0.5
        fj = (LY0 + LH * PAS - ly) / PAS - 0.5
        i = np.floor(fi).astype(int)
        jj = np.floor(fj).astype(int)
        u, v = fi - i, fj - jj
        ok = (i >= 0) & (jj >= 0) & (i < LW - 1) & (jj < LH - 1)
        i, jj = np.clip(i, 0, LW - 2), np.clip(jj, 0, LH - 2)
        a, b, c, d = mos[jj, i], mos[jj, i + 1], mos[jj + 1, i], mos[jj + 1, i + 1]
        val = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
        # Un voisin manquant : on prend le plus proche plutôt que de perdre le point.
        proche = np.where(u < 0.5, np.where(v < 0.5, a, c), np.where(v < 0.5, b, d))
        val = np.where(np.isnan(val), proche, val)
        out[j:j + 256] = np.where(ok, val, np.nan)
    np.save(cache, out)
    return out


PALETTE = [[50, 239, 236, 231], [20, 221, 220, 200], [0, 169, 170, 128], [-15, 155, 46, 30], [-30, 248, 214, 22], [-40, 0, 128, 64], [-100, 97, 224, 224],
           [-125, 49, 208, 242], [-150, 3, 151, 222], [-1000, 14, 112, 192], [-3000, 9, 63, 206], [-4000, 0, 0, 176], [-4850, 71, 52, 150]]


def homonim():
    """MNT de façade HOMONIM (100 m), relu sur sa palette, puis lissé et ramené sur la grille."""
    cache = os.path.join(DONNEES, 'homonim_merc.npy')
    if os.path.exists(cache):
        return np.load(cache)
    from scipy.ndimage import zoom as agrandir, gaussian_filter
    f = 20   # un point HOMONIM lu tous les 20 points de grille (96 m)
    w, h = W // f, H // f
    url = f'{SHOM_WMS}&LAYERS=MNT_MED100m_GDL_CA_HOMONIM_PBMA_3857_WMSR&BBOX={GX0},{GY1 - H * TAILLE},{GX0 + W * TAILLE},{GY1}&WIDTH={w}&HEIGHT={h}'
    im = np.asarray(Image.open(io.BytesIO(lire_url(url))).convert('RGBA')).astype(np.float32)
    P = np.array(PALETTE, np.float32)
    rgb = im[..., :3].reshape(-1, 3)
    mieux = np.full(rgb.shape[0], np.inf, np.float32)
    alt = np.full(rgb.shape[0], np.nan, np.float32)
    for k in range(len(P) - 1):
        a, c = P[k], P[k + 1]
        v = c[1:] - a[1:]
        t = np.clip(((rgb - a[1:]) @ v) / (v @ v), 0, 1)
        e = np.linalg.norm(a[1:] + t[:, None] * v - rgb, axis=1)
        m = e < mieux
        mieux[m] = e[m]
        alt[m] = (a[0] + t * (c[0] - a[0]))[m]
    alt[im[..., 3].reshape(-1) < 200] = np.nan
    alt = alt.reshape(h, w)
    alt = np.where(alt < 0, alt, np.nan)
    # Trous (terre) : remplis par la profondeur voisine, pour un lissage sans bord.
    from scipy.ndimage import distance_transform_edt
    trou = np.isnan(alt)
    idx = distance_transform_edt(trou, return_distances=False, return_indices=True)
    plein = alt[tuple(idx)]
    plein = gaussian_filter(plein, 1.3)
    plein = np.where(plein < -150, gaussian_filter(plein, 2.5), plein)
    out = agrandir(plein, (H / h, W / w), order=3)[:H, :W].astype(np.float32)
    if out.shape != (H, W):
        out = np.pad(out, ((0, H - out.shape[0]), (0, W - out.shape[1])), mode='edge')
    out[out > -0.5] = -0.5
    np.save(cache, out)
    return out


def rgealti():
    """RGE ALTI de l'IGN (à terre), lu par blocs de 2 048 points au pas de la grille."""
    cache = os.path.join(DONNEES, 'rgealti_merc.npy')
    if os.path.exists(cache):
        return np.load(cache)
    out = np.full((H, W), np.nan, np.float32)
    B = 2048
    for j in range(0, H, B):
        for i in range(0, W, B):
            w, h = min(B, W - i), min(B, H - j)
            bx0, by1 = GX0 + i * TAILLE, GY1 - j * TAILLE
            url = f'{IGN_WMS}&BBOX={bx0},{by1 - h * TAILLE},{bx0 + w * TAILLE},{by1}&WIDTH={w}&HEIGHT={h}'
            a = np.frombuffer(lire_url(url), dtype='<f4').reshape(h, w)
            out[j:j + h, i:i + w] = np.where((a > -500) & (a < 9000), a, np.nan)
            print('  RGE ALTI', j, i)
    np.save(cache, out)
    return out


def assembler():
    from scipy.ndimage import distance_transform_edt, gaussian_filter, binary_opening
    l3d = litto3d()
    hom = homonim()
    rge = rgealti()
    print('Litto3D valide :', np.isfinite(l3d).mean())
    # À terre hors Litto3D : RGE ALTI. En mer hors Litto3D : HOMONIM, fondu avec le bord du lidar.
    lidar = np.isfinite(l3d)
    lidar = binary_opening(lidar, iterations=2)
    terre = np.isfinite(rge) & (rge > 0.3)
    d = distance_transform_edt(~lidar) * TAILLE * 0.725          # distance au sol, en mètres
    idx = distance_transform_edt(~lidar, return_distances=False, return_indices=True)
    bord = l3d[tuple(idx)]                                       # valeur du lidar la plus proche
    # Écart entre le bord du lidar et HOMONIM, étalé en douceur : il s'efface en 400 m.
    ecart = np.where(np.isfinite(bord), bord - hom, 0)
    ecart = gaussian_filter(ecart, 25)
    poids = np.clip(d / 400, 0, 1)
    mer = hom + ecart * (1 - poids)
    mer = np.minimum(mer, -0.3)
    z = np.where(lidar, l3d, np.where(terre, rge, mer)).astype(np.float32)
    # Raccord terre (RGE ALTI) / mer (HOMONIM) hors lidar : pas de marche sous le trait de côte.
    z = np.where(np.isfinite(z), z, mer)
    source = np.where(lidar, 1, np.where(terre, 3, 2)).astype(np.uint8)
    return z, source


def terrarium(a):
    v = np.clip(a, -11000, 8000) + 32768
    v = np.round(v * 8) / 8
    r = np.floor(v / 256)
    g = np.floor(v) - r * 256
    b = (v - np.floor(v)) * 256
    return np.dstack([r, g, b]).astype(np.uint8)


def pyramide(grille, dossier, ecrire, taille=512, combler=None):
    """Pyramide de tuiles de `taille` points. La grille est au pas du zoom 15 en tuiles de 256, soit du zoom 14 en
    tuiles de 512 ; chaque niveau est la moyenne 2 × 2 du niveau au-dessus, recalée sur la grille des tuiles.
    ecrire(bloc, chemin) écrit une tuile ; combler(bloc, vide, z, x, y) remplit ce qui sort du secteur."""
    import warnings
    racine = os.path.join(SORTIE, dossier)
    zhaut = ZMAX - int(round(math.log2(taille / 256)))
    liste = {}
    niv, gx0, gy0 = grille, TX0 * 256, TY0 * 256
    for zz in range(zhaut, ZMIN - 1, -1):
        px, py = gx0 % taille, gy0 % taille
        hh, ww = niv.shape[:2]
        pad = ((py, (-(hh + py)) % taille), (px, (-(ww + px)) % taille)) + (((0, 0),) if niv.ndim == 3 else ())
        a = np.pad(niv, pad, constant_values=np.nan)
        tx0, ty0 = (gx0 - px) // taille, (gy0 - py) // taille
        n = 0
        for j in range(a.shape[0] // taille):
            for i in range(a.shape[1] // taille):
                bloc = a[j * taille:(j + 1) * taille, i * taille:(i + 1) * taille]
                vide = np.isnan(bloc) if bloc.ndim == 2 else np.isnan(bloc[..., 0])
                if vide.all():
                    continue
                if vide.any() and combler:
                    bloc = combler(bloc.copy(), vide, zz, tx0 + i, ty0 + j)
                d = os.path.join(racine, str(zz), str(tx0 + i))
                os.makedirs(d, exist_ok=True)
                ecrire(bloc, os.path.join(d, str(ty0 + j)))
                n += 1
        liste[zz] = [tx0, tx0 + a.shape[1] // taille - 1, ty0, ty0 + a.shape[0] // taille - 1]
        print(f'  {dossier} zoom {zz} : {n} tuiles')
        qx, qy = gx0 % 2, gy0 % 2
        pad = ((qy, (hh + qy) % 2), (qx, (ww + qx) % 2)) + (((0, 0),) if niv.ndim == 3 else ())
        b = np.pad(niv, pad, constant_values=np.nan)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            niv = np.nanmean(b.reshape(b.shape[0] // 2, 2, b.shape[1] // 2, 2, *b.shape[2:]), axis=(1, 3)).astype(np.float32)
        gx0, gy0 = (gx0 - qx) // 2, (gy0 - qy) // 2
    json.dump({'emprise': [OUEST, SUD, EST, NORD], 'taille': taille, 'tuiles': liste}, open(os.path.join(racine, 'index.json'), 'w'))
    return liste


def monde(z, x, y, taille):
    """Relief mondial (tuiles « terrarium » d'AWS, zoom 15 au plus) recomposé en une tuile de `taille` points."""
    k = taille // 256
    out = np.zeros((taille, taille), np.float32)
    for dj in range(k):
        for di in range(k):
            zz, xx, yy = z + int(math.log2(k)), x * k + di, y * k + dj
            m = np.asarray(Image.open(io.BytesIO(lire_url(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zz}/{xx}/{yy}.png'))).convert('RGB')).astype(np.float32)
            out[dj * 256:(dj + 1) * 256, di * 256:(di + 1) * 256] = m[..., 0] * 256 + m[..., 1] + m[..., 2] / 256 - 32768
    return out


def tuiles(z):
    """Relief : tuiles « terrarium » de 512 points, au huitième de mètre ; hors du secteur, le relief mondial."""
    from scipy.ndimage import distance_transform_edt

    def combler(bloc, vide, zz, x, y):
        try:
            return np.where(vide, monde(zz, x, y, 512), bloc)
        except Exception:
            idx = distance_transform_edt(vide, return_distances=False, return_indices=True)
            return bloc[tuple(idx)]
    pyramide(z, 'relief', lambda b, f: Image.fromarray(terrarium(b)).save(f + '.png', optimize=True), 512, combler)


MILIEUX = {   # natures de fond du Shom regroupées en trois milieux, pour la carte et pour les poissons
    'roche': ['NFRoche', 'NFC', 'NFCG', 'NFCS', 'NFCV', 'NFCo'],
    'sable': ['NFG', 'NFGC', 'NFGS', 'NFGSV', 'NFGV', 'NFS', 'NFSC', 'NFSG', 'NFSGV', 'NFSV', 'NFSF', 'NFSFC', 'NFSFG', 'NFSFSi', 'NFSFV', 'NFSSi'],
    'vase': ['NFV', 'NFVC', 'NFVG', 'NFVSG', 'NFVS', 'NFVSF', 'NFSi', 'NFSiA', 'NFA', 'NFASi']}
LIBELLES = {'NFRoche': 'Roche', 'NFCo': 'Corail', 'NFC': 'Cailloutis', 'NFCG': 'Cailloutis et graviers', 'NFCS': 'Cailloutis et sables', 'NFCV': 'Cailloutis envasés',
    'NFG': 'Graviers', 'NFGC': 'Graviers et cailloutis', 'NFGS': 'Graviers et sables', 'NFGSV': 'Graviers et sables envasés', 'NFGV': 'Graviers envasés',
    'NFS': 'Sables', 'NFSC': 'Sables et cailloutis', 'NFSG': 'Sables et graviers', 'NFSGV': 'Sables et graviers envasés', 'NFSV': 'Sables vaseux',
    'NFSSi': 'Sables et silts', 'NFSF': 'Sables fins', 'NFSFC': 'Sables fins et cailloutis', 'NFSFG': 'Sables fins et graviers', 'NFSFSi': 'Sables fins et silts',
    'NFSFV': 'Sables fins vaseux', 'NFSi': 'Silts', 'NFSiA': 'Silts argileux', 'NFA': 'Argiles', 'NFASi': 'Argiles silteuses', 'NFV': 'Vases',
    'NFVC': 'Vases et cailloutis', 'NFVG': 'Vases et graviers', 'NFVSG': 'Vases, sables et graviers', 'NFVS': 'Vases sableuses', 'NFVSF': 'Vases et sables fins'}


def vecteurs(z, source):
    """Isobathes, secs, tombants, emprise du lidar, épaves, obstructions et natures de fond, dans plongee/fonds.json."""
    from scipy.ndimage import gaussian_filter, maximum_filter, minimum_filter, label, binary_closing, binary_opening, distance_transform_edt
    from skimage.measure import find_contours
    from shapely.geometry import LineString, Polygon, shape, mapping
    from shapely.ops import unary_union
    PAS_SOL = TAILLE * 0.7253                      # mètres au sol par point de grille (cos 43,5°)
    ronde = lambda v: round(v, 5)

    def versgeo(lignes, f):
        out = []
        for l in lignes:
            pts = [geo(GX0 + (c + 0.5) * f * TAILLE, GY1 - (r + 0.5) * f * TAILLE) for r, c in l]
            out.append([[ronde(a), ronde(b)] for a, b in pts])
        return out

    feats = []
    # --- Isobathes, sur la grille réduite de moitié (9,5 m) et lissée ; simplifiées à 4 m près. ---
    f = 2
    zr = z[: z.shape[0] // f * f, : z.shape[1] // f * f].reshape(z.shape[0] // f, f, z.shape[1] // f, f).mean(axis=(1, 3))
    zl = gaussian_filter(zr, 1.2)
    for p in [3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300, 500, 1000]:
        for c in find_contours(zl, -p):
            if len(c) < 8:
                continue
            ls = LineString(c[:, ::-1]).simplify(4 / (PAS_SOL * f))
            if ls.length * PAS_SOL * f < 80:
                continue
            l = versgeo([[(y, x) for x, y in ls.coords]], f)[0]
            feats.append({'type': 'Feature', 'properties': {'k': 'iso', 'p': p}, 'geometry': {'type': 'LineString', 'coordinates': l}})
    print('  isobathes :', sum(1 for x in feats if x['properties']['k'] == 'iso'))

    # --- Secs : sommets sous l'eau qui dominent leurs alentours d'au moins 4 m, entre 2 et 60 m de fond. ---
    zs = gaussian_filter(zr, 1.5)
    rayon = int(round(60 / (PAS_SOL * f)))
    loc = (zs == maximum_filter(zs, size=2 * rayon + 1)) & (zs < -2) & (zs > -60)
    bas = minimum_filter(zs, size=4 * rayon + 1)
    terre = zr > 0
    dist_terre = distance_transform_edt(~terre) * PAS_SOL * f
    secs = []
    js, is_ = np.nonzero(loc)
    for j, i in zip(js, is_):
        drop = zs[j, i] - bas[j, i]
        if drop < 4 or dist_terre[j, i] < 60 or source[min(H - 1, j * f), min(W - 1, i * f)] != 1:
            continue
        lon, lat = geo(GX0 + (i + 0.5) * f * TAILLE, GY1 - (j + 0.5) * f * TAILLE)
        secs.append((drop, lon, lat, -float(zr[j, i])))
    secs.sort(reverse=True)
    garde = []
    for d, lon, lat, prof in secs:
        if all(math.hypot((lon - a) * 0.725, lat - b) * 111200 > 250 for _, a, b, _ in garde):
            garde.append((d, lon, lat, prof))
    for d, lon, lat, prof in garde[:80]:
        feats.append({'type': 'Feature', 'properties': {'k': 'sec', 'p': round(prof, 1), 'h': round(float(d), 1)}, 'geometry': {'type': 'Point', 'coordinates': [ronde(lon), ronde(lat)]}})
    print('  secs :', len(garde[:80]))

    # --- Tombants : pente de plus de 30° sous l'eau, sur au moins 4 m de dénivelé, dans la zone du lidar. ---
    gy, gx = np.gradient(gaussian_filter(zr, 0.8), PAS_SOL * f)
    pente = np.degrees(np.arctan(np.hypot(gx, gy)))
    lid = source[: z.shape[0] // f * f: f, : z.shape[1] // f * f: f] == 1
    raide = (pente > 30) & (zr < -3) & lid
    raide = binary_opening(binary_closing(raide, iterations=2), iterations=1)
    lab, n = label(raide)
    nb_t = 0
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() * (PAS_SOL * f) ** 2 < 400:
            continue
        haut, bas_ = zr[m].max(), zr[m].min()
        if haut - bas_ < 4:
            continue
        for c in find_contours(np.pad(m, 1).astype(float), 0.5):
            if len(c) < 6:
                continue
            pg = Polygon((c - 1)[:, ::-1]).simplify(3 / (PAS_SOL * f))
            if pg.is_empty or pg.area * (PAS_SOL * f) ** 2 < 300:
                continue
            l = versgeo([[(y, x) for x, y in pg.exterior.coords]], f)[0]
            feats.append({'type': 'Feature', 'properties': {'k': 'tombant', 'haut': round(-float(haut), 1), 'bas': round(-float(bas_), 1)}, 'geometry': {'type': 'Polygon', 'coordinates': [l]}})
            nb_t += 1
    print('  tombants :', nb_t)

    # --- Emprise du lidar (en mer) : là où le fond est relevé au mètre. ---
    f4 = 8
    sl = source[: source.shape[0] // f4 * f4: f4, : source.shape[1] // f4 * f4: f4] == 1
    sl = binary_closing(sl, iterations=2)
    for c in find_contours(np.pad(sl, 1).astype(float), 0.5):
        pg = Polygon((c - 1)[:, ::-1]).simplify(1.5)
        if pg.area < 30:
            continue
        l = versgeo([[(y, x) for x, y in pg.exterior.coords]], f4)[0]
        feats.append({'type': 'Feature', 'properties': {'k': 'lidar'}, 'geometry': {'type': 'Polygon', 'coordinates': [l]}})

    # --- Épaves et obstructions (Shom, CC BY-SA 4.0), natures de fond (Shom, Licence Ouverte). ---
    for nom, k in [('epaves.json', 'epave'), ('obstructions.json', 'obstruction')]:
        for e in json.load(open(os.path.join(DONNEES, nom)))['features']:
            pr = e['properties']
            q = {'k': k, 'nom': pr.get('nom'), 'type': pr.get('type_obj'), 'note': pr.get('caract_obj'), 'circ': pr.get('circ_nauf'),
                 'brassiage': pr.get('brassiage'), 'precis': pr.get('precis_loc'), 'id': pr.get('inspireid')}
            lon, lat = e['geometry']['coordinates'][:2]
            i = int((merc(lon, lat)[0] - GX0) / TAILLE); j = int((GY1 - merc(lon, lat)[1]) / TAILLE)
            if 0 <= i < W and 0 <= j < H:
                q['fond'] = round(-float(z[j, i]), 1)
            feats.append({'type': 'Feature', 'properties': {a: b for a, b in q.items() if b not in (None, '')}, 'geometry': {'type': 'Point', 'coordinates': [ronde(lon), ronde(lat)]}})
    cadre = Polygon([(OUEST, SUD), (EST, SUD), (EST, NORD), (OUEST, NORD)])
    nb_n = 0
    for e in json.load(open(os.path.join(DONNEES, 'ndf.json')))['features']:
        t = e['properties']['typelem']
        mil = next((m for m, l in MILIEUX.items() if t in l), None)
        if not mil:
            continue
        g = shape(e['geometry']).buffer(0).intersection(cadre).simplify(0.00006)
        if g.is_empty:
            continue
        gj = mapping(g)
        arr = lambda c: [[ronde(x), ronde(y)] for x, y in c]
        if gj['type'] == 'Polygon':
            coords = [arr(r) for r in gj['coordinates']]
        elif gj['type'] == 'MultiPolygon':
            coords = [[arr(r) for r in p] for p in gj['coordinates']]
        else:
            continue
        feats.append({'type': 'Feature', 'properties': {'k': 'nature', 'm': mil, 't': LIBELLES.get(t, t)}, 'geometry': {'type': gj['type'], 'coordinates': coords}})
        nb_n += 1
    print('  natures de fond :', nb_n)
    # --- Eau claire (moins de 10 m) : là où la lumière danse sur le fond. ---
    clair = gaussian_filter(zr, 1.5)
    m = (clair < -0.3) & (clair > -10)
    m = binary_opening(m, iterations=1)
    for c in find_contours(np.pad(m, 1).astype(float), 0.5):
        if len(c) < 10:
            continue
        pg = Polygon((c - 1)[:, ::-1]).simplify(2.5)
        if pg.is_empty or pg.area * (PAS_SOL * f) ** 2 < 2000:
            continue
        l = versgeo([[(y, x) for x, y in pg.exterior.coords]], f)[0]
        feats.append({'type': 'Feature', 'properties': {'k': 'clair'}, 'geometry': {'type': 'Polygon', 'coordinates': [l]}})
    # --- Masque terre / mer à 60 m (un bit par maille), pour le calcul de l'abri à la houle dans la page. ---
    import base64
    fm = int(round(60 / PAS_SOL))
    hm, wm = z.shape[0] // fm, z.shape[1] // fm
    zm = z[: hm * fm, : wm * fm].reshape(hm, fm, wm, fm).mean(axis=(1, 3))
    bits = np.packbits((zm > 0).astype(np.uint8).ravel())
    mo, mn = geo(GX0, GY1)
    me, ms = geo(GX0 + wm * fm * TAILLE, GY1 - hm * fm * TAILLE)
    masque = {'w': wm, 'h': hm, 'bornes': [round(mo, 6), round(ms, 6), round(me, 6), round(mn, 6)], 'bits': base64.b64encode(bits.tobytes()).decode()}
    # --- Aire du fond par mètre de profondeur (zone du lidar) : ce que découvre la mer qui baisse. ---
    zl_ = z[source == 1]
    aires = np.histogram(-zl_[(zl_ < 0) & (zl_ > -100)], bins=100, range=(0, 100))[0] * (PAS_SOL ** 2) / 1e6
    out = {'type': 'FeatureCollection', 'emprise': [OUEST, SUD, EST, NORD], 'herbiers': os.path.exists(os.path.join(SORTIE, 'herbiers.json')), 'masque': masque, 'aires': [round(float(a), 4) for a in aires], 'features': feats}
    json.dump(out, open(os.path.join(SORTIE, 'fonds.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('  fonds.json :', os.path.getsize(os.path.join(SORTIE, 'fonds.json')) // 1024, 'ko')

    # --- Points d'habitat pour les poissons : tous les 70 m, profondeur, milieu, pente (fichier compact). ---
    from matplotlib.path import Path as Chemin
    pas = int(round(70 / PAS_SOL))
    jj, ii = np.mgrid[pas // 2: H: pas, pas // 2: W: pas]
    zz = z[jj, ii]
    ok = (zz < -1) & (zz > -70) & (source[jj, ii] == 1)
    jj, ii, zz = jj[ok], ii[ok], zz[ok]
    lon = np.array([geo(GX0 + (i + 0.5) * TAILLE, 0)[0] for i in ii])
    lat = np.array([geo(0, GY1 - (j + 0.5) * TAILLE)[1] for j in jj])
    mil = np.zeros(len(lon), np.uint8)     # 0 inconnu, 1 roche, 2 sable, 3 vase
    for e in feats:
        if e['properties']['k'] != 'nature':
            continue
        code = {'roche': 1, 'sable': 2, 'vase': 3}[e['properties']['m']]
        polys = [e['geometry']['coordinates']] if e['geometry']['type'] == 'Polygon' else e['geometry']['coordinates']
        for pl in polys:
            dedans = Chemin(pl[0]).contains_points(np.c_[lon, lat])
            for trou in pl[1:]:
                dedans &= ~Chemin(trou).contains_points(np.c_[lon, lat])
            mil[dedans] = code
    pte = np.degrees(np.arctan(np.hypot(*np.gradient(gaussian_filter(z, 2), TAILLE * 0.7253))))[jj, ii]
    pts = [[round(float(a), 5), round(float(b), 5), round(-float(c), 1), int(m), int(min(89, t))] for a, b, c, m, t in zip(lon, lat, zz, mil, pte)]
    json.dump(pts, open(os.path.join(SORTIE, 'habitats.json'), 'w'), separators=(',', ':'))
    print('  habitats.json :', len(pts), 'points,', os.path.getsize(os.path.join(SORTIE, 'habitats.json')) // 1024, 'ko')


def milieux_grille():
    """Natures de fond du Shom rastérisées sur la grille : 0 inconnu, 1 roche, 2 sable, 3 vase."""
    from PIL import ImageDraw
    im = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(im)
    code = {'roche': 1, 'sable': 2, 'vase': 3}
    px = lambda lon, lat: ((merc(lon, lat)[0] - GX0) / TAILLE, (GY1 - merc(lon, lat)[1]) / TAILLE)
    feats = json.load(open(os.path.join(DONNEES, 'ndf.json')))['features']
    # Le sable d'abord, la roche par-dessus : un pointement rocheux dans le sable reste visible.
    ordre = sorted(feats, key=lambda e: {'vase': 0, 'sable': 1, 'roche': 2}.get(next((m for m, l in MILIEUX.items() if e['properties']['typelem'] in l), ''), -1))
    for e in ordre:
        mil = next((m for m, l in MILIEUX.items() if e['properties']['typelem'] in l), None)
        if not mil:
            continue
        g = e['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for pl in polys:
            dr.polygon([px(*c[:2]) for c in pl[0]], fill=code[mil])
            for trou in pl[1:]:
                dr.polygon([px(*c[:2]) for c in trou], fill=0)
    return np.asarray(im)


def texture(z, source):
    """Le fond « vidé » : teinte du sédiment (sable, roche, vase), ombrage multidirectionnel, creux assombris, fonds
    lointains assombris. Transparent à terre. Calcul par bandes (la grille entière ne tient pas en mémoire d'un coup)."""
    from scipy.ndimage import gaussian_filter, zoom as agrandir
    PAS = TAILLE * 0.7253
    mil = milieux_grille()
    rng = np.random.default_rng(7)
    bruit = np.zeros(z.shape, np.float32)
    for echelle, poids in [(64, 0.5), (16, 0.3), (4, 0.2)]:
        b = rng.standard_normal((z.shape[0] // echelle + 2, z.shape[1] // echelle + 2)).astype(np.float32)
        bruit += (poids * agrandir(b, echelle, order=3)[: z.shape[0], : z.shape[1]]).astype(np.float32)
    hors_tout = gaussian_filter((source == 2).astype(np.float32), 12)
    sable, roche, vase = np.array([226, 211, 176], np.float32), np.array([168, 154, 134], np.float32), np.array([176, 170, 144], np.float32)
    inconnu = np.array([208, 194, 162], np.float32)
    # Les limites de la carte des sédiments (1/50 000) sont floues sur le terrain : on fond les milieux sur 25 m environ.
    poids_mil = [gaussian_filter((mil == k).astype(np.float32), 7) for k in range(4)]

    def ombre(zz, fz):
        gy, gx = np.gradient(zz * fz, PAS)
        pente = np.arctan(np.hypot(gx, gy))
        aspect = np.arctan2(-gx, gy)
        tot = np.zeros(zz.shape, np.float32)
        for az, w in [(315, 0.45), (270, 0.2), (0, 0.2), (225, 0.15)]:
            a, h = np.radians(az), np.radians(40)
            tot += (w * (np.sin(h) * np.cos(pente) + np.cos(h) * np.sin(pente) * np.cos(a - aspect))).astype(np.float32)
        return tot, pente

    out = np.full(z.shape + (4,), np.nan, np.float32)
    BANDE, M = 768, 64
    for j0 in range(0, H, BANDE):
        a0, a1 = max(0, j0 - M), min(H, j0 + BANDE + M)
        zb = z[a0:a1].astype(np.float32)
        fin, pente = ombre(gaussian_filter(zb, 0.7), 1.6)
        large, _ = ombre(gaussian_filter(zb, 6), 2.0)
        occl = np.clip((zb - gaussian_filter(zb, 10)) / 3.0, -1, 1)
        base = np.zeros(zb.shape + (3,), np.float32)
        for code, c in [(0, inconnu), (1, roche), (2, sable), (3, vase)]:
            base += poids_mil[code][a0:a1, :, None] * c
        # Une pente forte se lit comme de la roche, quel que soit le sédiment annoncé : la carte des sédiments ne voit pas
        # les têtes de roche isolées que le lidar montre.
        raide = np.clip((np.degrees(pente) - 16) / 14, 0, 1) * 0.8
        base = base * (1 - raide[..., None]) + roche * raide[..., None]
        base *= (1 + 0.07 * bruit[a0:a1])[..., None]
        prof = np.clip(-zb, 0, None)
        lointain = 1 - 0.42 * np.clip(np.log1p(prof) / np.log1p(400), 0, 1)
        lum = (0.66 + 0.75 * (fin - 0.55) + 0.3 * (large - 0.55) * (1 - hors_tout[a0:a1])) * (1 + 0.25 * occl)
        rgb = base * (lum * lointain)[..., None]
        hors = 0.6 * hors_tout[a0:a1, :, None]
        rgb = rgb * (1 - hors) + rgb * np.array([0.82, 0.9, 1.0], np.float32) * hors
        alpha = np.clip((0.15 - zb) / 0.3, 0, 1) * 255
        bloc = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.float32)
        k0, k1 = j0 - a0, j0 - a0 + min(BANDE, H - j0)
        out[j0:j0 + (k1 - k0)] = bloc[k0:k1]
        print('  texture, bande', j0)
    out[~np.isfinite(z)] = np.nan
    return out


def tuiles_texture(z, source):
    """Tuiles WebP de 512 points, avec transparence. La teinte est prémultipliée par l'alpha avant la pyramide, pour
    que la moyenne 2 × 2 n'assombrisse pas le bord des terres, puis rétablie à l'écriture."""
    t = texture(z, source)
    t[..., :3] *= t[..., 3:4] / 255

    def ecrire(bloc, f):
        b = np.nan_to_num(bloc.copy(), nan=0)
        a = b[..., 3:4]
        b[..., :3] = np.where(a > 0, b[..., :3] * 255 / np.maximum(a, 1e-3), 0)
        Image.fromarray(np.clip(b, 0, 255).astype(np.uint8), 'RGBA').save(f + '.webp', quality=82, method=6)

    def combler(bloc, vide, zz, x, y):
        bloc[vide] = 0
        return bloc
    pyramide(t, 'fond', ecrire, 512, combler)


if __name__ == '__main__':
    telecharger()
    sediments()
    fz, fs = os.path.join(DONNEES, 'plongee_z.npy'), os.path.join(DONNEES, 'plongee_source.npy')
    if os.path.exists(fz) and '--refaire' not in sys.argv:
        z, source = np.load(fz), np.load(fs)
    else:
        for f in ['homonim_merc.npy']:
            if '--refaire' in sys.argv and os.path.exists(os.path.join(DONNEES, f)):
                os.remove(os.path.join(DONNEES, f))
        z, source = assembler()
        np.save(fz, z)
        np.save(fs, source)
        print('Assemblage :', float(np.nanmin(z)), float(np.nanmax(z)))
    tout = not any(a in sys.argv for a in ['--tuiles', '--vecteurs', '--texture'])
    if tout or '--tuiles' in sys.argv:
        tuiles(z)
    if tout or '--vecteurs' in sys.argv:
        vecteurs(z, source)
    if tout or '--texture' in sys.argv:
        tuiles_texture(z, source)
