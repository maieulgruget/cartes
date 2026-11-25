# cartes

Cartes interactives personnelles, servies par GitHub Pages.

| Carte | Page | Questions |
|---|---|---|
| Versant du soleil (Les Chapelles, Tarentaise) | `tarentaise/` | pentes par orientation et altitude, ombres à l'heure choisie, heures de soleil, limite du gel, prévisions |
| Où est la mer (de Bréhat au cap Fréhel) | `marees/` | mer maintenant, durée d'émersion de l'estran, heures de passage en un point, niveau libre |
| Où est la lumière (La Réunion) | `reunion/` | ombres à l'heure choisie, heures de soleil d'un versant, carte d'ensoleillement, lever et coucher |
| Où chercher (Semnoz, champignons) | `semnoz/` | note par champignon, pluie des 14 jours, peuplements |
| Sous voile (de Cerbère à Menton, et la Corse) | `voile/` | vent, vagues dessinées sur la mer, fonds marins et isobathes, ports et abris par ordre d'importance, balises, route avec allures et profil des fonds, voilier en volume |
| Mes randos (Corse) | `corse/` | où je suis passé : tracés drapés sur le relief, profil, pente le long du chemin, altitude, sol et type de chemin (Komoot), survol ; lumière ; itinéraire à préparer |

`socle/` porte ce qui est commun : Plan IGN HD (fond d'ouverture ; son blanc du large est repeint en mer, son blanc de
terre reste blanc), fond gris, photo, relief et carte géologique du BRGM (métropole) ; retour à la page des cartes ;
panneau de thème ouvert ou réduit, carte libre par appui long, boussole, liste de fonds (cartes anciennes comprises) ;
relief LiDAR HD lu à la volée (à l'échelle réelle, accentué sur demande), bâtiments en volume, thèmes regroupés en
familles (une puce par famille, une rangée de sous-thèmes), signets, recherche, calculs (pentes, soleil, ombres portées).

`socle/fonds.js` : fonds marins du Shom (modèle HOMONIM à 100 m, relu sur sa palette de couleurs), isobathes, profil
le long d'une route. `relais/lieux.py` prépare `voile/lieux.json` (ports, caps, îles, anses, feux de la BD TOPO, avec un
rang d'apparition) ; `relais/balises.py` prépare `voile/balises.json` (balises d'OpenStreetMap), à lancer à la main ou
par une tâche planifiée : tant que ce fichier manque, la carte interroge le service d'OpenStreetMap zone par zone.

`relais/randos.py` prépare `corse/randos.geojson` à partir des GPX de `corse/gpx/` ; un fichier `nom.komoot` (numéro du
tour) à côté d'un GPX lui fait demander à Komoot le type de chemin et la nature du sol le long du tracé (tour privé :
secrets `KOMOOT_EMAIL` et `KOMOOT_PASSWORD`). La tâche « Randos » le relance à chaque GPX déposé.

Données : IGN (Géoplateforme), BRGM, Shom, OpenStreetMap, Open-Meteo. Versions de travail, à vérifier sur le terrain.
