/* Thème « Cimes » : les arbres un par un. Autour du centre de la vue (200 m de rayon), on lit le LiDAR HD de l'IGN deux
   fois, surface et sol nu, à un point par mètre ; leur différence est la hauteur du couvert. Chaque sommet local de ce
   couvert est pris pour une cime, et la carte y dresse un cône à la hauteur mesurée, coloré par classe de hauteur.
   Pensé pour préparer un vol de drone : où sont les arbres hauts, et jusqu'où montent-ils. */
(function () {
  'use strict';
  const S = window.Socle;
  const CLASSES = [[3, '#b5d86a', '3 à 5 m'], [5, '#7fb069', '5 à 10 m'], [10, '#3f8f5a', '10 à 20 m'], [20, '#e0a458', '20 à 30 m'], [30, '#e63946', 'plus de 30 m']];
  const classe = h => { let j = 0; while (j < CLASSES.length - 1 && h >= CLASSES[j + 1][0]) j++; return j; };

  // Cimes d'une grille de hauteurs de couvert : sommets locaux d'au moins 3 m, plus hauts que leur entourage.
  function reperer(mns, mnt) {
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
      const [lon, lat] = S.versGeo(mns.x0 + (i + 0.5) * (mns.x1 - mns.x0) / w, mns.y1 - (j + 0.5) * (mns.y1 - mns.y0) / h);
      cimes.push({ lon, lat, h: brut[k] > v ? brut[k] : v, sol: mnt.z[k] });
    }
    return cimes;
  }

  // Un cône approché par trois étages de prismes à huit côtés, du houppier large à la pointe.
  const ETAGES = [[0.12, 0.5, 1], [0.5, 0.8, 0.62], [0.8, 1, 0.28]];
  function volumes(cimes) {
    const f = [];
    cimes.forEach((a, n) => {
      const rayon = Math.min(5.5, 0.9 + 0.14 * a.h), kx = 1 / (111320 * Math.cos(a.lat * Math.PI / 180)), ky = 1 / 110540, j = classe(a.h);
      f.push({ type: 'Feature', properties: { n, c: j, base: 0, haut: a.h * 0.14, couleur: '#6b4f3a' }, geometry: { type: 'Polygon', coordinates: [anneau(a, 0.35, kx, ky)] } });   // le tronc
      for (const [b, t, part] of ETAGES) f.push({ type: 'Feature', properties: { n, c: j, base: a.h * b, haut: a.h * t, couleur: CLASSES[j][1] }, geometry: { type: 'Polygon', coordinates: [anneau(a, rayon * part, kx, ky)] } });
    });
    return { type: 'FeatureCollection', features: f };
  }
  const anneau = (a, r, kx, ky) => { const p = []; for (let i = 0; i <= 8; i++) { const t = i % 8 * Math.PI / 4; p.push([a.lon + r * Math.cos(t) * kx, a.lat + r * Math.sin(t) * ky]); } return p; };

  function cimes(opts) {
    opts = opts || {};
    const RAYON = opts.rayon || 200, masques = new Set();
    let arbres = [], tour = 0;
    const filtrer = app => { if (app.map.getLayer('cimes3d')) app.map.setFilter('cimes3d', masques.size ? ['!', ['in', ['get', 'c'], ['literal', [...masques].map(Number)]]] : null); };
    async function calculer(app, c) {
      const moi = ++tour, m = app.map, etat = c.querySelector('.etat');
      if (m.getZoom() < 15) { etat.textContent = 'Zoome de plus près (un hameau, une ravine), puis touche « Relever ici ».'; return; }
      const ctr = m.getCenter(), dx = RAYON / (111320 * Math.cos(ctr.lat * Math.PI / 180)), dy = RAYON / 110540, b = [ctr.lng - dx, ctr.lat - dy, ctr.lng + dx, ctr.lat + dy];
      app.occupe(true, 'Lecture du LiDAR…');
      let mns, mnt;
      try { [mns, mnt] = await Promise.all([app.grille(b, 2 * RAYON, { surface: true }), app.grille(b, 2 * RAYON)]); }
      catch (e) { app.occupe(false); if (moi === tour) etat.textContent = 'Le LiDAR ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      arbres = reperer(mns, mnt);
      const zone = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]] } };
      if (m.getSource('cimes3d')) { m.getSource('cimes3d').setData(volumes(arbres)); m.getSource('cimes-zone').setData(zone); }
      else {
        m.addSource('cimes-zone', { type: 'geojson', data: zone });
        m.addLayer({ id: 'cimes-zone', type: 'line', source: 'cimes-zone', paint: { 'line-color': '#b8963e', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
        m.addSource('cimes3d', { type: 'geojson', data: volumes(arbres) });
        m.addLayer({ id: 'cimes3d', type: 'fill-extrusion', source: 'cimes3d', paint: { 'fill-extrusion-color': ['get', 'couleur'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'haut'], 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
      }
      filtrer(app);
      if (!arbres.length) { etat.textContent = 'Aucun arbre de plus de 3 m relevé dans ce carré.'; c.querySelector('.legende').innerHTML = ''; return; }
      const hs = arbres.map(a => a.h).sort((x, y) => x - y), haut = arbres.reduce((x, y) => y.h > x.h ? y : x), compte = CLASSES.map(() => 0); arbres.forEach(a => compte[classe(a.h)]++);
      etat.innerHTML = `<span class="fort">${arbres.length.toLocaleString('fr-FR')} arbres</span> dans un carré de ${2 * RAYON} m. Le plus haut : <span class="fort">${Math.round(haut.h)} m</span> (cime à ${Math.round(haut.sol + haut.h)} m d'altitude) ; un sur deux dépasse ${Math.round(hs[hs.length >> 1])} m.`;
      app.legende(c, CLASSES.map((k, j) => ({ cle: j, couleur: k[1], texte: `${k[2]} · ${compte[j]}` })).filter((it, j) => compte[j]), () => filtrer(app), masques);
    }
    const q = {
      theme: 'Cimes', libelle: opts.libelle || 'Quelle hauteur, ces arbres ?',
      aide: 'Autour du centre de la vue, la carte lit le LiDAR HD deux fois (la surface, puis le sol nu) : la différence est la hauteur du couvert. Chaque sommet de ce couvert est pris pour une cime, et dressé en cône à sa hauteur. Dans une forêt serrée, plusieurs arbres peuvent n\'en faire qu\'un, et un grand houppier en donner deux ; un pylône, un rocher isolé peuvent passer pour un arbre. Le relevé a quelques années : un arbre a pu pousser ou tomber. Pour un vol, garder une marge.',
      async ouvrir(app) {
        app.forcerSolNu(true); if (!app.relief3d) app.mettre3d(true);   // les cônes se posent sur le sol nu, pas sur le couvert en volume
        const c = app.repondre(q.libelle, `<p class="etat">Relevé des arbres…</p><div class="puces"><button class="ici">Relever ici</button></div><div class="legende"></div>
          <p class="petit">Cimes repérées dans le LiDAR HD de l'IGN, dans un carré de ${2 * RAYON} m autour du centre de la vue. Touche un arbre pour sa hauteur, une classe de la légende pour la masquer.</p>`);
        q._c = c; c.querySelector('.ici').onclick = () => calculer(app, c);
        await calculer(app, c);
      },
      toucher(app, ll) {
        let mieux = null, dmin = 9; for (const a of arbres) { const d = app.distKm([a.lon, a.lat], [ll.lng, ll.lat]) * 1000; if (d < dmin) { dmin = d; mieux = a; } }
        if (!mieux) { app.sansBulle(); return; }
        app.bulle({ lng: mieux.lon, lat: mieux.lat }, `<span class="fort">${mieux.h.toFixed(1).replace('.', ',')} m</span> de haut<small>cime à ${Math.round(mieux.sol + mieux.h)} m d'altitude, sol à ${Math.round(mieux.sol)} m</small>`);
      },
      fermer(app) { tour++; app.retirer('cimes3d', 'cimes-zone'); app.forcerSolNu(false); arbres = []; }
    };
    return q;
  }
  S.arbres = { cimes, reperer };
})();
