"""Prépare corse/randos.geojson : mes randos en Corse.

    python relais/randos.py            (depuis la racine du dépôt)

Deux sources, réunies dans le même fichier :

1. Les GPX déposés dans corse/gpx/. Pour chacun : distance, dénivelés, altitudes extrêmes. Un fichier
   « même-nom.komoot » posé à côté (le numéro du tour Komoot) lui fait demander à Komoot le type de chemin et la nature
   du sol le long du tracé ; « même-nom.bilan.json » peut porter, à défaut, les totaux relevés sur la page du tour.

2. Le compte Komoot lui-même, quand les identifiants sont donnés par l'environnement (KOMOOT_EMAIL, KOMOOT_PASSWORD,
   jamais écrits dans le dépôt) : la liste des tours du compte est parcourue, et ceux qui partent de Corse sont
   rapportés avec leur tracé, leurs types de chemin et leurs sols. Les tours déjà rattachés à un GPX ne sont pas repris.

Les réponses de Komoot sont gardées, allégées, dans corse/gpx/*.komoot.json et corse/komoot/<numéro>.json : un tour
déjà rapporté n'est pas redemandé. Supprimer son fichier le fait relire ; l'ajouter à corse/komoot/ecartes.txt
(un numéro par ligne) l'écarte de la carte.

L'interface de Komoot n'est pas documentée publiquement : si elle change ou refuse, la carte garde ce qu'elle a déjà.
"""
import base64, glob, json, math, os, re, sys, urllib.parse, urllib.request, xml.etree.ElementTree as ET

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOSSIER = os.path.join(RACINE, 'corse', 'gpx')
CACHE = os.path.join(RACINE, 'corse', 'komoot')
SORTIE = os.path.join(RACINE, 'corse', 'randos.geojson')
NS = {'g': 'http://www.topografix.com/GPX/1/1'}
API = 'https://api.komoot.de'
TOUR = API + '/v007/tours/{id}?_embedded=coordinates,way_types,surfaces&format=coordinate_array'
CORSE = (8.45, 41.30, 9.65, 43.05)   # ouest, sud, est, nord
EMAIL, MDP = os.environ.get('KOMOOT_EMAIL'), os.environ.get('KOMOOT_PASSWORD')


