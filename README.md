# cartes

Cartes interactives personnelles, servies par GitHub Pages.

| Carte | Page | Questions |
|---|---|---|
| Versant du soleil (Les Chapelles, Tarentaise) | `tarentaise/` | pentes par orientation et altitude, ombres à l'heure choisie, heures de soleil, limite du gel, prévisions |
| Où est la mer (de Bréhat au cap Fréhel) | `marees/` | mer maintenant, durée d'émersion de l'estran, heures de passage en un point, niveau libre |
| Où est la lumière (La Réunion) | `reunion/` | ombres à l'heure choisie, heures de soleil d'un versant, carte d'ensoleillement, lever et coucher |
| Où chercher (Semnoz, champignons) | `semnoz/` | note par champignon, pluie des 14 jours, peuplements |
| Où chercher (Gréolières, Bar-sur-Loup et Sophia Antipolis, champignons) | `greolieres/` | même carte dans le 06, du Cheiron à Sophia, avec le sanguin et les chênaies |
| Sous voile (de Cerbère à Menton, et la Corse) | `voile/` | vent, vagues dessinées sur la mer, fonds marins et isobathes, ports et abris par ordre d'importance, balises, route avec allures et profil des fonds, voilier en volume |
| Sous la surface (îles de Lérins, golfe Juan, cap d'Antibes) | `plongee/` | profondeurs, avec le niveau de la mer que l'on fait baisser pour voir le fond à sec, couleurs qui s'éteignent avec la profondeur, poissons selon le milieu, natures de fond, sites (épaves, secs, sites à soi), parcours avec profil du fond, limites des niveaux, conditions et abri à la houle |
| Sous la baie (baie de Saint-Brieuc, de Binic à Erquy) | `plongee-baie/` | la même carte dans une mer à marée : hauteur d'eau à l'heure choisie (maintenant, basse mer, pleine mer, baie vidée), estran qui découvre, poissons de la Manche selon le milieu, natures de fond, épaves, parcours et limites des niveaux pour la mer du moment, conditions avec la courbe de marée |
| Mes randos (Corse, puis toute la France) | `corse/` | où je suis passé : tracés drapés sur le relief, profil, pente le long du chemin, altitude, sol et type de chemin (Komoot), survol ; lumière ; itinéraire à préparer |
| L'île et son lagon (Iheya, Okinawa) | `iheya/` | carte souvenir, à part du socle (sources japonaises) : photo du GSI avivée sur l'eau, l'île vers 1975 sous un curseur, relief en 3D (tuiles terrarium), sans fond « Relief » (trop grossier), vues de l'île |

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

Profil lié à la carte : `app.suiviProfil(svg, { x0, x1, total, ici(s), phrase })` branche un profil en long sur son
tracé. Le doigt (ou la souris) promené sur le profil pose un repère au même endroit sur la carte et dit ce qu'il y a là
(distance, altitude ou fond, pente) ; le repère reste posé quand on lâche, la vue s'y recentre s'il est hors champ, et
cela marche aussi sur la copie du profil en plein écran. Branché sur l'itinéraire commun (`socle/trace.js`), les randos,
le parcours de plongée et la route à la voile.

`socle/fonds.js` : fonds marins du Shom (modèle HOMONIM à 100 m, relu sur sa palette de couleurs), isobathes, profil
le long d'une route. `relais/lieux.py` prépare `voile/lieux.json` (ports, caps, îles, anses, feux de la BD TOPO, avec un
rang d'apparition) ; `relais/balises.py` prépare `voile/balises.json` (balises d'OpenStreetMap), à lancer à la main ou
par une tâche planifiée : tant que ce fichier manque, la carte interroge le service d'OpenStreetMap zone par zone.

`relais/randos.py` prépare `corse/randos.geojson` : les GPX de `corse/gpx/`, et tous les tours du compte Komoot qui
partent de France (hors de Corse, rognés de 400 m à chaque bout, le dépôt étant public) (secrets `KOMOOT_EMAIL` et `KOMOOT_PASSWORD`), avec le type de chemin et la nature du sol le long du
tracé. Les réponses de Komoot sont gardées dans `corse/komoot/` ; un numéro ajouté à `corse/komoot/ecartes.txt` écarte un
tour. La tâche « Randos » le relance chaque lundi, à chaque GPX déposé, ou à la demande.

