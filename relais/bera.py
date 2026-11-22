"""Relais du bulletin d'avalanche : lit le bulletin XML de Météo-France pour les massifs voulus et l'écrit en JSON
à côté de la carte. La clé reste dans les secrets du dépôt (variable d'environnement METEOFRANCE_BRA), jamais dans la page."""
import json, os, sys, urllib.request, urllib.error, datetime
import xml.etree.ElementTree as ET

BASE = "https://public-api.meteofrance.fr/public/DPBRA/v1/massif/BRA?id-massif={id}&format=xml"
MASSIFS = {5: "Beaufortain", 6: "Haute-Tarentaise"}
SORTIE = os.path.join(os.path.dirname(__file__), "..", "tarentaise", "bera.json")
ROSE = {"N": "N", "NE": "NE", "E": "E", "SE": "SE", "S": "S", "SW": "SO", "W": "O", "NW": "NO"}

def entier(v):
    try: return int(v)
    except (TypeError, ValueError): return None

def lire(idm, cle):
    req = urllib.request.Request(BASE.format(id=idm), headers={"apikey": cle, "accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as r:
        racine = ET.fromstring(r.read())
    b = racine if racine.tag == "BULLETINS_NEIGE_AVALANCHE" else racine.find(".//BULLETINS_NEIGE_AVALANCHE")
    risque, pente, enn = b.find(".//CARTOUCHERISQUE/RISQUE"), b.find(".//CARTOUCHERISQUE/PENTE"), b.find(".//ENNEIGEMENT")
    return {
        "nom": b.get("MASSIF") or MASSIFS[idm],
        "redige": b.get("DATEBULLETIN"), "valable": b.get("DATEVALIDITE"),
        "risque1": entier(risque.get("RISQUE1")) if risque is not None else None, "loc1": risque.get("LOC1") if risque is not None else None,
        "altitude": entier(risque.get("ALTITUDE")) if risque is not None else None,
        "risque2": entier(risque.get("RISQUE2")) if risque is not None else None, "loc2": risque.get("LOC2") if risque is not None else None,
        "risquemaxi": entier(risque.get("RISQUEMAXI")) if risque is not None else None,
        "commentaire": (risque.get("COMMENTAIRE") or "").strip() if risque is not None else "",
        "pentes": [fr for xml, fr in ROSE.items() if pente is not None and pente.get(xml) == "true"],
        "enneigement": None if enn is None else {
            "limiteNord": entier(enn.get("LimiteNord")), "limiteSud": entier(enn.get("LimiteSud")),
            "niveaux": [{"alti": entier(n.get("ALTI")), "n": entier(n.get("N")), "s": entier(n.get("S"))} for n in enn.findall("NIVEAU")],
        },
    }

def main():
    cle = os.environ.get("METEOFRANCE_BRA", "").strip()
    if not cle: sys.exit("Secret METEOFRANCE_BRA absent : rien n'est lu.")
    sortie, erreurs = {"maj": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"), "massifs": {}}, 0
    for idm in MASSIFS:
        try:
            sortie["massifs"][str(idm)] = lire(idm, cle)
            print("lu :", MASSIFS[idm], sortie["massifs"][str(idm)]["redige"])
        except urllib.error.HTTPError as e:
            erreurs += 1; print("ÉCHEC", MASSIFS[idm], e.code, e.read()[:300].decode("utf-8", "replace"))
        except Exception as e:
            erreurs += 1; print("ÉCHEC", MASSIFS[idm], repr(e))
    if not sortie["massifs"]: sys.exit("Aucun bulletin lu : le fichier précédent est gardé.")
    with open(SORTIE, "w", encoding="utf-8") as f: json.dump(sortie, f, ensure_ascii=False, indent=1)
    if erreurs: sys.exit(1)

if __name__ == "__main__": main()
