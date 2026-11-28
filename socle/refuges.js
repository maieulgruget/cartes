/* Thème « Refuges » : où dormir, où s'abriter. Les refuges gardés, cabanes et gîtes d'étape de refuges.info (données
   CC BY-SA 2.0, tenues par des bénévoles), lus pour la vue affichée. Toucher un refuge ouvre sa fiche : places, eau,
   bois, poêle, accès, remarques, date de la dernière mise à jour ; la fiche s'imprime, avec la carte autour.
   Réglages (opts) : theme, libelle, famille, types (identifiants refuges.info ; par défaut 10, 7, 9). */
(function () {
  'use strict';
  const S = window.Socle, API = 'https://www.refuges.info/api/bbox';
  // Types de refuges.info : identifiant, nom, couleur de la pastille.
  const TYPES = { 10: ['Refuge gardé', '#b3402e', 'refuges gardés'], 7: ['Cabane non gardée', '#2f7d5b', 'cabanes non gardées'], 9: ['Gîte d\'étape', '#2f6fa8', 'gîtes d\'étape'] };
  const EQUIP = [['eau', 'eau à proximité', 'pas d\'eau'], ['bois', 'bois à proximité', 'pas de bois'], ['poele', 'poêle', 'pas de poêle'], ['cheminee', 'cheminée', 'pas de cheminée'], ['couvertures', 'couvertures', 'pas de couvertures'], ['latrines', 'latrines', 'pas de latrines']];

  // Pictogramme : un abri (toit à deux pentes, porte) en blanc sur une pastille de la couleur du type.
  function images(map) {
    for (const [id, t] of Object.entries(TYPES)) {
      if (map.hasImage('refuge-' + id)) continue;
      const k = 3, c = document.createElement('canvas'); c.width = c.height = 28 * k; const x = c.getContext('2d'); x.scale(k, k);
      x.beginPath(); x.arc(14, 14, 11.5, 0, 2 * Math.PI); x.fillStyle = t[1]; x.fill(); x.lineWidth = 2; x.strokeStyle = '#ffffff'; x.stroke();
      x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(14, 6.5); x.lineTo(21.5, 19.5); x.lineTo(6.5, 19.5); x.closePath(); x.fill();
      x.fillStyle = t[1]; x.beginPath(); x.moveTo(14, 13.2); x.lineTo(16.6, 19.5); x.lineTo(11.4, 19.5); x.closePath(); x.fill();
      map.addImage('refuge-' + id, x.getImageData(0, 0, 28 * k, 28 * k), { pixelRatio: k });
    }
  }

  function theme(opts) {
    opts = opts || {};
    const types = opts.types || [10, 7, 9], masques = new Set();
    let tour = 0, lu = null, refuges = new Map(), choisi = null;
    const vide = { type: 'FeatureCollection', features: [] };
    const P = t => S.echapper ? S.echapper(t) : String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const texte = t => P(String(t || '').trim()).replace(/\n+/g, '<br>');
    const dateFr = t => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

    function dessiner(app) {
      const fc = { type: 'FeatureCollection', features: [...refuges.values()].filter(r => !masques.has(String(r.type))).map(r => ({ type: 'Feature', properties: { id: r.id, t: r.type, nom: r.nom, on: r.id === choisi ? 1 : 0 }, geometry: { type: 'Point', coordinates: r.p } })) };
      const m = app.map;
      if (m.getSource('refuges')) { m.getSource('refuges').setData(fc); return; }
      images(m);
      /* De loin, les refuges voisins se regroupent en une pastille qui porte leur nombre ; elle est rouge dès qu'elle
         contient un refuge gardé (celui qu'on cherche d'abord), verte sinon. Elle se défait en zoomant, ou d'un toucher. */
      m.addSource('refuges', { type: 'geojson', data: fc, cluster: true, clusterRadius: 44, clusterMaxZoom: 11, clusterProperties: { gardes: ['+', ['case', ['==', ['get', 't'], 10], 1, 0]] } });
      m.addLayer({ id: 'refuges-groupes', type: 'circle', source: 'refuges', filter: ['has', 'point_count'], paint: { 'circle-radius': ['step', ['get', 'point_count'], 13, 5, 16, 15, 20, 40, 24], 'circle-color': ['case', ['>', ['get', 'gardes'], 0], '#b3402e', '#2f7d5b'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': 0.95 } });
      m.addLayer({ id: 'refuges-nombre', type: 'symbol', source: 'refuges', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
      m.addLayer({ id: 'refuges-choisi', type: 'circle', source: 'refuges', filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'on'], 1]], paint: { 'circle-radius': 19, 'circle-color': '#ffffff', 'circle-opacity': 0.5, 'circle-stroke-color': '#b8963e', 'circle-stroke-width': 2.5 } });
      // Isolés : les refuges gardés passent devant les cabanes et les gîtes quand les noms se disputent la place.
      m.addLayer({ id: 'refuges', type: 'symbol', source: 'refuges', filter: ['!', ['has', 'point_count']], layout: { 'symbol-sort-key': ['match', ['get', 't'], 10, 0, 9, 1, 2], 'icon-image': ['concat', 'refuge-', ['to-string', ['get', 't']]], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1], 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 11.3, ['get', 'nom']], 'text-font': ['Source Sans Pro Regular'], 'text-size': 12.5, 'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 }, paint: { 'text-color': '#10192a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    }

    // Lecture de refuges.info pour la vue, un peu élargie ; rien n'est relu tant que la vue reste dans la zone déjà lue.
    async function charger(app, c) {
      const m = app.map, v = app.emprise(0);
      if (m.getZoom() < 8.5) { c.querySelector('.etat').textContent = 'Zoome sur un massif pour voir ses refuges.'; return; }
      if (lu && v[0] >= lu[0] && v[1] >= lu[1] && v[2] <= lu[2] && v[3] <= lu[3]) { dire(app, c); return; }
      const b = app.emprise(0.35), moi = ++tour;
      c.querySelector('.etat').textContent = 'Lecture des refuges…';
      let j = null;
      try { const r = await fetch(`${API}?bbox=${b.map(x => x.toFixed(4)).join(',')}&type_points=${types.join(',')}&format=geojson&detail=complet&format_texte=texte&nb_points=400`); if (r.ok) j = await r.json(); } catch (e) { j = null; }
      if (moi !== tour || app.active !== q) return;
      if (!j || !Array.isArray(j.features)) { c.querySelector('.etat').textContent = 'refuges.info ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      lu = b;
      for (const f of j.features) {
        const pr = f.properties || {}, g = f.geometry && f.geometry.coordinates, t = pr.type && +pr.type.id;
        if (!g || !TYPES[t]) continue;
        refuges.set(+pr.id, { id: +pr.id, type: t, nom: pr.nom || TYPES[t][0], p: [+g[0], +g[1]], alt: pr.coord && pr.coord.alt, pr });
      }
      dessiner(app); dire(app, c);
    }
    // La phrase et la liste : les refuges de la vue, du plus haut au plus bas.
    function dire(app, c) {
      const v = app.emprise(0), vus = [...refuges.values()].filter(r => !masques.has(String(r.type)) && r.p[0] >= v[0] && r.p[0] <= v[2] && r.p[1] >= v[1] && r.p[1] <= v[3]).sort((a, b) => (b.alt || 0) - (a.alt || 0));
      const n = t => vus.filter(r => r.type === t).length, parts = types.filter(t => n(t)).map(t => `${n(t)} ${n(t) > 1 ? TYPES[t][2] : TYPES[t][0].toLowerCase()}`);
      if (!choisi || !c.querySelector('.ref-fiche').innerHTML) c.querySelector('.etat').innerHTML = vus.length ? `Dans la vue : <span class="fort">${parts.join(', ')}</span>. Touche un refuge pour sa fiche.` : 'Aucun refuge connu de refuges.info dans cette vue.';
      c.querySelector('.ref-liste').innerHTML = vus.slice(0, 40).map(r => `<button data-id="${r.id}" aria-pressed="${r.id === choisi}">${P(r.nom)}<small>${TYPES[r.type][0]}${r.alt ? ' · ' + Math.round(r.alt) + ' m' : ''}</small></button>`).join('');
    }

    // La fiche d'un refuge, telle que refuges.info la tient.
    function corpsFiche(r) {
      const pr = r.pr, ic = pr.info_comp || {}, val = k => ic[k] && ic[k].valeur;
      const places = pr.places && +pr.places.valeur, matelas = ic.places_matelas && +ic.places_matelas.valeur;
      const oui = EQUIP.filter(e => val(e[0]) === 'Oui').map(e => e[1]), non = EQUIP.filter(e => val(e[0]) === 'Non').map(e => e[2]), inc = EQUIP.filter(e => val(e[0]) === 'Inconnu').map(e => e[1]);
      const etat = pr.etat && pr.etat.valeur, maj = dateFr(pr.date && pr.date.derniere_modif);
      return `<p><span class="fort">${TYPES[r.type][0]}</span>${r.alt ? ` · <span class="fort">${Math.round(r.alt)} m</span>` : ''}${places ? ` · <span class="fort">${places} place${places > 1 ? 's' : ''}</span>${matelas ? `, dont ${matelas} avec matelas` : matelas === 0 ? ', sans matelas' : ''}` : ''}${val('manque_un_mur') === 'Oui' ? ' · abri ouvert (il manque un mur)' : ''}</p>
        ${etat ? `<p><span class="fort">${texte(etat)}</span></p>` : ''}
        ${oui.length ? `<p>Sur place : ${oui.join(', ')}.</p>` : ''}${non.length ? `<p>Absent : ${non.join(', ')}.</p>` : ''}${inc.length ? `<p class="petit">Non renseigné : ${inc.join(', ')}.</p>` : ''}
        ${pr.proprio && pr.proprio.valeur ? `<p><b>${P(pr.proprio.nom || 'Propriétaire')}</b> : ${texte(pr.proprio.valeur)}</p>` : ''}
        ${pr.acces && pr.acces.valeur ? `<p><b>Accès</b> : ${texte(pr.acces.valeur)}</p>` : ''}
        ${pr.remarque && pr.remarque.valeur ? `<p><b>Remarques</b> : ${texte(pr.remarque.valeur)}</p>` : ''}
        <p class="petit">${maj ? `Fiche mise à jour le ${maj}. ` : ''}Source : refuges.info (CC BY-SA 2.0), tenue par des bénévoles : l'état d'une cabane change, à vérifier avant de compter dessus.</p>`;
    }
    function fiche(app, c, id, aller) {
      const r = refuges.get(id); if (!r) return;
      choisi = id; dessiner(app);
      c.querySelector('.etat').innerHTML = `<span class="fort">${P(r.nom)}</span>${r.alt ? ', ' + Math.round(r.alt) + ' m' : ''}.`;
      c.querySelector('.ref-fiche').innerHTML = `<h3 class="ref-h">${P(r.nom)}</h3>${corpsFiche(r)}
        <div class="puces"><button class="imp">Fiche à imprimer</button><button class="voir">Voir sur la carte</button>${r.pr.lien ? `<a class="lien" href="${P(r.pr.lien)}" target="_blank" rel="noopener">refuges.info ↗</a>` : ''}</div>`;
      c.querySelector('.ref-fiche .imp').onclick = () => imprimer(app, r);
      const voir = () => app.map.easeTo({ center: r.p, zoom: Math.max(app.map.getZoom(), 13.5), duration: 900 });
      c.querySelector('.ref-fiche .voir').onclick = voir; if (aller) voir();
      c.querySelectorAll('.ref-liste button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.id === id)));
    }

    // Fiche à imprimer : la carte cadrée sur le refuge, puis la fiche.
    async function imprimer(app, r) {
      const m = app.map, vue = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
      app.occupe(true, 'Préparation de la fiche…');
      const carte = document.querySelector('.reponse'); carte.style.visibility = 'hidden';
      m.jumpTo({ center: r.p, zoom: 14, pitch: 0, bearing: 0 });
      await Promise.race([new Promise(res => m.once('idle', res)), new Promise(res => setTimeout(res, 7000))]);
      const image = await new Promise(res => { m.once('render', () => { try { res(m.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (e) { res(''); } }); m.triggerRepaint(); });
      carte.style.visibility = ''; m.jumpTo(vue); app.occupe(false);
      let f = document.getElementById('fiche'); if (!f) { f = document.createElement('div'); f.id = 'fiche'; document.body.append(f); }
      f.innerHTML = `<h1>${P(r.nom)}</h1><p class="sous">${r.p[1].toFixed(5)}° N, ${r.p[0].toFixed(5)}° E · fiche préparée le ${new Date().toLocaleDateString('fr-FR')}</p>
        ${image ? `<img src="${image}" alt="Carte autour du refuge">` : ''}${corpsFiche(r)}${r.pr.lien ? `<p class="pied">${P(r.pr.lien)}</p>` : ''}`;
      setTimeout(() => window.print(), 150);
    }

    const q = {
      theme: opts.theme || 'Refuges', libelle: opts.libelle || 'Où dormir, où s\'abriter ?', famille: opts.famille,
      aide: 'Refuges gardés, cabanes non gardées et gîtes d\'étape recensés par refuges.info, lus pour la vue affichée. La fiche reprend ce que le site sait du lieu : places, eau, bois, poêle, accès, remarques, et la date de sa dernière mise à jour. Ces fiches sont tenues par des bénévoles : une cabane peut avoir été fermée, abîmée ou rénovée depuis. De loin, les refuges voisins sont regroupés en pastilles (rouges quand elles contiennent un refuge gardé) : zoome ou touche-les pour les défaire. Un refuge absent de refuges.info n\'apparaît pas.',
      async ouvrir(app) {
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p><div class="ref-liste"></div><div class="ref-fiche"></div><div class="legende"></div>`);
        app.legende(c, types.map(t => ({ cle: t, couleur: TYPES[t][1], texte: TYPES[t][0] })), () => { dessiner(app); dire(app, c); }, masques);
        c.querySelector('.ref-liste').onclick = e => { const b = e.target.closest('button[data-id]'); if (b) fiche(app, c, +b.dataset.id, true); };
        dessiner(app); if (choisi) fiche(app, c, choisi);
        app.suivre(q, () => charger(app, c)); await charger(app, c);
      },
      toucher(app, ll) {
        const m = app.map, pt = m.project(ll); if (!m.getLayer('refuges')) return;
        // Une pastille touchée s'ouvre : la carte zoome juste assez pour la défaire.
        const g = m.queryRenderedFeatures([[pt.x - 16, pt.y - 16], [pt.x + 16, pt.y + 16]], { layers: ['refuges-groupes'] })[0];
        if (g) { m.getSource('refuges').getClusterExpansionZoom(g.properties.cluster_id).then(z => m.easeTo({ center: g.geometry.coordinates, zoom: Math.min(z + 0.3, 14), duration: 700 })).catch(() => { }); return; }
        const f = m.queryRenderedFeatures([[pt.x - 16, pt.y - 16], [pt.x + 16, pt.y + 16]], { layers: ['refuges'] })[0];
        if (f) fiche(app, q._c, +f.properties.id);
      },
      plein: () => ({ bloc: ['.ref-liste', '.ref-fiche'], consigne: 'Touche un refuge pour sa fiche.' }),
      fermer(app) { tour++; app.retirer('refuges-nombre', 'refuges-groupes', 'refuges-choisi', 'refuges'); }
    };
    return q;
  }
  S.refuges = { theme };
})();
