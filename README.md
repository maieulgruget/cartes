# cartes

Cartes interactives personnelles, servies par GitHub Pages.

| Carte | Page | Questions |
|---|---|---|
| Versant du soleil (Les Chapelles, Tarentaise) | `tarentaise/` | pentes par orientation et altitude, ombres à l'heure choisie, heures de soleil, limite du gel, prévisions |
| Où est la mer (de Bréhat au cap Fréhel) | `marees/` | mer maintenant, durée d'émersion de l'estran, heures de passage en un point, niveau libre |
| Où est la lumière (La Réunion) | `reunion/` | ombres à l'heure choisie, heures de soleil d'un versant, carte d'ensoleillement, lever et coucher |
| Où chercher (Semnoz, champignons) | `semnoz/` | note par champignon, pluie des 14 jours, peuplements |
| Sous voile (de Cerbère à Menton, et la Corse) | `voile/` | vent, vagues dessinées sur la mer, fonds marins et isobathes, ports et abris par ordre d'importance, balises, route avec allures et profil des fonds, voilier en volume |
| Mes randos (Corse, puis toute la France) | `corse/` | où je suis passé : tracés drapés sur le relief, profil, pente le long du chemin, altitude, sol et type de chemin (Komoot), survol ; lumière ; itinéraire à préparer |

`socle/` porte ce qui est commun : Plan IGN HD (fond d'ouverture ; son blanc du large est repeint en mer, son blanc de
terre reste blanc), carte au 1/25 000 (SCAN 25, clé grand public de l'IGN : usage personnel), fond gris, photo, relief et carte géologique du BRGM (métropole) ; retour à la page des cartes ;
panneau de thème ouvert ou réduit, carte libre par appui long, boussole, liste de fonds (cartes anciennes comprises) ;
relief LiDAR HD lu à la volée (à l'échelle réelle, accentué sur demande), bouton « Arbres » (en 3D rapprochée, le relief
prend le modèle de surface : forêt, haies et bâtiments en volume), bâtiments en volume, thèmes regroupés en
familles (une puce par famille, une rangée de sous-thèmes), signets, recherche, calculs (pentes, soleil, ombres portées).

`socle/fonds.js` : fonds marins du Shom (modèle HOMONIM à 100 m, relu sur sa palette de couleurs), isobathes, profil
le long d'une route. `relais/lieux.py` prépare `voile/lieux.json` (ports, caps, îles, anses, feux de la BD TOPO, avec un
rang d'apparition) ; `relais/balises.py` prépare `voile/balises.json` (balises d'OpenStreetMap), à lancer à la main ou
par une tâche planifiée : tant que ce fichier manque, la carte interroge le service d'OpenStreetMap zone par zone.

`relais/randos.py` prépare `corse/randos.geojson` : les GPX de `corse/gpx/`, et tous les tours du compte Komoot qui
partent de France (hors de Corse, rognés de 400 m à chaque bout, le dépôt étant public) (secrets `KOMOOT_EMAIL` et `KOMOOT_PASSWORD`), avec le type de chemin et la nature du sol le long du
tracé. Les réponses de Komoot sont gardées dans `corse/komoot/` ; un numéro ajouté à `corse/komoot/ecartes.txt` écarte un
tour. La tâche « Randos » le relance chaque lundi, à chaque GPX déposé, ou à la demande.

`socle/trace.js` (thème Itinéraire) sait suivre les sentiers : entre deux points posés, il demande le chemin au calcul
d'itinéraire piéton de l'IGN (BD TOPO). Thème « Préparer » sur les cartes Corse, Réunion, Champignons et Marées ; bouton
« Suivre les sentiers » (éteint au départ) dans l'itinéraire de la Tarentaise.

Données : IGN (Géoplateforme), BRGM, Shom, OpenStreetMap, Open-Meteo. Versions de travail, à vérifier sur le terrain.
