"""Lieux de la carte Voile : ports, caps, îles, anses et feux de la côte méditerranéenne française (de Cerbère à Menton,
Corse comprise), tirés de la BD TOPO de l'IGN (service WFS de la Géoplateforme) et écrits dans voile/lieux.json.

Chaque lieu porte un rang d'apparition (0 : visible de très loin ; 3 : visible de près), déduit de l'importance que
l'IGN donne au toponyme. Ne sont gardés que les lieux à moins de 1,5 km de la mer (2,5 km pour les îles) : la mer est
reconnue sur les tuiles de relief mondiales (altitude négative). À relancer à la main quand la BD TOPO évolue :
    python relais/lieux.py
"""
import io, json, math, os, sys, time, urllib.parse, urllib.request

WFS = "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&OUTPUTFORMAT=application/json&COUNT=5000"
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/{x}/{y}.png"
SORTIE = os.path.join(os.path.dirname(__file__), "..", "voile", "lieux.json")
# Emprises lues, en degrés : [ouest, sud, est, nord].
ZONES = [[2.95, 42.40, 7.60, 43.80], [8.45, 41.30, 9.65, 43.05]]
PAS = 0.35
# Grands repères, visibles dès la vue d'ensemble de la côte : (morceau de nom, type). Le nom est cherché dans la BD TOPO ;
# la position vient d'elle, jamais de cette liste.
REPERES = [
    ("port-vendres", "port"), ("canet", "port"), ("leucate", "port"), ("gruissan", "port"), ("cap d'agde", "port"),
    ("grande-motte", "port"), ("port camargue", "port"), ("la ciotat", "port"),
    ("bandol", "port"), ("hyères", "port"), ("lavandou", "port"), ("saint-tropez", "port"), ("sainte-maxime", "port"),
    ("saint-raphaël", "port"), ("vauban", "port"), ("menton", "port"),
    ("bonifacio", "port"), ("porto-vecchio", "port"), ("saint-florent", "port"), ("propriano", "port"), ("macinaggio", "port"),
    ("cap béar", "cap"), ("cap leucate", "cap"), ("cap d'agde", "cap"), ("cap couronne", "cap"), ("cap croisette", "cap"), ("cap sicié", "cap"),
    ("cap bénat", "cap"), ("cap camarat", "cap"), ("cap d'antibes", "cap"), ("cap ferrat", "cap"), ("cap corse", "cap"), ("capo pertusato", "cap"),
    ("île de porquerolles", "île"), ("île du levant", "île"), ("île de port cros", "île"), ("îles du frioul", "île"), ("île sainte-marguerite", "île"),
    ("îles sanguinaires", "île"), ("îles lavezzi", "île"),
]
# Grands ports que la BD TOPO nomme autrement que leur ville (« Port Tino Rossi » à Ajaccio) : (ville, longitude et
# latitude approximatives du centre-ville). Ce point ne sert qu'à choisir, parmi les ports de l'IGN à moins de 2,5 km,
# le plus important ; la position gardée est celle de l'IGN, le lieu prend le nom de la ville et garde celui de l'IGN en détail.
VILLES = [("Sète", 3.70, 43.40), ("Port-Saint-Louis-du-Rhône", 4.81, 43.39), ("Marseille", 5.37, 43.295), ("Toulon", 5.93, 43.12), ("Cannes", 7.015, 43.548),
          ("Nice", 7.285, 43.695), ("Ajaccio", 8.74, 41.92), ("Bastia", 9.45, 42.70), ("Calvi", 8.76, 42.566), ("L'Île-Rousse", 8.936, 42.64)]


def lire(url, essais=4):
    cache = os.environ.get("LIEUX_CACHE")   # dossier facultatif où garder les réponses, pour relancer sans tout relire
    if cache:
        import hashlib
        f = os.path.join(cache, hashlib.md5(url.encode()).hexdigest())
        if os.path.exists(f):
            return open(f, "rb").read()
        d = _lire(url, essais)
        if d[:1] in (b"{", b"\x89"):
            open(f, "wb").write(d)
        return d
    return _lire(url, essais)


def _lire(url, essais=4):
    for n in range(essais):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return r.read()
        except Exception:
            if n == essais - 1:
                raise
            time.sleep(3 * (n + 1))


# ---------- La mer est-elle proche ? ----------
_tuiles = {}


def _tuile(x, y):
    if (x, y) not in _tuiles:
        from PIL import Image
        im = Image.open(io.BytesIO(lire(TERRARIUM.format(x=x, y=y)))).convert("RGB")
        _tuiles[(x, y)] = im.load()
    return _tuiles[(x, y)]


def altitude(lon, lat):
    n = 1024
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    r, g, b = _tuile(int(x), int(y))[int((x % 1) * 256), int((y % 1) * 256)]
    return r * 256 + g + b / 256 - 32768


def pres_de_la_mer(lon, lat, km):
    k = math.cos(math.radians(lat))
    for d in (0.0, 0.33, 0.66, 1.0):
        for a in range(0, 360, 30):
            dx, dy = d * km * math.sin(math.radians(a)), d * km * math.cos(math.radians(a))
            if altitude(lon + dx / (111.2 * k), lat + dy / 111.2) < -0.5:
                return True
            if d == 0:
                break
    return False


