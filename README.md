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

Photo aérienne : la BD ORTHO courante de l'IGN (20 cm), sous la photo à très haute résolution de l'IGN là où elle existe
(Marseille). Fond « Photo 2025 » : la même, avec l'ortho-express 2025 là où elle existe (Côtes-d'Armor, Haute-Savoie,
La Réunion…). Relevé du 25/11/2026 ; l'Ortho THR 06 de DataSud (WMS) reste à brancher.

`socle/` porte ce qui est commun : Plan IGN HD (fond d'ouverture ; son blanc du large est repeint en mer, son blanc de
terre reste blanc), carte au 1/25 000 (SCAN 25, clé grand public de l'IGN : usage personnel), fond gris, photo, relief et carte géologique du BRGM (métropole) ; retour à la page des cartes ;
panneau de thème ouvert ou réduit, carte libre par appui long, boussole, liste de fonds (cartes anciennes comprises) ;
relief LiDAR HD lu à la volée (à l'échelle réelle, accentué sur demande), arbres en volume sur la photo aérienne (en 3D rapprochée, le relief
prend le modèle de surface adouci ; le bouton « Couvert » les retire), bouton « Arbres » sur tous les fonds (arbres dressés un par un), bâtiments en volume, thèmes regroupés en
familles (une puce par famille, une rangée de sous-thèmes), signets, recherche, calculs (pentes, soleil, ombres portées).

Sur ordinateur (fenêtre de plus de 900 × 560 points), le socle passe en disposition « bureau » : thèmes et réponse en
colonne à gauche, de la largeur d'un téléphone, carte décalée d'autant ; tout est affiché dès l'ouverture ; clavier
(`/` chercher, `L` carte seule, `F` grand écran, `Échap` refermer) ; le bouton « Envoyer cette vue au téléphone » du menu
donne un code à scanner. L'adresse d'une vue porte le cadrage, et `?theme=…&fond=…` le thème et le fond. « Grand écran »
(`F`, bouton des outils, menu, ou `?ecran` dans l'adresse) : la carte, son titre, la question du thème, sa phrase de
réponse et sa légende, en grand, pour un écran regardé de loin ; `T` thème suivant, `R` rotation lente. Un thème qui
cadre la carte demande ses marges à `app.marges(margesTéléphone)`.

`socle/fonds.js` : fonds marins du Shom (modèle HOMONIM à 100 m, relu sur sa palette de couleurs), isobathes, profil
le long d'une route. `relais/lieux.py` prépare `voile/lieux.json` (ports, caps, îles, anses, feux de la BD TOPO, avec un
rang d'apparition) ; `relais/balises.py` prépare `voile/balises.json` (balises d'OpenStreetMap), à lancer à la main ou
par une tâche planifiée : tant que ce fichier manque, la carte interroge le service d'OpenStreetMap zone par zone.

`relais/randos.py` prépare `corse/randos.geojson` : les GPX de `corse/gpx/`, et tous les tours du compte Komoot qui
partent de France (hors de Corse, rognés de 400 m à chaque bout, le dépôt étant public) (secrets `KOMOOT_EMAIL` et `KOMOOT_PASSWORD`), avec le type de chemin et la nature du sol le long du
tracé. Les réponses de Komoot sont gardées dans `corse/komoot/` ; un numéro ajouté à `corse/komoot/ecartes.txt` écarte un
tour. La tâche « Randos » le relance chaque lundi, à chaque GPX déposé, ou à la demande.

`socle/arbres.js` : autour du centre de la vue, il repère chaque cime dans la hauteur du couvert (surface moins sol du
LiDAR HD) et dresse un arbre à sa hauteur ; le relevé suit la carte. Sur toutes les cartes et tous les fonds par le bouton
« Arbres » ; sur la carte de La Réunion aussi par le thème « Cimes » (famille Drone : hauteurs en couleurs, légende).

`socle/drone.js` (famille Drone, carte de La Réunion) : thème « Caméra », ce qu'une photo de drone montrera, drapé sur
le relief. Tout se règle sur la carte, en plein écran : hauteur à droite du point, nacelle à gauche, cap autour, bouton
pour recentrer ; le panneau garde les valeurs (un toucher sur un chiffre pour taper une valeur exacte) et le plan de vol
en tableau. Toucher le point d'une prise la reprend (ce qu'elle voit, réglages, déplacement, retrait) ; le tableau change
son rang. « Bilan du plan » réunit toutes les prises (vu par une, par plusieurs, caché par le relief) ; exports KML,
Litchi (CSV) et fiche à imprimer. Thème « Vol » : limite des 120 m, vue directe, vent.

`socle/survol.js` : survol d'un tracé, la caméra suit le chemin et fait halte au départ, aux points hauts (nommés d'après
les lieux-dits de l'IGN) et à l'arrivée. Bouton « Survol » des outils de la carte, dès qu'une rando est choisie ou
qu'un itinéraire est tracé ; caméra rapprochée, barre de pause, d'allure et de halte suivante.

`socle/trace.js` (thème Itinéraire) sait suivre les sentiers : entre deux points posés, il demande le chemin au calcul
d'itinéraire piéton de l'IGN (BD TOPO). Thème « Préparer » sur les cartes Corse, Réunion, Champignons et Marées ; bouton
« Suivre les sentiers » (éteint au départ) dans l'itinéraire de la Tarentaise.

Données : IGN (Géoplateforme), BRGM, Shom, OpenStreetMap, Open-Meteo. Versions de travail, à vérifier sur le terrain.
