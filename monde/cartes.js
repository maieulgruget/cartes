// Une carte historique par pays.
// Deux façons de l'afficher :
//  - "flux" : la carte est déjà calée et diffusée en tuiles (WMTS/WMS) par un service public.
//  - "iiif" : un scan IIIF ; s'il a été calé dans Allmaps, il s'affiche tout seul,
//             sinon la fiche montre le scan et un lien pour le caler.
// Pour ajouter un pays : une entrée de plus, clé = code ISO à trois lettres.

export const CARTES = {
  FRA: {
    titre: 'Carte de Cassini',
    auteur: 'César-François Cassini de Thury',
    date: '1756–1815',
    phrase: 'Première carte de tout le royaume, levée par triangulation.',
    vue: { center: [2.4, 46.6], zoom: 6 },
    type: 'flux',
    tuiles: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI&STYLE=normal&TILEMATRIXSET=PM_6_14&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    minzoom: 6, maxzoom: 14,
    source: 'BnF / IGN, Géoplateforme',
    lien: 'https://gallica.bnf.fr/html/und/cartes/france-en-cartes/la-carte-de-cassini'
  },
  CHE: {
    titre: 'Carte Dufour',
    auteur: 'Guillaume-Henri Dufour',
    date: '1845–1865',
    phrase: 'Première carte officielle de la Suisse, célèbre pour ses hachures de relief.',
    vue: { center: [8.2, 46.8], zoom: 7.3 },
    type: 'flux',
    tuiles: 'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.swisstopo.hiks-dufour&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true',
    minzoom: 5, maxzoom: 16,
    source: 'swisstopo',
    lien: 'https://map.geo.admin.ch/?layers=ch.swisstopo.hiks-dufour'
  },
  JPN: {
    titre: 'Carte d’Inō Tadataka',
    auteur: 'Inō Tadataka',
    date: '1804',
    phrase: 'Premier relevé mesuré de l’archipel, fait à pied pendant dix-sept ans.',
    vue: { center: [139.5, 37.5], zoom: 5 },
    type: 'iiif',
    manifeste: 'https://www.loc.gov/item/2021668273/manifest.json',
    source: 'Library of Congress',
    lien: 'https://www.loc.gov/item/2021668273/'
  },
  GBR: {
    titre: 'The Kingdome of Great Britaine and Ireland',
    auteur: 'John Speed',
    date: '1611',
    phrase: 'Le premier atlas des îles britanniques, gravé par Jodocus Hondius.',
    vue: { center: [-4, 54.5], zoom: 4.8 },
    type: 'iiif',
    manifeste: null, // scan repéré à Princeton, manifeste IIIF à récupérer sur la page
    source: 'Princeton University Library',
    lien: 'https://maps.princeton.edu/catalog/princeton-9k41zg97s'
  },
  USA: {
    titre: 'Carte Mitchell',
    auteur: 'John Mitchell',
    date: '1755',
    phrase: 'La carte sur laquelle on a tracé les frontières du traité de Paris de 1783.',
    vue: { center: [-78, 39], zoom: 4 },
    type: 'iiif',
    manifeste: 'https://www.loc.gov/item/74693169/manifest.json',
    source: 'Library of Congress',
    lien: 'https://www.loc.gov/item/74693169/'
  }
};