# ---------- Lecture de la BD TOPO ----------
def centre(geom):
    pts = []

    def tous(c):
        if isinstance(c[0], (int, float)):
            pts.append(c)
        else:
            for s in c:
                tous(s)
    tous(geom["coordinates"])
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def couche(table, filtre):
    vus, sortie = set(), []
    for o, s, e, n in ZONES:
        lat = s
        while lat < n:
            lon = o
            while lon < e:
                cql = f"({filtre}) AND BBOX(geometrie,{lon:.3f},{lat:.3f},{min(e, lon + PAS):.3f},{min(n, lat + PAS):.3f},'EPSG:4326')"
                j = None
                for essai in range(5):   # le service répond parfois par une page d'erreur : on redemande
                    brut = lire(WFS + f"&TYPENAMES=BDTOPO_V3:{table}&CQL_FILTER=" + urllib.parse.quote(cql))
                    try:
                        j = json.loads(brut)
                        break
                    except ValueError:
                        time.sleep(4 * (essai + 1))
                if j is None:
                    raise RuntimeError(f"WFS illisible pour {table} en {lon:.2f},{lat:.2f} : {brut[:200]!r}")
                if j.get("numberMatched", 0) > len(j["features"]):
                    print("  attention : réponse tronquée", table, lon, lat, j.get("numberMatched"), file=sys.stderr)
                for f in j["features"]:
                    p = f["properties"]
                    if p["cleabs"] in vus or not p.get("toponyme") or p.get("etat_de_l_objet", "En service") not in ("En service", None):
                        continue
                    vus.add(p["cleabs"])
                    x, y = centre(f["geometry"])
                    sortie.append((p["toponyme"].strip(), p.get("nature"), p.get("nature_detaillee"), int(p.get("importance") or 6), x, y))
                lon += PAS
            lat += PAS
    return sortie


def simple(nom):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", nom.lower()) if unicodedata.category(c) != "Mn").replace("-", " ").replace("'", " ")


def rang(importance):
    return 1 if importance <= 2 else 2 if importance == 3 else 3


def nom_port(nom):
    for d in ("Port de Plaisance de la ", "Port de Plaisance du ", "Port de Plaisance des ", "Port de Plaisance de l'", "Port de Plaisance de ", "Port de Plaisance d'"):
        if nom.lower().startswith(d.lower()):
            return "Port " + d[len("Port de Plaisance "):] + nom[len(d):]
    return nom


def main():
    lieux = []
    ports = couche("equipement_de_transport", "nature='Port'")
    for nom, nat, det, imp, x, y in ports:
        if det == "Port de commerce" and imp > 3:
            continue
        if any(m in nom for m in ("Terminal", "Grand Port Maritime", "Forme ", "Môle", "Quai ")):
            continue
        if pres_de_la_mer(x, y, 1.5):
            lieux.append([nom_port(nom), "port", x, y, min(3, rang(imp) + (1 if imp >= 5 else 0))])
    print("ports", len(lieux), "sur", len(ports))
    oro = couche("detail_orographique", "nature IN ('Cap','Ile')")
    n0 = len(lieux)
    for nom, nat, det, imp, x, y in oro:
        if imp > 4:
            continue
        ile = nat == "Ile"
        if pres_de_la_mer(x, y, 2.5 if ile else 1.0):
            lieux.append([nom, "île" if ile else "cap", x, y, rang(imp)])
    print("caps et îles", len(lieux) - n0, "sur", len(oro))
    hyd = couche("detail_hydrographique", "nature IN ('Baie','Feu','Espace maritime')")
    n0 = len(lieux)
    for nom, nat, det, imp, x, y in hyd:
        if nat == "Feu":
            if pres_de_la_mer(x, y, 0.8):
                lieux.append([nom, "feu", x, y, rang(imp)])
            continue
        if imp > 4 or any(m in nom for m in ("Bassin", "Forme ", "Avant-Port", "Avant Port", "Darse")):
            continue
        if nat == "Espace maritime" and not any(m in nom for m in ("Mouillage", "Rade", "Passe", "Passage", "Golfe", "Baie")):
            continue
        if pres_de_la_mer(x, y, 1.0):
            lieux.append([nom, "anse", x, y, rang(imp)])
    print("anses, rades et feux", len(lieux) - n0, "sur", len(hyd))
    # Grands repères : rang 0. On prend, parmi les lieux du bon type dont le nom contient le morceau, le plus important.
    manques = []
    for morceau, typ in REPERES:
        cand = [l for l in lieux if l[1] == typ and morceau in l[0].lower()]
        if not cand:
            manques.append(morceau)
            continue
        min(cand, key=lambda l: (l[4], len(l[0])))[4] = 0
    for ville, vx, vy in VILLES:
        k = math.cos(math.radians(vy))
        cand = [(math.hypot((l[2] - vx) * k, l[3] - vy) * 111.2, l) for l in lieux if l[1] == "port"]
        cand = [(d, l) for d, l in cand if d < 2.5]
        if not cand:
            manques.append(ville)
            continue
        proches = [q for q in cand if q[0] < 1.0]   # un port au pied de la ville l'emporte ; sinon le plus important alentour
        d, l = min(proches, key=lambda q: (q[1][4], q[0])) if proches else min(cand, key=lambda q: (q[1][4], q[0]))
        l[4] = 0
        if len(l) == 5:
            l.append(l[0])   # sixième champ : le nom que l'IGN donne au port, montré quand on le touche
        l[0] = ville
        print("  ", ville, "→", l[0], round(d, 2), "km")
    if manques:
        print("introuvables :", ", ".join(manques), file=sys.stderr)
    lieux.sort(key=lambda l: (l[4], l[1], l[0]))
    for l in lieux:
        l[2], l[3] = round(l[2], 5), round(l[3], 5)
    with open(SORTIE, "w", encoding="utf-8") as f:
        json.dump({"source": "BD TOPO © IGN", "champs": ["nom", "type", "lon", "lat", "rang", "détail (facultatif)"], "lieux": lieux}, f, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print(len(lieux), "lieux", Counter((l[1], l[4]) for l in lieux))


if __name__ == "__main__":
    main()
