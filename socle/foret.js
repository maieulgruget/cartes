/* « Quelle forêt ici ? » : peuplements de la BD Forêt de l'IGN, lus à la volée sur la vue affichée, avec leur légende. */
(function () {
  'use strict';
  const S = window.Socle;
  const GROUPES = [
    ['Feuillus', '#7fb069', 'feuillus mêlés'], ['Hêtre', '#a7c957', 'hêtre'], ['Chênes décidus', '#b5a642', 'chênes'], ['Châtaignier', '#c08552', 'châtaignier'],
    ['Mixte', '#4f9d8e', 'feuillus et conifères'], ['Sapin, épicéa', '#2f6690', 'sapin ou épicéa'], ['Mélèze', '#e0a458', 'mélèze'],
    ['Pin sylvestre', '#c9a227', 'pin sylvestre'], ['Pins mélangés', '#d4b943', 'pins'], ['Conifères', '#3a7ca5', 'autres conifères'], ['Douglas', '#5b7fb5', 'douglas'], ['NC', '#8d7b68', 'lande, pelouse, formation ouverte']
  ];
  function foret(opts) {
    opts = opts || {}; let cle = null;
    const q = {
      theme: 'Forêt', libelle: opts.libelle || 'Quelle forêt ici ?',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat">Touche une forêt pour connaître son peuplement.</p><div class="legende"></div><p class="petit">BD Forêt de l'IGN : elle décrit des peuplements, pas des arbres un par un. ${opts.note || ''}</p>`);
        const charger = async () => {
          if (app.map.getZoom() < 11) { c.querySelector('.etat').textContent = 'Zoome un peu pour afficher les forêts.'; return; }
          const b = app.emprise(0.1), k = b.map(v => v.toFixed(3)).join(); if (k === cle) return; cle = k;
          app.occupe(true, 'Lecture des forêts…');
          try {
            const r = await fetch(`${S.GEOPF}/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale&OUTPUTFORMAT=application/json&SRSNAME=CRS:84&BBOX=${b.join(',')},CRS:84&COUNT=3000&PROPERTYNAME=essence,tfv,geom`);
            const j = await r.json(); if (app.active !== q) return;
            if (app.map.getSource('bdforet')) app.map.getSource('bdforet').setData(j);
            else {
              app.map.addSource('bdforet', { type: 'geojson', data: j });
              app.map.addLayer({ id: 'bdforet', type: 'fill', source: 'bdforet', paint: { 'fill-color': ['match', ['get', 'essence'], ...GROUPES.flatMap(g => [g[0], g[1]]), '#6b8f71'], 'fill-opacity': 0.6 } }, 'analyses');
            }
            const vus = new Set(j.features.map(f => f.properties.essence));
            c.querySelector('.legende').innerHTML = GROUPES.filter(g => vus.has(g[0])).map(g => `<span><i style="background:${g[1]}"></i>${g[2]}</span>`).join('') + ([...vus].some(v => !GROUPES.some(g => g[0] === v)) ? '<span><i style="background:#6b8f71"></i>autres</span>' : '');
            if (!j.features.length) c.querySelector('.etat').textContent = 'Pas de forêt décrite dans cette vue.';
          } catch (e) { c.querySelector('.etat').textContent = 'Les forêts ne répondent pas pour l\'instant.'; }
          app.occupe(false);
        };
        app.suivre(q, charger); await charger();
      },
      toucher(app, ll) {
        if (!app.map.getLayer('bdforet')) return;
        const f = app.map.queryRenderedFeatures(app.map.project(ll), { layers: ['bdforet'] })[0];
        document.querySelector('.reponse .etat').innerHTML = f ? `<span class="fort">${app.propre(f.properties.tfv)}</span> (${app.propre(f.properties.essence)}).` : 'Ce point n\'est pas en forêt.';
      },
      fermer(app) { cle = null; app.retirer('bdforet'); }
    };
    return q;
  }
  S.foret = foret;
})();
