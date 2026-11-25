/* Thème « Cimes » : les arbres un par un. Autour du centre de la vue (200 m de rayon), on lit le LiDAR HD de l'IGN deux
   fois, surface et sol nu, à un point par mètre ; leur différence est la hauteur du couvert. Chaque sommet local de ce
   couvert est pris pour une cime, et la carte y dresse un arbre à la hauteur mesurée (silhouette type, vert de feuillage ; couleur par classe de hauteur sur demande).
   Pensé pour préparer un vol de drone : où sont les arbres hauts, et jusqu'où montent-ils. */
(function () {
  'use strict';
  const S = window.Socle;
  const CLASSES = [[3, '#b5d86a', '3 à 5 m'], [5, '#7fb069', '5 à 10 m'], [10, '#3f8f5a', '10 à 20 m'], [20, '#e0a458', '20 à 30 m'], [30, '#e63946', 'plus de 30 m']];
  const classe = h => { let j = 0; while (j < CLASSES.length - 1 && h >= CLASSES[j + 1][0]) j++; return j; };

  // Cimes d'une grille de hauteurs de couvert : sommets locaux d'au moins 3 m, plus hauts que leur entourage.
  function reperer(mns, mnt, pente) {
    const { w, h, pas } = mns, n = w * h, brut = new Float32Array(n), c = new Float32Array(n);
    for (let k = 0; k < n; k++) { const d = mns.z[k] - mnt.z[k]; brut[k] = d > 0 && d < 70 ? d : 0; }
    // moyenne sur neuf points : une cime est une forme, pas un retour isolé du laser
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i; c[k] = (brut[k - w - 1] + brut[k - w] + brut[k - w + 1] + brut[k - 1] + brut[k] + brut[k + 1] + brut[k + w - 1] + brut[k + w] + brut[k + w + 1]) / 9; }
    const cimes = [];
    for (let j = 4; j < h - 4; j++) for (let i = 4; i < w - 4; i++) {
      const k = j * w + i, v = c[k]; if (v < 3) continue;
      const r = Math.max(2, Math.min(5, Math.round((1.2 + 0.06 * v) / pas)));   // un grand arbre écarte ses voisines plus loin
      if (i < r || j < r || i >= w - r || j >= h - r) continue;
      let sommet = true;
      for (let dj = -r; dj <= r && sommet; dj++) for (let di = -r; di <= r; di++) { const q = c[k + dj * w + di]; if (q > v || (q === v && (dj < 0 || (dj === 0 && di < 0)))) { sommet = false; break; } }
      if (!sommet) continue;
      // Un toit plat, une falaise ne sont pas des arbres : la cime doit dépasser nettement son pourtour.
      const tour = (c[k - r * w] + c[k + r * w] + c[k - r] + c[k + r] + c[k - r * w - r] + c[k - r * w + r] + c[k + r * w - r] + c[k + r * w + r]) / 8;
      if (v - tour < Math.max(0.4, 0.06 * v)) continue;
      if (pente && pente[k] > 55) continue;   // sur une paroi, la différence entre surface et sol ne mesure plus un arbre
      const [lon, lat] = S.versGeo(mns.x0 + (i + 0.5) * (mns.x1 - mns.x0) / w, mns.y1 - (j + 0.5) * (mns.y1 - mns.y0) / h);
      cimes.push({ lon, lat, h: brut[k] > v ? brut[k] : v, sol: mnt.z[k] });
    }
    return cimes;
  }

  /* Silhouette d'un arbre : un tronc mince, puis un houppier en fuseau fait de sept tranches à dix côtés, étroit en bas,
     large au tiers, effilé vers la cime. Le houppier reste plus étroit que l'écart entre deux cimes voisines : les
     arbres ne se fondent pas en blocs. Chaque arbre porte deux teintes : un vert de feuillage (trois nuances, pour que
     la forêt ne soit pas un aplat) et la couleur de sa classe de hauteur, que le thème affiche sur demande. */
  const TRANCHES = [[0.30, 0.40, 0.6], [0.40, 0.52, 0.9], [0.52, 0.64, 1], [0.64, 0.75, 0.88], [0.75, 0.85, 0.68], [0.85, 0.93, 0.45], [0.93, 1, 0.2]];
  const VERTS = ['#4c7a48', '#5d8a50', '#3f6b45'];
  function volumes(cimes) {
    const f = [];
    cimes.forEach((a, n) => {
      const rayon = Math.min(3.2, 0.7 + 0.08 * a.h), kx = 1 / (111320 * Math.cos(a.lat * Math.PI / 180)), ky = 1 / 110540, j = classe(a.h), vert = VERTS[(n * 7 + Math.round(a.h)) % 3];
      f.push({ type: 'Feature', properties: { n, c: j, base: 0, haut: a.h * 0.32, vert: '#6b5744', couleur: '#6b5744' }, geometry: { type: 'Polygon', coordinates: [anneau(a, Math.max(0.2, rayon * 0.1), kx, ky)] } });   // le tronc
      for (const [b, t, part] of TRANCHES) f.push({ type: 'Feature', properties: { n, c: j, base: a.h * b, haut: a.h * t, vert, couleur: CLASSES[j][1] }, geometry: { type: 'Polygon', coordinates: [anneau(a, rayon * part, kx, ky)] } });
    });
    return { type: 'FeatureCollection', features: f };
  }
  const anneau = (a, r, kx, ky) => { const p = []; for (let i = 0; i <= 10; i++) { const t = i % 10 * Math.PI / 5; p.push([a.lon + r * Math.cos(t) * kx, a.lat + r * Math.sin(t) * ky]); } return p; };

  /* La couche d'arbres d'une carte : une seule par carte, partagée par le bouton « Arbres » des outils et par le thème
     « Cimes ». Allumée, elle relève les arbres autour du centre de la vue et refait le relevé d'elle-même quand la carte
     s'est déplacée de près d'un demi-carré (ou qu'on a zoomé assez pour qu'il devienne possible). Elle reste allumée d'un
     thème à l'autre, jusqu'à ce qu'on l'éteigne. */
  const RAYON = 200;
  function couche(app) {
    if (app._arbres) return app._arbres;
    const m = app.map, masques = new Set();
    let tour = 0, minuterie = null, dernier = null;
    const c = {
      actif: false, arbres: [], parHauteur: false, message: '', masques, rayon: RAYON, surChange: [],
      teinter() { if (m.getLayer('cimes3d')) m.setPaintProperty('cimes3d', 'fill-extrusion-color', ['get', c.parHauteur ? 'couleur' : 'vert']); },
      filtrer() { if (m.getLayer('cimes3d')) m.setFilter('cimes3d', masques.size ? ['!', ['in', ['get', 'c'], ['literal', [...masques].map(Number)]]] : null); },
      async activer(oui) {
        if (oui === c.actif) return;
        c.actif = oui;
        if (!oui) { tour++; app.retirer('cimes3d', 'cimes-zone'); app.forcerSolNu(false); c.arbres = []; c.message = ''; dernier = null; prevenir(); return; }
        app.forcerSolNu(true); if (!app.relief3d) app.mettre3d(true);   // les arbres se posent sur le sol nu, pas sur le couvert en volume
        prevenir(); await c.relever();
      },
      // Le relevé : lecture du LiDAR autour du centre de la vue, repérage, dessin.
      async relever() {
        const moi = ++tour;
        if (m.getZoom() < 15) { if (!c.arbres.length) { c.message = 'Zoome de plus près (un hameau, une ravine) : les arbres se dresseront autour du centre de la vue.'; prevenir(); } return; }
        const ctr = m.getCenter(), dx = RAYON / (111320 * Math.cos(ctr.lat * Math.PI / 180)), dy = RAYON / 110540, b = [ctr.lng - dx, ctr.lat - dy, ctr.lng + dx, ctr.lat + dy];
        app.occupe(true, 'Relevé des arbres…');
        let mns, mnt;
        try { [mns, mnt] = await Promise.all([app.grille(b, 2 * RAYON, { surface: true }), app.grille(b, 2 * RAYON)]); }
        catch (e) { if (moi === tour) { app.occupe(false); c.message = 'Le LiDAR ne répond pas pour l\'instant.'; prevenir(); } return; }
        if (moi !== tour) return; app.occupe(false); if (!c.actif) return;
        c.arbres = reperer(mns, mnt, app.pentes(mnt).pente); dernier = [ctr.lng, ctr.lat];
        const zone = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]] } };
        if (m.getSource('cimes3d')) { m.getSource('cimes3d').setData(volumes(c.arbres)); m.getSource('cimes-zone').setData(zone); }
        else {
          m.addSource('cimes-zone', { type: 'geojson', data: zone });
          m.addLayer({ id: 'cimes-zone', type: 'line', source: 'cimes-zone', paint: { 'line-color': '#b8963e', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } });
          m.addSource('cimes3d', { type: 'geojson', data: volumes(c.arbres) });
          m.addLayer({ id: 'cimes3d', type: 'fill-extrusion', source: 'cimes3d', paint: { 'fill-extrusion-color': ['get', c.parHauteur ? 'couleur' : 'vert'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'haut'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
        }
        c.filtrer(); c.message = c.arbres.length ? '' : 'Aucun arbre de plus de 3 m dans ce carré.'; prevenir();
      }
    };
    const prevenir = () => { for (const f of c.surChange) { try { f(c); } catch (e) { console.error(e); } } };
    // Suivi de la carte : on refait le relevé quand le centre a quitté le cœur du carré.
    m.on('moveend', () => {
      if (!c.actif) return; clearTimeout(minuterie);
      minuterie = setTimeout(() => { if (!c.actif || m.getZoom() < 15) return; const ctr = m.getCenter(); if (!dernier || app.distKm(dernier, [ctr.lng, ctr.lat]) * 1000 > RAYON * 0.45) c.relever(); }, 600);
    });
    app._arbres = c; return c;
  }

  function cimes(opts) {
    opts = opts || {};
    let ctl = null, suivi = null;
    // Le panneau : la phrase de réponse et la légende, d'après les arbres présents sur la carte.
    function decrire(app, c) {
      const etat = c.querySelector('.etat'), leg = c.querySelector('.legende'), arbres = ctl.arbres;
      c.querySelector('.oter').textContent = ctl.actif ? 'Retirer les arbres' : 'Dresser les arbres';
      if (!arbres.length) { etat.textContent = ctl.message || (ctl.actif ? 'Relevé des arbres…' : 'Arbres retirés.'); leg.innerHTML = ''; return; }
      const hs = arbres.map(a => a.h).sort((x, y) => x - y), haut = arbres.reduce((x, y) => y.h > x.h ? y : x), compte = CLASSES.map(() => 0); arbres.forEach(a => compte[classe(a.h)]++);
      etat.innerHTML = `<span class="fort">${arbres.length.toLocaleString('fr-FR')} arbres</span> dans un carré de ${2 * RAYON} m. Le plus haut : <span class="fort">${Math.round(haut.h)} m</span> (cime à ${Math.round(haut.sol + haut.h)} m d'altitude) ; un sur deux dépasse ${Math.round(hs[hs.length >> 1])} m.`;
      app.legende(c, CLASSES.map((k, j) => ({ cle: j, couleur: k[1], texte: `${k[2]} · ${compte[j]}` })).filter((it, j) => compte[j]), () => ctl.filtrer(), ctl.masques);
    }
    const q = {
      theme: 'Cimes', libelle: opts.libelle || 'Quelle hauteur, ces arbres ?',
      aide: 'Autour du centre de la vue, la carte lit le LiDAR HD deux fois (la surface, puis le sol nu) : la différence est la hauteur du couvert. Chaque sommet de ce couvert est pris pour une cime, et dressé en arbre à sa hauteur : la silhouette est la même pour tous, seule la taille est mesurée. Le relevé suit la carte : il se refait quand on la déplace. Dans une forêt serrée, plusieurs arbres peuvent n\'en faire qu\'un, et un grand houppier en donner deux ; un pylône, un rocher isolé peuvent passer pour un arbre. Le relevé a quelques années : un arbre a pu pousser ou tomber. Pour un vol, garder une marge. Les arbres restent sur la carte quand on change de thème, jusqu\'à « Retirer les arbres ».',
      async ouvrir(app) {
        ctl = couche(app);
        const c = app.repondre(q.libelle, `<p class="etat">Relevé des arbres…</p>
          <div class="puces"><button class="teinte" aria-pressed="${ctl.parHauteur}">Hauteurs en couleurs</button><button class="oter">Retirer les arbres</button></div><div class="legende"></div>
          <p class="petit">Cimes repérées dans le LiDAR HD de l'IGN, dans un carré de ${2 * RAYON} m autour du centre de la vue ; le relevé se refait quand la carte se déplace. Touche un arbre pour sa hauteur, une classe de la légende pour la masquer.</p>`);
        c.querySelector('.teinte').onclick = e => { ctl.parHauteur = !ctl.parHauteur; e.currentTarget.setAttribute('aria-pressed', ctl.parHauteur); ctl.teinter(); };
        c.querySelector('.oter').onclick = () => ctl.activer(!ctl.actif);
        suivi = () => { if (app.active === q) decrire(app, c); }; ctl.surChange.push(suivi);
        decrire(app, c); if (!ctl.actif) await ctl.activer(true);
      },
      toucher(app, ll) {
        let mieux = null, dmin = 9; for (const a of ctl.arbres) { const d = app.distKm([a.lon, a.lat], [ll.lng, ll.lat]) * 1000; if (d < dmin) { dmin = d; mieux = a; } }
        if (!mieux) { app.sansBulle(); return; }
        app.bulle({ lng: mieux.lon, lat: mieux.lat }, `<span class="fort">${mieux.h.toFixed(1).replace('.', ',')} m</span> de haut<small>cime à ${Math.round(mieux.sol + mieux.h)} m d'altitude, sol à ${Math.round(mieux.sol)} m</small>`);
      },
      fermer() { if (ctl && suivi) ctl.surChange.splice(ctl.surChange.indexOf(suivi), 1); suivi = null; }   // les arbres restent sur la carte
    };
    return q;
  }
  S.arbres = { cimes, couche, reperer };

})();