def dist(a, b):
    r = math.radians
    p1, p2, dp, dl = r(a[1]), r(b[1]), r(b[1] - a[1]), r(b[0] - a[0])
    return 2 * 6371000 * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def demander(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/hal+json', 'User-Agent': 'cartes-relais'})
    if EMAIL and MDP:
        req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{EMAIL}:{MDP}'.encode()).decode())
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def alleger(j):
    """Ne garde de la réponse de Komoot que ce dont la carte se sert : ni profil du compte, ni liens, ni images."""
    emb = j.get('_embedded', {})
    return {'id': j.get('id'), 'name': j.get('name'), 'sport': j.get('sport'), 'type': j.get('type'), 'date': j.get('date'),
            'difficulty': {'grade': (j.get('difficulty') or {}).get('grade')},
            '_embedded': {c: {'items': (emb.get(c) or {}).get('items') or []} for c in ('coordinates', 'way_types', 'surfaces')}}


def tour(ident, cache, jeton=None):
    """Un tour Komoot : depuis son fichier, sinon demandé à Komoot (et gardé). None si Komoot ne le donne pas."""
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    try:
        j = alleger(demander(TOUR.format(id=ident) + ('&share_token=' + jeton if jeton else '')))
    except Exception as e:
        print(f'  Komoot ne donne pas le tour {ident} ({e})', file=sys.stderr)
        return None
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(j, f, ensure_ascii=False, separators=(',', ':'))
    return j


def tours_du_compte():
    """Numéros des tours du compte qui partent de Corse. Liste vide sans identifiants, ou si Komoot refuse."""
    if not (EMAIL and MDP):
        print('  pas d\'identifiants Komoot : GPX seuls')
        return []
    try:
        compte = demander(f'{API}/v006/account/email/{urllib.parse.quote(EMAIL)}/')
        moi = compte.get('username') or os.environ.get('KOMOOT_USER')
        ids, page, pages = [], 0, 1
        while page < pages and page < 60:
            j = demander(f'{API}/v007/users/{moi}/tours/?page={page}&limit=100')
            for t in (j.get('_embedded') or {}).get('tours') or []:
                p = t.get('start_point') or {}
                if 'lng' in p and CORSE[0] <= p['lng'] <= CORSE[2] and CORSE[1] <= p['lat'] <= CORSE[3]:
                    ids.append(t['id'])
            pages = (j.get('page') or {}).get('totalPages', 1)
            page += 1
        print(f'  compte Komoot : {len(ids)} tour(s) en Corse')
        return ids
    except Exception as e:
        print(f'  la liste des tours Komoot n\'a pas pu être lue ({e})', file=sys.stderr)
        return []


def lire_gpx(chemin):
    root = ET.parse(chemin).getroot()
    nom = (root.findtext('.//g:trk/g:name', namespaces=NS) or root.findtext('.//g:metadata/g:name', namespaces=NS) or '').strip()
    t0 = root.findtext('.//g:trkpt/g:time', namespaces=NS)
    lire = lambda balise: [[float(p.get('lon')), float(p.get('lat')), float(p.findtext('g:ele', 'nan', NS))] for p in root.iterfind('.//g:' + balise, NS)]
    return nom, (t0[:10] if t0 else None), lire('trkpt') or lire('rtept')   # une trace, sinon un itinéraire


def troncons(items, n):
    """[[début, fin, code], …] en indices de points, codes Komoot sans préfixe (wt#, sb#, sf#)."""
    out = []
    for it in items or []:
        a, b, code = it.get('from'), it.get('to'), str(it.get('element', ''))
        if a is not None and b is not None:
            out.append([max(0, int(a)), min(n - 1, int(b)), code.split('#', 1)[-1]])
    return out


def avec_komoot(props, pts, k):
    """Complète une rando avec la réponse de Komoot ; renvoie les points à garder (ceux de Komoot s'il en donne)."""
    emb = k.get('_embedded', {})
    coords = (emb.get('coordinates') or {}).get('items') or []
    if len(coords) > 1:
        pts = [[c['lng'], c['lat'], c.get('alt', float('nan'))] for c in coords]
    props.update({'source': 'Komoot', 'komoot': k.get('id'), 'nom': k.get('name') or props.get('nom'), 'sport': k.get('sport'),
                  'prevu': k.get('type') == 'tour_planned', 'difficulte': (k.get('difficulty') or {}).get('grade')})
    if k.get('date') and not props.get('date'):
        props['date'] = k['date'][:10]
    props['chemin'] = troncons((emb.get('way_types') or {}).get('items'), len(pts))
    props['sol'] = troncons((emb.get('surfaces') or {}).get('items'), len(pts))
    return pts


def rando(props, pts):
    if len(pts) < 2:
        return None
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
    print(f"  {props['id']} : {props['nom']}, {props['km']} km, +{props['dplus']} m, {props['source']}")
    return {'type': 'Feature', 'properties': props, 'geometry': {
        'type': 'LineString', 'coordinates': [[round(p[0], 5), round(p[1], 5), round(p[2])] for p in pts]}}


features, pris = [], set()
# 1. Les GPX déposés
for chemin in sorted(glob.glob(os.path.join(DOSSIER, '*.gpx'))):
    base, ident = chemin[:-4], os.path.basename(chemin)[:-4]
    nom, date, pts = lire_gpx(chemin)
    props = {'id': ident, 'nom': nom or ident, 'date': date, 'source': 'GPX'}
    if os.path.exists(base + '.komoot') or os.path.exists(base + '.komoot.json'):
        texte = open(base + '.komoot', encoding='utf-8').read() if os.path.exists(base + '.komoot') else ''
        m, jeton = re.search(r'(\d{5,})', texte), re.search(r'share_token=([\w-]+)', texte)
        k = tour(m.group(1) if m else None, base + '.komoot.json', jeton.group(1) if jeton else None)
        if k:
            pts = avec_komoot(props, pts, k)
            pris.add(str(k.get('id')))
    if os.path.exists(base + '.bilan.json'):
        with open(base + '.bilan.json', encoding='utf-8') as f:
            props['bilan'] = json.load(f)
    f = rando(props, pts)
    if f: features.append(f)

# 2. Les tours du compte Komoot qui partent de Corse, plus ceux déjà rapportés lors d'un passage précédent
ecartes = set()
if os.path.exists(os.path.join(CACHE, 'ecartes.txt')):
    ecartes = set(re.findall(r'\d{5,}', open(os.path.join(CACHE, 'ecartes.txt'), encoding='utf-8').read()))
connus = [os.path.basename(c)[:-5] for c in glob.glob(os.path.join(CACHE, '*.json'))]
for ident in dict.fromkeys([str(i) for i in tours_du_compte()] + connus):
    if ident in pris or ident in ecartes:
        continue
    k = tour(ident, os.path.join(CACHE, ident + '.json'))
    if not k:
        continue
    props = {'id': 'k' + ident, 'nom': k.get('name') or ident, 'date': None, 'source': 'Komoot'}
    f = rando(props, avec_komoot(props, [], k))
    if f: features.append(f); pris.add(ident)

features.sort(key=lambda f: f['properties'].get('date') or '', reverse=True)   # les plus récentes d'abord
with open(SORTIE, 'w', encoding='utf-8') as f:
    f.write('{"type":"FeatureCollection","features":[\n' + ',\n'.join(json.dumps(ft, ensure_ascii=False, separators=(',', ':')) for ft in features) + '\n]}\n')
print(f'{len(features)} rando(s) -> corse/randos.geojson')