`socle/plongee.js` (carte Plongée, transposable à un autre secteur) : le relief terre-mer du secteur remplace celui du
socle (protocole « plongee » : tuiles du dossier, relief mondial autour) ; le fond « vidé » est une image préparée
(sédiment, ombrage) ; l'eau est une règle de couleur sur le relief, calculée par la carte graphique, si bien que baisser
la mer, limiter à un niveau ou passer en teintes de profondeur ne recharge rien. Épaves en silhouettes couchées sur le
fond, tournées selon la fiche du Shom ; bancs de poissons attachés à des points d'habitat (le même banc au même endroit,
jamais à terre) ; abri à la houle par la longueur d'eau libre ; animation à douze images par seconde, arrêtée après une
minute sans geste. `relais/plongee_fonds.py` prépare
`plongee/relief/`, `plongee/fond/`, `fonds.json` et `habitats.json` à partir du Litto3D (Shom-IGN), du MNT HOMONIM, du
RGE ALTI et des natures de fond du Shom ; il se relance pour une autre emprise. Les herbiers de posidonie (inventaire de
l'OFB, Licence Ouverte) sont lus par le même script : ils teintent l'image du fond, donnent leur milieu aux points
d'habitat et sont écrits dans `plongee/herbiers.json`.

Le même script prépare un autre secteur (`--secteur=baie` pour `plongee-baie/`) : en Bretagne le fond vient du Litto3D
Bretagne 2018-2021, dont `relais/plongee_litto3d_bzh.py` ne rapatrie que le modèle à 5 m (archives 7z lues à distance
par requêtes partielles), et les natures de fond de la carte sédimentaire mondiale du Shom. Dans une mer à marée, la
carte reçoit `maree` : `socle/maree.js` (le calcul de la carte Marées : niveau de la mer d'Open-Meteo, prolongé par un
ajustement d'ondes de marée) donne le niveau de l'instant, et toutes les lectures (teintes, profil, limites des niveaux,
milieux des poissons) se font sous ce niveau. Au bord du secteur, le fond relevé rejoint le relief mondial sur 1,5 km.
Dans « Conditions », la mer devient claire et unie sous les quatre teintes d'abri, et des crêtes avancent dans le sens
des vagues (plus serrées quand la période est courte, effacées à l'abri).

`socle/arbres.js` : autour du centre de la vue, il repère chaque cime dans la hauteur du couvert (surface moins sol du
LiDAR HD) et dresse un arbre à sa hauteur ; le relevé suit la carte. Sur toutes les cartes et tous les fonds par le bouton
« Arbres » ; sur la carte de La Réunion aussi par le thème « Cimes » (famille Drone : hauteurs en couleurs, légende).

`socle/survol.js` : survol d'un tracé, la caméra suit le chemin et fait halte au départ, aux points hauts (nommés d'après
les lieux-dits de l'IGN) et à l'arrivée. Bouton « Survol » des outils de la carte, dès qu'une rando est choisie ou
qu'un itinéraire est tracé ; caméra rapprochée, barre de pause, d'allure et de halte suivante.

`socle/trace.js` (thème Itinéraire) sait suivre les sentiers : entre deux points posés, il demande le chemin au calcul
d'itinéraire piéton de l'IGN (BD TOPO). Thème « Préparer » sur les cartes Corse, Réunion, Champignons et Marées ; bouton
« Suivre les sentiers » (éteint au départ) dans l'itinéraire de la Tarentaise.

Plan IGN HD, trous en mer (`tuilePlan` du socle) : une plage blanche cernée de bleu aux trois quarts est repeinte en
mer ; une grande plage indécise près du niveau de la mer est tranchée par une petite grille d'altitudes de l'IGN (sans
valeur en mer). Le blanc d'un manque du plan à terre reste blanc. Relief : les altitudes aberrantes du bord de mer
(sous -12 m) sont écartées, elles creusaient des puits noirs en vue 3D.

Données : IGN (Géoplateforme), BRGM, Shom, OpenStreetMap, Open-Meteo. Versions de travail, à vérifier sur le terrain.
