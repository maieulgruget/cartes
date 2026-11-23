"""Relais des balises : relève auprès d'OpenStreetMap (service Overpass) les marques de balisage, feux, roches et épaves
de la côte méditerranéenne française, Corse comprise, et les écrit dans voile/balises.json.

La carte Voile lit ce fichier d'un coup : elle n'a plus à interroger le service public à chaque ouverture, qui sature
souvent. À lancer à la main (python relais/balises.py) ou par une tâche planifiée du dépôt. Si le relevé échoue ou
revient presque vide, le fichier précédent est gardé tel quel (le script sort en erreur)."""
import datetime, json, os, re, sys, time, urllib.parse, urllib.request

SERVEURS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
# Emprises (sud, ouest, nord, est) : le continent de Cerbère à Menton, puis la Corse.
ZONES = ["42.30,2.90,43.85,7.70", "41.25,8.40,43.10,9.70"]
SORTIE = os.path.join(os.path.dirname(__file__), "..", "voile", "balises.json")
DANGERS = {"roche", "epave", "isole"}


def genre(t):
    ty = t.get("seamark:type", "")
    if "lateral" in ty:
        c = t.get("seamark:buoy_lateral:category") or t.get("seamark:beacon_lateral:category") or ""
        return "tribord" if "starboard" in c else "babord" if "port" in c else None
    if "cardinal" in ty:
        c = t.get("seamark:buoy_cardinal:category") or t.get("seamark:beacon_cardinal:category") or ""
        return {"north": "nord", "south": "sud", "east": "est", "west": "ouest"}.get(c)
    if "isolated_danger" in ty:
        return "isole"
    if "safe_water" in ty:
        return "saines"
    if "special_purpose" in ty:
        return "speciale"
    if ty.startswith("light") or (ty == "landmark" and t.get("seamark:light:character")):
        return "feu"
    if ty == "rock":
        return "roche"
    if ty in ("wreck", "obstruction"):
        return "epave"
    return None


def portee(t):
    """Plus grande portée de feu annoncée, en milles (les feux à secteurs en portent plusieurs)."""
    vals = [v for k, v in t.items() if re.fullmatch(r"seamark:light(:\d+)?:range", k)]
    nombres = [float(m) for v in vals for m in re.findall(r"\d+(?:\.\d+)?", v)]
    return max(nombres) if nombres else 0


def rang(g, p):
    """Rang d'apparition : 1 de loin (grands feux), 2 (cardinales, dangers, feux moyens), 3 de près (latérales)."""
    if g == "feu":
        return 1 if p >= 15 else 2 if p >= 8 else 3
    return 2 if g in DANGERS or g in ("nord", "sud", "est", "ouest", "saines") else 3


def demander(requete):
    donnees = urllib.parse.urlencode({"data": requete}).encode()
    for tour in range(3):
        for srv in SERVEURS:
            try:
                req = urllib.request.Request(srv, data=donnees, headers={"User-Agent": "cartes-voile (relevé hebdomadaire ; github.com/maieulgruget/cartes)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read())
            except Exception as e:
                print("échec", srv, repr(e)[:160], file=sys.stderr)
        time.sleep(30 * (tour + 1))
    raise RuntimeError("aucun serveur Overpass n'a répondu")


def main():
    blocs = "".join(f'node["seamark:type"]({z});way["seamark:type"~"rock|wreck|obstruction"]({z});' for z in ZONES)
    j = demander(f"[out:json][timeout:240];({blocs});out center;")
    liste, vus = [], set()
    for el in j.get("elements", []):
        t = el.get("tags") or {}
        g = genre(t)
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        if not g or lon is None or (el["type"], el["id"]) in vus:
            continue
        vus.add((el["type"], el["id"]))
        p = portee(t)
        feu = ""
        if t.get("seamark:light:character"):
            feu = " · ".join(x for x in [t.get("seamark:light:character"), t.get("seamark:light:colour"), (t["seamark:light:period"] + " s") if t.get("seamark:light:period") else "", (f"{p:g} milles") if p else ""] if x)
        liste.append([g, round(lon, 5), round(lat, 5), (t.get("seamark:name") or t.get("name") or "")[:60], feu, rang(g, p)])
    print(len(j.get("elements", [])), "objets lus,", len(liste), "marques gardées")
    if len(liste) < 200:
        raise RuntimeError("relevé presque vide : le fichier précédent est gardé")
    liste.sort(key=lambda b: (b[5], b[0], b[1]))
    with open(SORTIE, "w", encoding="utf-8") as f:
        json.dump({"date": datetime.date.today().isoformat(), "source": "© les contributeurs d'OpenStreetMap (ODbL), objets seamark", "champs": ["genre", "lon", "lat", "nom", "feu", "rang"], "liste": liste}, f, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print(Counter(b[0] for b in liste))


if __name__ == "__main__":
    main()
