/* Thème « Baleines » : où et quand voir baleines et dauphins. Commun à toutes les cartes qui ont de la mer et des
   données de cétacés ; chaque carte apporte ses espèces, ses données, ses règles d'approche.

   Deux façons de dire « où » selon les données disponibles :
   - avec une grille d'effort (La Réunion, Globice : kilomètres parcourus en prospection par maille de 2 km) : les
     mailles où l'on voit l'espèce le plus souvent, en observations pour 100 km parcourus, lissées vers la moyenne ;
   - sans effort connu (Méditerranée, signalements rassemblés par GBIF) : la part de l'espèce parmi les cétacés
     signalés dans chaque maille. Une part compare les espèces entre elles et gomme en bonne partie le poids des
     observateurs (beaucoup de bateaux = beaucoup de signalements de toutes espèces) ; elle dit où une espèce domine,
     pas combien il y a d'animaux.
   Le mois : avec des sorties connues, les observations par sortie ; sinon, la part de l'espèce parmi les cétacés
   signalés ce mois-là. Les animaux en mouvement sont un décor, qui nage dans les mailles favorables.

   Données attendues (JSON) :
     obs     [[lon, lat, espèce, année, mois, nombre, petits], …]
     grille  facultatif : [[lon, lat, km, n_esp1, n_esp2, …, années, (géométrie si découpée par la côte)], …]
     sorties facultatif : sorties en mer par mois (12 nombres)
   Réglages (opts) :
     url, theme, libelle, famille, especes [{ k, nom, note, col (colonne de grille), dessin, vignette }],
     regles (HTML replié sous une ligne), aide, source (ligne de pied), vue ({ center, zoom }) où aller si la mer est
     loin, maille (degrés, sans grille ; 0,05 par défaut), lignes (GeoJSON de limites à tracer, avec leur nom). */
(function () {
  'use strict';
  const RAD = Math.PI / 180;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ---------- Silhouettes ----------
     De profil pour la liste (vignettes), de dessus pour la carte (posées à plat sur la mer, tournées dans le sens de la nage). */
  const VIGNETTE = {
    bosse: '<path d="M4 24c6-6 15-8 22-6 3 1 5 3 7 3l4-4-1 6 3 3-5-1c-3 2-7 3-12 3-7 0-13-1-18-4z" fill="#3c4a5c"/><path d="M13 25l-3 7 6-6z" fill="#e8eef3"/><path d="M5 24.5c5 1.5 11 1.5 16 .5" stroke="#cfd8e0" stroke-width="1" fill="none"/>',
    rorqual: '<path d="M2 23c7-3 16-4 25-3l2-2 1 3c2 0 4 1 6 1l3-3-1 4 2 3-4-1c-6 2-16 2-34-2z" fill="#4a5867"/><path d="M3 23.4c9 1.3 20 1.4 31 .4" stroke="#d3dbe2" stroke-width="1" fill="none"/>',
    cachalot: '<path d="M3 18c0-3 4-4 13-4 8 0 14 3 18 6l3-3v5l2 3-4-1c-5 2-13 3-21 3-7 0-11-2-11-5z" fill="#4b4642"/><path d="M5 24h8" stroke="#e8e2dc" stroke-width="1"/>',
    globi: '<path d="M4 22c0-4 3-6 9-6 6 0 11 1 14 3l2-4 1 5c3 1 5 2 7 2l3-3-1 5 2 2-4 0c-7 2-18 3-33-4z" fill="#1f2328"/>',
    risso: '<path d="M4 22c0-3 3-5 8-5 7 0 13 1 15 2l2-5 1 6c3 1 5 2 7 2l3-3-1 5 2 2-4 0c-7 2-18 3-33-4z" fill="#8b949c"/><path d="M10 19l6 3M15 18l5 4M20 19l4 3" stroke="#e9edf0" stroke-width=".8"/>',
    ziphius: '<path d="M4 22c4-3 11-4 20-3l2-2 1 3c3 1 6 1 9 1l3-3-1 4 2 3-4-1c-8 2-20 3-32-2z" fill="#7a6a58"/><path d="M4 22c1-2 3-3 5-3" stroke="#e8e0d4" stroke-width="1.5" fill="none"/>',
    dauphin: '<path d="M5 22c5-4 13-5 20-3l3-5 1 6c3 1 5 2 7 2l3-3-1 5 2 2-4 0c-6 2-16 3-31-4z" fill="#7d8a96"/><path d="M5 22c8 3 18 3 26 1" stroke="#c9d2da" stroke-width="1.2" fill="none"/>',
    longbec: '<path d="M3 22c6-3 13-4 21-3l3-4 1 5c3 1 6 2 9 2l2-3v4l2 2h-4c-7 2-18 2-34-3z" fill="#5d6b7b"/><path d="M4 22.5c9 2 20 2 29 .5" stroke="#d7dde3" stroke-width="1" fill="none"/>',
    bleublanc: '<path d="M3 22c6-3 13-4 21-3l3-4 1 5c3 1 6 2 9 2l2-3v4l2 2h-4c-7 2-18 2-34-3z" fill="#4e6178"/><path d="M8 23q8-3 16 1" stroke="#e9eef3" stroke-width="1.6" fill="none"/>',
    tachete: '<path d="M4 22c6-3 13-4 21-3l3-4 1 5c3 1 6 2 9 2l2-3v4l2 2h-4c-7 2-18 2-34-3z" fill="#4f5d6e"/><g fill="#dfe6ec"><circle cx="12" cy="21" r=".7"/><circle cx="16" cy="20" r=".6"/><circle cx="20" cy="21.5" r=".7"/><circle cx="24" cy="20.5" r=".6"/><circle cx="14" cy="23" r=".5"/></g>',
    autre: '<path d="M3 23c4-5 12-7 22-6 4 0 7 2 9 2l4-3-1 5 2 3-5-1c-4 2-10 3-16 3-6 0-11-1-15-3z" fill="#2f3a46"/><path d="M14 17l1-3 2 3z" fill="#2f3a46"/>'
  };
  const vignette = v => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="7" fill="#cfe3ee"/><path d="M0 28q10-3 20 0t20 0v12H0z" fill="#8fbcd4"/>${VIGNETTE[v] || VIGNETTE.autre}</svg>`;
  // Vues de dessus, dessinées une fois sur un canevas (le nez vers le haut de l'image).
  function dessiner(type) {
    const petit = type === 'dau' || type === 'globi', W = 64, H = petit ? 64 : 128, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), ecume = (x, y, rx, ry, a) => { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI); g.fill(); };
    const caudale = (y, coul) => { g.fillStyle = coul; g.beginPath(); g.moveTo(32, y); g.quadraticCurveTo(44, y + 6, 52, y + 20); g.quadraticCurveTo(40, y + 14, 32, y + 12); g.quadraticCurveTo(24, y + 14, 12, y + 20); g.quadraticCurveTo(20, y + 6, 32, y); g.fill(); };
    if (type === 'dos') {   // baleine à bosse : corps trapu, très longues nageoires pectorales blanches
      ecume(32, 66, 22, 56, 0.28); g.fillStyle = '#2b3846';
      g.beginPath(); g.moveTo(32, 10); g.bezierCurveTo(46, 14, 47, 48, 42, 76); g.bezierCurveTo(38, 96, 35, 104, 32, 108); g.bezierCurveTo(29, 104, 26, 96, 22, 76); g.bezierCurveTo(17, 48, 18, 14, 32, 10); g.fill();
      g.fillStyle = '#dfe7ee';
      g.beginPath(); g.moveTo(41, 40); g.quadraticCurveTo(58, 56, 60, 78); g.quadraticCurveTo(52, 62, 40, 50); g.fill();
      g.beginPath(); g.moveTo(23, 40); g.quadraticCurveTo(6, 56, 4, 78); g.quadraticCurveTo(12, 62, 24, 50); g.fill();
      caudale(104, '#2b3846'); g.fillStyle = '#4a5b6c'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(32, 16 + i * 5, 1.3, 0, 2 * Math.PI); g.fill(); }
    } else if (type === 'rorqual') {   // rorqual commun : long et fin, petites pectorales, tête plate en V
      ecume(32, 64, 14, 60, 0.25); g.fillStyle = '#3e4b58';
      g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(41, 10, 41, 46, 38, 80); g.bezierCurveTo(36, 98, 34, 106, 32, 110); g.bezierCurveTo(30, 106, 28, 98, 26, 80); g.bezierCurveTo(23, 46, 23, 10, 32, 4); g.fill();
      g.beginPath(); g.moveTo(38, 40); g.lineTo(46, 52); g.lineTo(37, 48); g.fill(); g.beginPath(); g.moveTo(26, 40); g.lineTo(18, 52); g.lineTo(27, 48); g.fill();
      caudale(106, '#3e4b58'); g.strokeStyle = '#5d6c7a'; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 8); g.lineTo(32, 30); g.stroke();
    } else if (type === 'cachalot') {   // cachalot : tête massive et carrée, peau ridée
      ecume(32, 64, 20, 58, 0.25); g.fillStyle = '#433d39';
      g.beginPath(); g.moveTo(22, 8); g.lineTo(42, 8); g.bezierCurveTo(46, 10, 45, 50, 41, 78); g.bezierCurveTo(38, 96, 35, 104, 32, 108); g.bezierCurveTo(29, 104, 26, 96, 23, 78); g.bezierCurveTo(19, 50, 18, 10, 22, 8); g.fill();
      caudale(104, '#433d39'); g.strokeStyle = '#5a534d'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(26, 58 + i * 6); g.lineTo(38, 58 + i * 6); g.stroke(); }
    } else if (type === 'queue' || type === 'queuenoire') {   // caudale qui sort de l'eau avant la plongée
      const coul = type === 'queue' ? '#2b3846' : '#433d39';
      ecume(32, 104, 22, 10, 0.45); g.fillStyle = coul;
      g.beginPath(); g.moveTo(32, 104); g.quadraticCurveTo(30, 70, 32, 58); g.quadraticCurveTo(34, 70, 34, 104); g.fill();
      g.beginPath(); g.moveTo(33, 60); g.quadraticCurveTo(46, 52, 62, 30); g.quadraticCurveTo(48, 40, 33, 46); g.quadraticCurveTo(18, 40, 2, 30); g.quadraticCurveTo(18, 52, 31, 60); g.fill();
      if (type === 'queue') { g.fillStyle = '#e9eef2'; g.beginPath(); g.moveTo(33, 50); g.quadraticCurveTo(46, 46, 56, 35); g.quadraticCurveTo(46, 43, 33, 47); g.fill(); }
    } else {   // dauphin, ou globicéphale (plus sombre, tête ronde) vus de dessus
      const coul = type === 'globi' ? '#1f2328' : '#56636f';
      ecume(32, 32, 9, 28, 0.3); g.fillStyle = coul;
      g.beginPath(); g.moveTo(32, type === 'globi' ? 7 : 4); g.bezierCurveTo(type === 'globi' ? 40 : 37, 12, 38, 30, 35, 44); g.lineTo(32, 54); g.lineTo(29, 44); g.bezierCurveTo(26, 30, type === 'globi' ? 24 : 27, 12, 32, type === 'globi' ? 7 : 4); g.fill();
      g.beginPath(); g.moveTo(32, 52); g.lineTo(40, 60); g.lineTo(32, 57); g.lineTo(24, 60); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(35, 22); g.lineTo(43, 31); g.lineTo(35, 28); g.fill(); g.beginPath(); g.moveTo(29, 22); g.lineTo(21, 31); g.lineTo(29, 28); g.fill();
      g.fillStyle = type === 'globi' ? '#0d0f12' : '#3d4853'; g.beginPath(); g.ellipse(32, 26, 2.2, 6, 0, 0, 2 * Math.PI); g.fill();
    }
    return g.getImageData(0, 0, W, H);
  }
  // Allure de chaque dessin : image en surface, image de la plongée (ou rien : l'animal s'enfonce), taille, vitesse (m/s de carte), taille des groupes.
  const ALLURES = {
    bosse: { i: 'cet-dos', q: 'cet-queue', s: 1, v: 90, g: [1, 2] },
    rorqual: { i: 'cet-rorqual', q: null, s: 1.15, v: 110, g: [1, 2] },
    cachalot: { i: 'cet-cachalot', q: 'cet-queuenoire', s: 1, v: 70, g: [1, 3] },
    globi: { i: 'cet-globi', q: null, s: 1.05, v: 120, g: [4, 10], petit: true },
    risso: { i: 'cet-dau', q: null, s: 1, v: 150, g: [3, 8], petit: true },
    ziphius: { i: 'cet-dau', q: null, s: 1.1, v: 100, g: [1, 3], petit: true },
    dauphin: { i: 'cet-dau', q: null, s: 0.85, v: 220, g: [3, 7], petit: true },
    longbec: { i: 'cet-dau', q: null, s: 0.8, v: 230, g: [5, 10], petit: true },
    bleublanc: { i: 'cet-dau', q: null, s: 0.8, v: 230, g: [5, 12], petit: true },
    tachete: { i: 'cet-dau', q: null, s: 0.8, v: 220, g: [4, 9], petit: true },
    autre: null
  };

  /* ---------- Thème ---------- */
  function theme(opts) {
    const ESPECES = opts.especes, PAR = new Map(ESPECES.map(e => [e.k, e]));
    let donnees = null, esp = opts.depart || ESPECES[0].k, mois = new Date().getMonth() + 1, anim = null;
    const masques = new Set(), vide = { type: 'FeatureCollection', features: [] };
    const PETIT = '#ef6fa6';   // les rencontres avec un petit : un rose qui ne se confond avec aucune teinte de secteur
    async function charger() {
      if (!donnees) donnees = fetch(opts.url).then(r => { if (!r.ok) throw new Error('données des cétacés : ' + r.status); return r.json(); }).then(prepare);
      return donnees;
    }
    /* Sans grille d'effort, on en fait une à partir des signalements : par maille, le nombre de signalements de chaque
       espèce. Elle sert à la part de l'espèce dans chaque maille et aux secteurs où faire nager les animaux. */
    function prepare(d) {
      if (d.grille) { d.effort = true; return d; }
      const m = opts.maille || 0.05, cases = new Map(), cles = ESPECES.map(e => e.k);
      for (const o of d.obs) {
        const i = Math.floor(o[0] / m), j = Math.floor(o[1] / m), c = i + ',' + j;
        let x = cases.get(c); if (!x) { x = [(i + 0.5) * m, (j + 0.5) * m, 0].concat(cles.map(() => 0)); cases.set(c, x); }
        x[2]++; const k = cles.indexOf(o[2]); if (k >= 0) x[3 + k]++;
      }
      d.grille = [...cases.values()]; d.effort = false; d.maille = m;
      ESPECES.forEach((e, i) => { e.col = 3 + i; });
      return d;
    }
    const LISSAGE = 30, MINKM = 25, MINSIG = 6;   // effort : poids de la moyenne (km), seuil (km) ; signalements : seuil par maille
    /* Valeur de chaque maille pour l'espèce : avec effort, observations pour 100 km parcourus, lissées vers la moyenne ;
       sans effort, part de l'espèce parmi les signalements de cétacés, lissée de même vers sa part sur toute la carte.
       moy : la valeur moyenne, à laquelle on compare. */
    function frequences(d, e) {
      const col = (PAR.get(e) || {}).col; if (!col) return null;
      let n = 0, tot = 0; for (const c of d.grille) { n += c[col]; tot += c[2]; }
      const moy = n / tot, seuil = d.effort ? MINKM : MINSIG, poids = d.effort ? LISSAGE : 10;
      return { moy: moy * (d.effort ? 100 : 1), f: d.grille.map(c => c[2] < seuil ? null : (c[col] + poids * moy) / (c[2] + poids) * (d.effort ? 100 : 1)) };
    }
    // Seuls les secteurs dans la moyenne ou au-dessus sont peints : la mer reste lisible, sans damier.
    // Du clair au vif, en teintes chaudes : sur le bleu de la mer, la plus pâle se voit encore (un bleu-vert s'y perdait).
    const CLASSES = [[0.75, '#f3e8c2', 'dans la moyenne'], [1.5, '#ecc14d', 'souvent'], [3, '#f07a2e', 'très souvent']];
    const classe = r => { let k = -1; for (let i = 0; i < CLASSES.length; i++) if (r >= CLASSES[i][0]) k = i; return k; };
    const carre = (lon, lat, d) => { if (d.effort) { const dy = 1 / 111.2, dx = dy / Math.cos(lat * RAD); return [[[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]]; } const h = d.maille / 2; return [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]]; };
    /* Le mois : observations par sortie si les sorties sont connues ; sinon, le nombre de signalements. Une part parmi
       les cétacés, essayée d'abord, faisait ressortir des mois d'hiver à quelques signalements : le nombre dit mieux
       quand on les voit, sachant qu'on sort bien plus en mer l'été. */
    function saison(d, e) {
      const n = new Array(12).fill(0);
      for (const o of d.obs) if (o[2] === e) n[o[4] - 1]++;
      return n.map((v, i) => d.sorties ? (d.sorties[i] ? v / d.sorties[i] : 0) : v);
    }
    const nombre = v => v.toLocaleString('fr-FR'), fr = (v, n) => v.toFixed(n == null ? 1 : n).replace('.', ',');
    const annees = d => { let a = 9999, b = 0; for (const o of d.obs) if (o[3]) { a = Math.min(a, o[3]); b = Math.max(b, o[3]); } return [a, b]; };

    /* ---------- Animaux en mouvement (décor) ---------- */
    function animer(app, d) {
      arreter();
      const e = PAR.get(esp), al = ALLURES[e.dessin]; if (!al) return;
      const map = app.map, F = frequences(d, esp);
      if (!F || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ps = saison(d, esp), max = Math.max(...ps) || 1, part = mois ? ps[mois - 1] / max : 0.6;
      const nb = Math.round((al.petit ? 6 : 14) * part); if (!nb) return;
      const bonnes = d.grille.map((c, i) => ({ c, f: F.f[i] })).filter(x => x.f != null && x.f >= F.moy);
      if (!bonnes.length) return;
      const total = bonnes.reduce((s, x) => s + x.f * x.f, 0), tirer = () => { let r = Math.random() * total; for (const x of bonnes) { r -= x.f * x.f; if (r <= 0) return x.c; } return bonnes[0].c; };
      const pasCle = d.effort ? 55 : 1 / d.maille, cle = (lon, lat) => Math.floor(lon * pasCle) + ',' + Math.floor(lat * pasCle);
      const permis = new Set(bonnes.map(x => cle(x.c[0], x.c[1]))), dans = (lon, lat) => permis.has(cle(lon, lat));
      // La mer connue (toutes les mailles) : un animal qui fait demi-tour peut déborder de son secteur, jamais de la mer.
      const connue = new Set(d.grille.map(c => cle(c[0], c[1]))), enMer = (lon, lat) => connue.has(cle(lon, lat));
      const VIRAGE = al.petit ? 110 : 45;   // degrés par seconde : une baleine tourne large
      const etale = d.effort ? 0.015 : d.maille * 0.8, betes = [];
      for (let g = 0; g < nb; g++) {
        const c = tirer(), lon = c[0] + (Math.random() - 0.5) * etale, lat = c[1] + (Math.random() - 0.5) * etale, cap = Math.random() * 360;
        const n = al.g[0] + Math.floor(Math.random() * (al.g[1] - al.g[0] + 1));
        for (let i = 0; i < n; i++) betes.push({ lon: lon + (Math.random() - 0.5) * 0.002, lat: lat + (Math.random() - 0.5) * 0.002, cap: cap + (Math.random() - 0.5) * 20, port: [c[0], c[1]], vise: null, chef: i === 0 ? null : betes.length - i, petit: !al.petit && i === 1 && e.dessin === 'bosse', phase: Math.random() * 20, etat: 'surface', t: Math.random() * 8, souffle: -1 });
      }
      for (const t of ['dos', 'queue', 'queuenoire', 'rorqual', 'cachalot', 'dau', 'globi']) if (!map.hasImage('cet-' + t)) map.addImage('cet-' + t, dessiner(t), { pixelRatio: 2 });
      map.addSource('cet-anim', { type: 'geojson', data: vide }); map.addSource('cet-souffle', { type: 'geojson', data: vide });
      map.addLayer({ id: 'cet-souffle', type: 'circle', source: 'cet-souffle', paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#ffffff', 'circle-opacity': ['get', 'o'], 'circle-blur': 0.6, 'circle-pitch-alignment': 'map' } }, 'analyses');
      map.addLayer({ id: 'cet-anim', type: 'symbol', source: 'cet-anim', layout: { 'icon-image': ['get', 'i'], 'icon-size': ['interpolate', ['exponential', 1.6], ['zoom'], 7, ['*', 0.3, ['get', 's']], 9, ['*', 0.5, ['get', 's']], 12, ['*', 0.95, ['get', 's']], 15, ['*', 1.6, ['get', 's']]], 'icon-rotate': ['get', 'cap'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['get', 'o'] } }, 'analyses');
      let avant = performance.now(), dernier = 0;
      const pas = t => {
        anim.raf = requestAnimationFrame(pas);
        if (t - dernier < 50) return; const dt = Math.min(0.2, (t - avant) / 1000); avant = t; dernier = t;
        // Vitesse : constante à l'écran plutôt que sur la mer, pour qu'un animal vu de loin bouge encore un peu.
        const v0 = al.v * Math.max(1, Math.pow(2, 11 - map.getZoom()) * 0.6);
        const feats = [], souffles = [];
        for (const b of betes) {
          const chef = b.chef != null ? betes[b.chef] : null;
          if (chef) { b.cap += ((chef.cap - b.cap + 540) % 360 - 180) * Math.min(1, dt * 1.6); b.etat = chef.etat; b.t = chef.t; }
          else {
            // Hors de son secteur, l'animal vise le centre de sa maille de départ et y revient par un virage, sans à-coup.
            if (b.vise != null) {
              const ecart = (b.vise - b.cap + 540) % 360 - 180, tour = Math.max(-VIRAGE * dt, Math.min(VIRAGE * dt, ecart));
              b.cap = (b.cap + tour + 360) % 360;
              if (Math.abs(ecart) < 8 && dans(b.lon, b.lat)) b.vise = null;
            } else b.cap += (Math.random() - 0.5) * (al.petit ? 18 : 8) * dt * 5;
            b.t -= dt;
            if (!al.petit) {   // surface → (queue) → plongée → surface, avec un souffle de temps en temps
              if (b.t <= 0) { if (b.etat === 'surface') { b.etat = al.q ? 'queue' : 'fond'; b.t = al.q ? 2.2 : 7 + Math.random() * 6; } else if (b.etat === 'queue') { b.etat = 'fond'; b.t = 6 + Math.random() * 6; } else { b.etat = 'surface'; b.t = 9 + Math.random() * 7; b.souffle = 0; } }
              if (b.etat === 'surface' && b.souffle < 0 && Math.random() < dt / 4) b.souffle = 0;
            }
          }
          const v = v0 * (b.etat === 'fond' ? 1.4 : 1) * dt, mlat = v / 111200, mlon = mlat / Math.cos(b.lat * RAD);
          let lon = b.lon + Math.sin(b.cap * RAD) * mlon, lat = b.lat + Math.cos(b.cap * RAD) * mlat;
          if (!chef) {
            if (b.vise == null && !dans(lon, lat)) b.vise = (Math.atan2((b.port[0] - b.lon) * Math.cos(b.lat * RAD), b.port[1] - b.lat) / RAD + 360 + (Math.random() - 0.5) * 50) % 360;
            if (!enMer(lon, lat)) {   // la terre ou la mer inconnue : il tourne sur place le temps du virage
              lon = b.lon; lat = b.lat; b.bloque = (b.bloque || 0) + dt;
              // Toujours bloqué une fois tourné : il essaie un autre cap ; après six secondes, il repart de sa maille.
              if (b.vise != null && Math.abs((b.vise - b.cap + 540) % 360 - 180) < 8) b.vise = (b.vise + 40 + Math.random() * 80) % 360;
              if (b.bloque > 6) { lon = b.port[0]; lat = b.port[1]; b.bloque = 0; b.vise = null; }
            } else b.bloque = 0;
          }
          b.lon = lon; b.lat = lat;
          if (b.souffle >= 0) { b.souffle += dt; const k = b.souffle / 1.6; if (k >= 1) b.souffle = -1; else souffles.push({ type: 'Feature', properties: { r: (b.petit ? 5 : 9) * (0.4 + k), o: 0.75 * (1 - k) }, geometry: { type: 'Point', coordinates: [lon, lat] } }); }
          if (b.etat === 'fond') continue;
          b.phase += dt;
          const saut = al.petit && Math.sin(b.phase * 2.4) > 0.92;   // un dauphin qui saute grossit un instant
          const plonge = !al.petit && !al.q && b.etat === 'surface' && b.t < 1.5;   // sans queue visible, l'animal s'efface en plongeant
          feats.push({ type: 'Feature', properties: { i: b.etat === 'queue' ? al.q : al.i, cap: b.cap, s: al.s * (b.petit ? 0.55 : 1) * (saut ? 1.25 : 1), o: plonge || (b.etat === 'surface' && b.t < 1.5) ? 0.5 + 0.45 * b.t / 1.5 : 0.95 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        }
        const s1 = map.getSource('cet-anim'), s2 = map.getSource('cet-souffle'); if (!s1 || !s2) return arreter();
        s1.setData({ type: 'FeatureCollection', features: feats }); s2.setData({ type: 'FeatureCollection', features: souffles });
      };
      anim = { raf: requestAnimationFrame(pas), app };
    }
    function arreter() { if (!anim) return; cancelAnimationFrame(anim.raf); const a = anim.app; anim = null; a.retirer('cet-anim', 'cet-souffle'); }

    /* Les secteurs : chaque maille compte avec ses voisines (moyenne pondérée par la distance, sur une maille et demie
       environ), et le résultat est une image fine que la carte fond encore à l'affichage : des plages aux bords doux
       au lieu d'un damier de carrés de 2 km. Seule la mer connue est peinte (la forme des mailles, découpées sur la
       côte, sert de pochoir), et une maille trop peu parcourue reste vide. */
    const imagesSecteurs = new Map();
    function secteurs(d, F, k0) {
      const cle = esp + '|' + k0 + '|' + [0, 1, 2].filter(k => masques.has('g' + k)).join('');
      if (imagesSecteurs.has(cle)) return imagesSecteurs.get(cle);
      const S = window.Socle, latM = d.grille.reduce((a, c) => a + c[1], 0) / d.grille.length;
      const hy = d.effort ? 1 / 111.2 : d.maille / 2, hx = d.effort ? hy / Math.cos(latM * RAD) : d.maille / 2;   // demi-maille, en degrés
      let o = 180, e = -180, su = 90, n = -90; for (const c of d.grille) { o = Math.min(o, c[0]); e = Math.max(e, c[0]); su = Math.min(su, c[1]); n = Math.max(n, c[1]); }
      o -= 3 * hx; e += 3 * hx; su -= 3 * hy; n += 3 * hy;
      const [x0, y0] = S.versMerc(o, su), [x1, y1] = S.versMerc(e, n);
      const fin = Math.max(3, Math.min(10, Math.floor(900 / Math.max((e - o) / (2 * hx), (n - su) / (2 * hy)))));   // points d'image par maille
      const W = Math.round((e - o) / (2 * hx) * fin), H = Math.round((n - su) / (2 * hy) * fin);
      const lonDe = i => o + (i + 0.5) / W * (e - o), latDe = j => S.versGeo(0, y1 - (j + 0.5) / H * (y1 - y0))[1];
      const px = lon => (lon - o) / (e - o) * W, py = lat => (y1 - S.versMerc(0, lat)[1]) / (y1 - y0) * H;
      // Les mailles valides, rangées par case pour retrouver vite les voisines d'un point.
      const cases = new Map(), ci = lon => Math.floor((lon - o) / (4 * hx)), cj = lat => Math.floor((lat - su) / (4 * hy));
      const pochoir = document.createElement('canvas'); pochoir.width = W; pochoir.height = H; const xp = pochoir.getContext('2d'); xp.fillStyle = xp.strokeStyle = '#000'; xp.lineWidth = 1; xp.lineJoin = 'round';
      d.grille.forEach((c, i) => {
        const f = F.f[i]; if (f == null) return;
        const k = ci(c[0]) + ',' + cj(c[1]); if (!cases.has(k)) cases.set(k, []); cases.get(k).push([c[0], c[1], f / (F.moy || 1)]);
        // Pochoir : la maille découpée sur la côte garde sa forme exacte ; au large, un disque un peu plus grand que la
        // maille, pour que le bord du secteur connu soit arrondi plutôt qu'en marches d'escalier.
        if (Array.isArray(c[c.length - 1])) for (const an of c[c.length - 1]) { xp.beginPath(); an.forEach((p, q) => q ? xp.lineTo(px(p[0]), py(p[1])) : xp.moveTo(px(p[0]), py(p[1]))); xp.closePath(); xp.fill(); xp.stroke(); }
        else { xp.beginPath(); xp.arc(px(c[0]), py(c[1]), fin * 0.82, 0, 2 * Math.PI); xp.fill(); }
      });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'), im = x.createImageData(W, H), dd = im.data;
      const rgb = CLASSES.map(k => [1, 3, 5].map(q => parseInt(k[1].slice(q, q + 2), 16))), portee = 0.85;   // écart-type du lissage, en mailles
      for (let j = 0; j < H; j++) {
        const lat = latDe(j), bj = cj(lat);
        for (let i = 0; i < W; i++) {
          const lon = lonDe(i), bi = ci(lon); let sw = 0, sv = 0;
          for (let a = bi - 1; a <= bi + 1; a++) for (let b = bj - 1; b <= bj + 1; b++) {
            const l = cases.get(a + ',' + b); if (!l) continue;
            for (const c of l) { const u = (c[0] - lon) / (2 * hx), v = (c[1] - lat) / (2 * hy), r2 = u * u + v * v; if (r2 > 6.25) continue; const w = Math.exp(-r2 / (2 * portee * portee)); sw += w; sv += w * c[2]; }
          }
          if (sw < 0.5) continue;
          const k = classe(sv / sw); if (k < k0 || masques.has('g' + k)) continue;
          const q4 = 4 * (j * W + i); dd[q4] = rgb[k][0]; dd[q4 + 1] = rgb[k][1]; dd[q4 + 2] = rgb[k][2]; dd[q4 + 3] = Math.round(255 * Math.min(1, (sw - 0.5) / 0.9));   // la teinte s'efface là où les voisines manquent
        }
      }
      x.putImageData(im, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(pochoir, 0, 0);
      // Agrandie deux fois en douceur : les limites entre classes ne dessinent plus de marches.
      const g = document.createElement('canvas'); g.width = W * 2; g.height = H * 2; const y = g.getContext('2d'); y.imageSmoothingEnabled = true; y.imageSmoothingQuality = 'high'; y.drawImage(cv, 0, 0, g.width, g.height);
      const res = { g: { x0, y0, x1, y1 }, url: g.toDataURL() };
      imagesSecteurs.set(cle, res); if (imagesSecteurs.size > 24) imagesSecteurs.delete(imagesSecteurs.keys().next().value);
      return res;
    }
    function peindre(app, d) {
      const map = app.map, F = frequences(d, esp);
      // Sans effort connu, la classe « dans la moyenne » couvrirait toute la mer pour les espèces les plus signalées : on ne la peint pas.
      if (F) {
        const im = secteurs(d, F, d.effort ? 0 : 1); app.poser('cet-grille', im.g, im.url, 0.72);
        const dessus = ['cet-lignes', 'cet-obs'].find(id => map.getLayer(id)); if (dessus) map.moveLayer('cet-grille', dessus);
      } else app.retirer('cet-grille');
      const pts = d.obs.filter(o => o[2] === esp && (!mois || o[4] === mois)).map(o => ({ type: 'Feature', properties: { nb: o[5], petit: o[6] > 0 ? 1 : 0 }, geometry: { type: 'Point', coordinates: [o[0], o[1]] } }));
      map.getSource('cet-obs').setData({ type: 'FeatureCollection', features: (masques.has('obs') ? [] : pts.filter(p => !p.properties.petit)).concat(masques.has('petit') ? [] : pts.filter(p => p.properties.petit)) });
      return { pts, F };
    }

    const q = {
      theme: opts.theme || 'Baleines', libelle: opts.libelle || 'Où voir baleines et dauphins, et quand ?', famille: opts.famille,
      plein: () => ({ rangees: ['.esp'], bloc: '.hist' }),
      aide: opts.aide,
      async ouvrir(app) {
        const map = app.map;
        const c = q._c = app.repondre(q.libelle, `<div class="vignettes esp">${ESPECES.map(e => `<button data-k="${e.k}" aria-pressed="${e.k === esp}">${vignette(e.dessin)}<span>${e.nom}</span></button>`).join('')}</div>
          <div class="ligne"><label>Mois</label><button class="annee" aria-pressed="${!mois}" style="padding:4px 10px;font-size:12px">Toute l'année</button></div>
          <div class="hist" style="display:flex;gap:2px;align-items:flex-end;height:64px;margin:6px 0 2px"></div>
          <p class="etat">Lecture des observations…</p><div class="legende"></div>
          ${opts.regles ? `<details class="regles" style="margin-top:8px;font-size:12.5px;line-height:1.45"><summary>Règles pour les approcher, drone compris</summary>${opts.regles}</details>` : ''}
          ${opts.source ? `<p class="petit">${opts.source}</p>` : ''}`);
        let d;
        try { d = await charger(); } catch (e) { c.querySelector('.etat').textContent = 'Les observations ne se chargent pas pour l\'instant.'; return; }
        if (app.active !== q) return;
        // La mer doit être dans la vue : loin des mailles connues, ou de trop près, on rejoint la zone la plus suivie.
        const ct = map.getCenter(), pres = (d.effort ? 4 : 8) / 111.2;
        if (opts.vue && ((!d.effort && map.getZoom() > 9.5) || !d.grille.some(g => Math.abs(g[0] - ct.lng) < pres / Math.cos(ct.lat * RAD) && Math.abs(g[1] - ct.lat) < pres) || map.getZoom() > 13.5)) map.flyTo({ center: opts.vue.center, zoom: opts.vue.zoom, pitch: Math.min(map.getPitch(), 45), bearing: 0, duration: 1600 });
        map.addSource('cet-obs', { type: 'geojson', data: vide });
        if (opts.lignes) {
          map.addSource('cet-lignes', { type: 'geojson', data: opts.lignes });
          map.addLayer({ id: 'cet-lignes', type: 'line', source: 'cet-lignes', paint: { 'line-color': '#e3c46a', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } }, 'analyses');
          map.addLayer({ id: 'cet-lignes-nom', type: 'symbol', source: 'cet-lignes', layout: { 'symbol-placement': 'line', 'text-field': ['get', 'nom'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 12, 'symbol-spacing': 280 }, paint: { 'text-color': '#f6e7bd', 'text-halo-color': 'rgba(16,25,42,0.85)', 'text-halo-width': 1.4 } });
        }
        map.addLayer({ id: 'cet-obs', type: 'circle', source: 'cet-obs', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, ['+', 1, ['*', 0.3, ['ln', ['max', 1, ['get', 'nb']]]]], 10.5, ['+', 1.5, ['*', 0.4, ['ln', ['max', 1, ['get', 'nb']]]]], 14, ['+', 4, ['*', 1.4, ['ln', ['max', 1, ['get', 'nb']]]]]], 'circle-color': ['case', ['==', ['get', 'petit'], 1], PETIT, '#ffffff'], 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 12.5, 0.92], 'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 12.5, 1], 'circle-stroke-color': ['case', ['==', ['get', 'petit'], 1], '#ffffff', '#1a2e4a'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 12.5, ['case', ['==', ['get', 'petit'], 1], 1.4, 1]] } }, 'analyses');
        const [a0, a1] = annees(d), duree = a1 >= a0 ? `de ${a0} à ${a1}` : '';
        const maj = () => {
          const e = PAR.get(esp), ps = saison(d, esp), mx = Math.max(...ps) || 1;
          c.querySelector('.hist').innerHTML = MOIS.map((n, i) => `<button data-m="${i + 1}" aria-pressed="${mois === i + 1}" title="${n}" style="flex:1;padding:0;border-radius:3px;border:0;background:none;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;height:100%"><span style="display:block;background:${mois === i + 1 ? '#b8963e' : '#4a90c2'};border-radius:2px 2px 0 0;height:${Math.round(46 * ps[i] / mx) + 2}px"></span><small style="font-size:9px;color:${mois === i + 1 ? '#b8963e' : '#9aa8bb'};font-weight:${mois === i + 1 ? 700 : 400}">${n.charAt(0).toUpperCase()}</small></button>`).join('');
          c.querySelector('.annee').setAttribute('aria-pressed', String(!mois));
          const { pts, F } = peindre(app, d), petits = pts.filter(p => p.properties.petit).length;
          const jeune = e.dessin === 'bosse' ? 'un baleineau' : 'un petit';
          let phrase = '';
          if (e.saison) {   // une espèce saisonnière (la baleine à bosse de La Réunion) : la phrase dit où en est la saison
            const p = mois ? ps[mois - 1] / mx : 1;
            phrase = !mois ? `${e.saison} : ${nombre(pts.length)} observations ${duree}, dont ${nombre(petits)} avec ${jeune}.`
              : p < 0.05 ? `En ${MOIS[mois - 1]}, elles sont parties. ${e.saison}.`
              : `En ${MOIS[mois - 1]}, ${p > 0.6 ? 'plein cœur de la saison' : p > 0.25 ? 'la saison bat son plein' : 'début ou fin de saison'} : ${nombre(pts.length)} observations ${duree}, dont ${nombre(petits)} avec ${jeune}.`;
          } else phrase = `${e.nom}${mois ? ` en ${MOIS[mois - 1]}` : ''} : ${nombre(pts.length)} ${d.effort ? 'observation' : 'signalement'}${pts.length > 1 ? 's' : ''} ${duree}. ${e.note || ''}`;
          c.querySelector('.etat').innerHTML = phrase + (F ? (d.effort ? ' Les plages de couleur montrent où on les voit le plus souvent ; chaque point est une rencontre.' : ' Les plages de couleur montrent où elle domine parmi les cétacés signalés ; chaque point est un signalement.') : '');
          const items = (F ? CLASSES.map((k, i) => ({ cle: 'g' + i, couleur: k[1], texte: d.effort ? k[2] : k[2] + ' signalée' })).slice(d.effort ? 0 : 1) : []).concat([{ cle: 'obs', couleur: '#ffffff', texte: d.effort ? 'point : une rencontre' : 'point : un signalement' }]).concat(petits ? [{ cle: 'petit', couleur: PETIT, texte: 'rencontre avec ' + jeune }] : []);
          app.legende(c, items, () => peindre(app, d), masques);
          animer(app, d);
        };
        c.querySelector('.esp').onclick = ev => { const bt = ev.target.closest('button[data-k]'); if (!bt) return; esp = bt.dataset.k; c.querySelectorAll('.esp button').forEach(x => x.setAttribute('aria-pressed', x === bt)); app.sansBulle(); maj(); };
        c.querySelector('.hist').onclick = ev => { const bt = ev.target.closest('button[data-m]'); if (!bt) return; mois = +bt.dataset.m; maj(); };
        c.querySelector('.annee').onclick = () => { mois = 0; maj(); };
        const actif = c.querySelector('.esp button[aria-pressed="true"]'); if (actif) actif.scrollIntoView({ inline: 'center', block: 'nearest' });
        maj();
      },
      // Toucher la mer : la maille, comparée au reste de la carte, et les mois où l'espèce est vue alentour.
      async toucher(app, ll) {
        const d = await charger().catch(() => null); if (!d || app.active !== q) return;
        let best = null, dmin = Infinity; d.grille.forEach((g, i) => { const dd = Math.hypot((g[0] - ll.lng) * Math.cos(ll.lat * RAD), g[1] - ll.lat) * 111.2; if (dd < dmin) { dmin = dd; best = i; } });
        const e = PAR.get(esp), rayon = d.effort ? 3 : 10, taille = d.effort ? 1.6 : d.maille * 111.2 * 0.75;
        if (best == null || dmin > taille) { app.bulle(ll, d.effort ? 'Pas de sorties ici<small>la mer n\'a pas été prospectée à cet endroit, ou c\'est la terre</small>' : 'Aucun signalement de cétacé ici<small>ce qui ne veut pas dire qu\'il n\'y en a pas : peu de monde les cherche à cet endroit</small>'); return; }
        const g = d.grille[best], F = frequences(d, esp);
        const proches = d.obs.filter(o => o[2] === esp && Math.hypot((o[0] - ll.lng) * Math.cos(ll.lat * RAD), o[1] - ll.lat) * 111.2 < rayon);
        const pm = new Array(12).fill(0); proches.forEach(o => pm[o[4] - 1]++); const top = pm.map((v, i) => [v, i]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => MOIS[x[1]]);
        let ligne = '';
        const assez = F && F.f[best] != null;
        if (assez) { const r = F.f[best] / F.moy; ligne = `<span class="fort">${r >= 1.5 ? fr(r) + ' fois plus' : r <= 0.67 ? fr(1 / r) + ' fois moins' : 'à peu près autant'}</span> ${r >= 1.5 || r <= 0.67 ? 'qu\'en moyenne' : 'que la moyenne'}${d.effort ? '' : ', parmi les cétacés signalés'}`; }
        else if (F) ligne = d.effort ? 'Trop peu de sorties ici pour comparer' : 'Trop peu de signalements ici pour comparer';
        const pied = d.effort ? `${nombre(Math.round(g[2]))} km de sorties dans cette maille de 2 km, sur ${g[g.length - (Array.isArray(g[g.length - 1]) ? 2 : 1)]} an(s)` : `${nombre(g[2])} signalement${g[2] > 1 ? 's' : ''} de cétacés dans cette maille, dont ${nombre(g[e.col] || 0)} de cette espèce`;
        app.bulle(ll, `${e.nom}${ligne ? ' : ' + ligne : ''}<small>${pied}${top.length ? ` · vus à moins de ${rayon} km surtout en ` + top.join(', ') : proches.length ? '' : ` · aucun à moins de ${rayon} km`}</small>`);
      },
      fermer(app) { arreter(); app.retirer('cet-obs', 'cet-lignes-nom', 'cet-lignes', 'cet-grille'); }
    };
    return q;
  }
  window.Socle.cetaces = { theme };
})();
