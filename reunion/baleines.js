/* Thème « Baleines » de la carte de La Réunion : où et quand voir baleines à bosse et dauphins.
   Données : Globice (Groupe local d'observation et d'identification des cétacés), publiées sur Sextant (Ifremer).
   - Observations datées de 2008 à 2018 (position, espèce, nombre, petits), relevées lors des sorties en mer de Globice.
   - Grille de 2 km, de 2008 à 2022 : kilomètres parcourus en prospection et observations de chaque espèce par maille.
   Les deux sont réunies dans baleines.json (préparé une fois : ces séries ne changent plus), à côté de ce fichier.
   Note sur la source : sur Sextant, les couches « positions » de chaque espèce contiennent en fait toutes les
   observations de l'année ; l'espèce est un code (8 baleine à bosse, 1 grand dauphin de l'Indo-Pacifique, 2 grand
   dauphin, 3 dauphin à long bec, 4 dauphin tacheté), retrouvé en recoupant les totaux annuels des grilles.

   Ce que la carte montre :
   - en couleur, les mailles où l'on voit l'espèce le plus souvent, en observations pour 100 km parcourus (l'effort de
     sortie est ainsi pris en compte : une zone très parcourue n'est pas mise en avant pour autant). Une maille peu
     parcourue est ramenée vers la moyenne de l'île (lissage), et une maille de moins de 25 km parcourus n'est pas peinte ;
   - en points, les vraies observations du mois choisi (toutes années), cerclées d'or quand un petit était là ;
   - en mouvement, quelques animaux dessinés qui nagent dans les secteurs favorables : un décor, pas des positions. */
(function () {
  'use strict';
  const RAD = Math.PI / 180;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // Espèces : clé, nom, nom latin, colonne dans la grille (après lon, lat, km), phrase courte.
  const ESPECES = [
    { k: 'B', nom: 'Baleine à bosse', lat: 'Megaptera novaeangliae', col: 3, note: 'Elles viennent mettre bas et s\'accoupler dans les eaux chaudes de l\'île, de juin à octobre.' },
    { k: 'I', nom: 'Grand dauphin de l\'Indo-Pacifique', lat: 'Tursiops aduncus', col: 7, note: 'Toute l\'année, près du bord, surtout sur la côte ouest.' },
    { k: 'L', nom: 'Dauphin à long bec', lat: 'Stenella longirostris', col: 4, note: 'En grands bancs, connus pour leurs sauts en vrille.' },
    { k: 'G', nom: 'Grand dauphin', lat: 'Tursiops truncatus', col: 6, note: 'Plus gros, plus au large que son cousin de l\'Indo-Pacifique.' },
    { k: 'T', nom: 'Dauphin tacheté', lat: 'Stenella attenuata', col: 5, note: 'Au large, plus rarement vu.' },
    { k: 'R', nom: 'Autres espèces', lat: '', col: 0, note: 'Espèces plus rares : cachalot, globicéphale, baleine à bec…' }
  ];
  const PAR = new Map(ESPECES.map(e => [e.k, e]));

  /* ---------- Silhouettes ----------
     Vignettes de profil pour la liste ; vues de dessus pour la carte (posées à plat sur la mer, tournées dans le sens de la nage). */
  const VIGNETTE = {
    B: '<path d="M4 24c6-6 15-8 22-6 3 1 5 3 7 3l4-4-1 6 3 3-5-1c-3 2-7 3-12 3-7 0-13-1-18-4z" fill="#3c4a5c"/><path d="M13 25l-3 7 6-6z" fill="#e8eef3"/><path d="M5 24.5c5 1.5 11 1.5 16 .5" stroke="#cfd8e0" stroke-width="1" fill="none"/>',
    I: '<path d="M5 22c5-4 13-5 20-3l3-5 1 6c3 1 5 2 7 2l3-3-1 5 2 2-4 0c-6 2-16 3-31-4z" fill="#7d8a96"/><path d="M5 22c8 3 18 3 26 1" stroke="#c9d2da" stroke-width="1.2" fill="none"/>',
    L: '<path d="M3 22c6-3 13-4 21-3l3-4 1 5c3 1 6 2 9 2l2-3v4l2 2h-4c-7 2-18 2-34-3z" fill="#5d6b7b"/><path d="M4 22.5c9 2 20 2 29 .5" stroke="#d7dde3" stroke-width="1" fill="none"/>',
    G: '<path d="M5 22c5-5 14-6 21-4l3-6 1 7c3 1 5 2 7 2l3-3-1 5 2 2-4 0c-6 2-16 3-32-3z" fill="#6c7782"/>',
    T: '<path d="M4 22c6-3 13-4 21-3l3-4 1 5c3 1 6 2 9 2l2-3v4l2 2h-4c-7 2-18 2-34-3z" fill="#4f5d6e"/><g fill="#dfe6ec"><circle cx="12" cy="21" r=".7"/><circle cx="16" cy="20" r=".6"/><circle cx="20" cy="21.5" r=".7"/><circle cx="24" cy="20.5" r=".6"/><circle cx="14" cy="23" r=".5"/></g>',
    R: '<path d="M3 23c4-5 12-7 22-6 4 0 7 2 9 2l4-3-1 5 2 3-5-1c-4 2-10 3-16 3-6 0-11-1-15-3z" fill="#2f3a46"/><path d="M14 17l1-3 2 3z" fill="#2f3a46"/>'
  };
  const vignette = k => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="7" fill="#cfe3ee"/><path d="M0 28q10-3 20 0t20 0v12H0z" fill="#8fbcd4"/>${VIGNETTE[k]}</svg>`;
  // Vues de dessus, dessinées une fois sur un canevas (le nez vers le haut de l'image).
  function dessiner(type) {
    const W = type === 'queue' ? 64 : 64, H = type === 'dau' ? 64 : 128, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (type === 'dos') {   // baleine à bosse vue de dessus : corps trapu, très longues nageoires pectorales, caudale
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.ellipse(32, 66, 22, 56, 0, 0, 2 * Math.PI); g.fill();   // écume autour
      g.fillStyle = '#2b3846';
      g.beginPath(); g.moveTo(32, 10); g.bezierCurveTo(46, 14, 47, 48, 42, 76); g.bezierCurveTo(38, 96, 35, 104, 32, 108); g.bezierCurveTo(29, 104, 26, 96, 22, 76); g.bezierCurveTo(17, 48, 18, 14, 32, 10); g.fill();
      g.fillStyle = '#dfe7ee';   // pectorales blanches, signe de la baleine à bosse
      g.beginPath(); g.moveTo(41, 40); g.quadraticCurveTo(58, 56, 60, 78); g.quadraticCurveTo(52, 62, 40, 50); g.fill();
      g.beginPath(); g.moveTo(23, 40); g.quadraticCurveTo(6, 56, 4, 78); g.quadraticCurveTo(12, 62, 24, 50); g.fill();
      g.fillStyle = '#2b3846'; g.beginPath(); g.moveTo(32, 104); g.quadraticCurveTo(44, 110, 52, 124); g.quadraticCurveTo(40, 118, 32, 116); g.quadraticCurveTo(24, 118, 12, 124); g.quadraticCurveTo(20, 110, 32, 104); g.fill();
      g.fillStyle = '#4a5b6c'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(32, 16 + i * 5, 1.3, 0, 2 * Math.PI); g.fill(); }   // tubercules de la tête
    } else if (type === 'queue') {   // caudale qui sort de l'eau avant la plongée
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(32, 104, 22, 10, 0, 0, 2 * Math.PI); g.fill();
      g.fillStyle = '#2b3846'; g.beginPath(); g.moveTo(32, 104); g.quadraticCurveTo(30, 70, 32, 58); g.quadraticCurveTo(34, 70, 34, 104); g.fill();
      g.beginPath(); g.moveTo(33, 60); g.quadraticCurveTo(46, 52, 62, 30); g.quadraticCurveTo(48, 40, 33, 46); g.quadraticCurveTo(18, 40, 2, 30); g.quadraticCurveTo(18, 52, 31, 60); g.fill();
      g.fillStyle = '#e9eef2'; g.beginPath(); g.moveTo(33, 50); g.quadraticCurveTo(46, 46, 56, 35); g.quadraticCurveTo(46, 43, 33, 47); g.fill();
    } else {   // dauphin vu de dessus
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(32, 32, 9, 28, 0, 0, 2 * Math.PI); g.fill();
      g.fillStyle = '#56636f';
      g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(37, 12, 38, 30, 35, 44); g.lineTo(32, 54); g.lineTo(29, 44); g.bezierCurveTo(26, 30, 27, 12, 32, 4); g.fill();
      g.beginPath(); g.moveTo(32, 52); g.lineTo(40, 60); g.lineTo(32, 57); g.lineTo(24, 60); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(35, 22); g.lineTo(43, 31); g.lineTo(35, 28); g.fill(); g.beginPath(); g.moveTo(29, 22); g.lineTo(21, 31); g.lineTo(29, 28); g.fill();
      g.fillStyle = '#3d4853'; g.beginPath(); g.ellipse(32, 30, 1.8, 5, 0, 0, 2 * Math.PI); g.fill();   // aileron dorsal
    }
    return g.getImageData(0, 0, W, H);
  }

  /* ---------- Thème ---------- */
  function theme(opts) {
    opts = opts || {};
    let donnees = null, esp = 'B', mois = new Date().getMonth() + 1, anim = null;
    const masques = new Set();
    const vide = { type: 'FeatureCollection', features: [] };
    async function charger() {
      if (!donnees) donnees = fetch(opts.url || 'baleines.json').then(r => { if (!r.ok) throw new Error('données des cétacés : ' + r.status); return r.json(); });
      return donnees;
    }
    // Fréquence lissée d'une espèce dans une maille : observations pour 100 km, ramenée vers la moyenne de l'île quand la maille est peu parcourue.
    const LISSAGE = 30;   // km : poids de la moyenne de l'île
    const MINKM = 25;     // km parcourus en dessous desquels une maille est trop peu connue pour être peinte
    function frequences(d, e) {
      const col = PAR.get(e).col; if (!col) return null;
      let obs = 0, km = 0; for (const c of d.grille) { obs += c[col]; km += c[2]; }
      const moy = obs / km;
      return { moy: moy * 100, f: d.grille.map(c => c[2] < MINKM ? null : (c[col] + LISSAGE * moy) / (c[2] + LISSAGE) * 100) };
    }
    // Seuls les secteurs dans la moyenne de l'île ou au-dessus sont peints : la mer reste lisible, sans damier.
    const CLASSES = [[0.75, '#4fb0bd', 'dans la moyenne'], [1.5, '#e3c46a', 'souvent'], [3, '#f08a3c', 'très souvent']];
    const classe = r => { let k = -1; for (let i = 0; i < CLASSES.length; i++) if (r >= CLASSES[i][0]) k = i; return k; };
    // Carré de 2 km autour du centre d'une maille.
    const carre = (lon, lat) => { const dy = 1 / 111.2, dx = dy / Math.cos(lat * RAD); return [[[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]]; };
    const parSortie = (d, e) => { const n = new Array(12).fill(0); for (const o of d.obs) if (o[2] === e) n[o[4] - 1]++; return n.map((v, i) => d.sorties[i] ? v / d.sorties[i] : 0); };
    const nombre = v => v.toLocaleString('fr-FR');
    const fr = (v, n) => v.toFixed(n == null ? 1 : n).replace('.', ',');

    /* ---------- Animaux en mouvement (décor) ----------
       Quelques animaux nagent dans les mailles favorables à l'espèce choisie, en nombre suivant le mois. Une baleine
       nage en surface, souffle, sort la queue et plonge ; les dauphins vont en petits groupes, plus vite. */
    function animer(app, d) {
      arreter();
      if (esp === 'R') return;   // espèces rares : pas de grille, donc pas de secteur où les faire nager
      const map = app.map, F = frequences(d, esp);
      if (!F || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ps = parSortie(d, esp), max = Math.max(...ps) || 1, part = mois ? ps[mois - 1] / max : 0.6;
      const baleine = esp === 'B', nb = Math.round((baleine ? 16 : 6) * part);   // groupes
      if (!nb) return;
      // Mailles favorables : au-dessus de la moyenne, tirées au sort selon leur fréquence.
      const bonnes = d.grille.map((c, i) => ({ c, f: F.f[i] })).filter(x => x.f != null && x.f >= F.moy);
      if (!bonnes.length) return;
      const total = bonnes.reduce((s, x) => s + x.f * x.f, 0), tirer = () => { let r = Math.random() * total; for (const x of bonnes) { r -= x.f * x.f; if (r <= 0) return x.c; } return bonnes[0].c; };
      const cle = (lon, lat) => Math.round(lon * 55) + ',' + Math.round(lat * 55);   // ~2 km
      const permis = new Set(bonnes.map(x => cle(x.c[0], x.c[1])));
      const dans = (lon, lat) => permis.has(cle(lon, lat));
      const betes = [];
      for (let g = 0; g < nb; g++) {
        const c = tirer(), lon = c[0] + (Math.random() - 0.5) * 0.015, lat = c[1] + (Math.random() - 0.5) * 0.015, cap = Math.random() * 360;
        const n = baleine ? (Math.random() < 0.45 ? 2 : 1) : 3 + Math.floor(Math.random() * 4);   // mère et petit, ou groupe de dauphins
        for (let i = 0; i < n; i++) betes.push({ lon: lon + (Math.random() - 0.5) * 0.002, lat: lat + (Math.random() - 0.5) * 0.002, cap: cap + (Math.random() - 0.5) * 20, chef: i === 0 ? null : betes.length - i, petit: baleine && i === 1, phase: Math.random() * 20, etat: 'surface', t: Math.random() * 8, souffle: -1 });
      }
      if (!map.hasImage('cet-dos')) { map.addImage('cet-dos', dessiner('dos'), { pixelRatio: 2 }); map.addImage('cet-queue', dessiner('queue'), { pixelRatio: 2 }); map.addImage('cet-dau', dessiner('dau'), { pixelRatio: 2 }); }
      map.addSource('cet-anim', { type: 'geojson', data: vide }); map.addSource('cet-souffle', { type: 'geojson', data: vide });
      map.addLayer({ id: 'cet-souffle', type: 'circle', source: 'cet-souffle', paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#ffffff', 'circle-opacity': ['get', 'o'], 'circle-blur': 0.6, 'circle-pitch-alignment': 'map' } }, 'analyses');
      map.addLayer({ id: 'cet-anim', type: 'symbol', source: 'cet-anim', layout: { 'icon-image': ['get', 'i'], 'icon-size': ['interpolate', ['exponential', 1.6], ['zoom'], 9, ['*', 0.5, ['get', 's']], 12, ['*', 0.95, ['get', 's']], 15, ['*', 1.6, ['get', 's']]], 'icon-rotate': ['get', 'cap'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['get', 'o'] } }, 'analyses');
      const vitesse = baleine ? 90 : 220;   // mètres par seconde de carte : lent à l'écran, comme un animal vu de loin
      let avant = performance.now(), dernier = 0;
      const pas = t => {
        anim.raf = requestAnimationFrame(pas);
        if (t - dernier < 50) return; const dt = Math.min(0.2, (t - avant) / 1000); avant = t; dernier = t;
        const feats = [], souffles = [];
        for (const b of betes) {
          const chef = b.chef != null ? betes[b.chef] : null;
          if (chef) { b.cap += ((chef.cap - b.cap + 540) % 360 - 180) * 0.08; b.etat = chef.etat; b.t = chef.t; }
          else {
            b.cap += (Math.random() - 0.5) * (baleine ? 8 : 18) * dt * 5;
            b.t -= dt;
            if (baleine) {   // surface → queue → plongée → surface
              if (b.t <= 0) { if (b.etat === 'surface') { b.etat = 'queue'; b.t = 2.2; } else if (b.etat === 'queue') { b.etat = 'fond'; b.t = 6 + Math.random() * 6; } else { b.etat = 'surface'; b.t = 9 + Math.random() * 7; b.souffle = 0; } }
              if (b.etat === 'surface' && b.souffle < 0 && Math.random() < dt / 4) b.souffle = 0;
            }
          }
          const v = vitesse * (b.etat === 'fond' ? 1.4 : 1) * dt, mlat = v / 111200, mlon = mlat / Math.cos(b.lat * RAD);
          let lon = b.lon + Math.sin(b.cap * RAD) * mlon, lat = b.lat + Math.cos(b.cap * RAD) * mlat;
          if (!dans(lon, lat) && !chef) { b.cap = (b.cap + 150 + Math.random() * 60) % 360; lon = b.lon; lat = b.lat; }
          b.lon = lon; b.lat = lat;
          if (b.souffle >= 0) { b.souffle += dt; const k = b.souffle / 1.6; if (k >= 1) b.souffle = -1; else souffles.push({ type: 'Feature', properties: { r: (b.petit ? 5 : 9) * (0.4 + k), o: 0.75 * (1 - k) }, geometry: { type: 'Point', coordinates: [lon, lat] } }); }
          if (baleine && b.etat === 'fond') continue;
          b.phase += dt;
          const saut = !baleine && Math.sin(b.phase * 2.4) > 0.92;   // un dauphin qui saute grossit un instant
          feats.push({ type: 'Feature', properties: { i: baleine ? (b.etat === 'queue' ? 'cet-queue' : 'cet-dos') : 'cet-dau', cap: b.cap, s: (b.petit ? 0.55 : 1) * (saut ? 1.25 : 1) * (baleine ? 1 : 0.85), o: baleine && b.etat === 'surface' && b.t < 1.5 ? 0.6 + 0.4 * b.t / 1.5 : 0.95 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        }
        const s1 = map.getSource('cet-anim'), s2 = map.getSource('cet-souffle'); if (!s1 || !s2) return arreter();
        s1.setData({ type: 'FeatureCollection', features: feats }); s2.setData({ type: 'FeatureCollection', features: souffles });
      };
      anim = { raf: requestAnimationFrame(pas), app };
    }
    function arreter() {
      if (!anim) return; cancelAnimationFrame(anim.raf); const a = anim.app; anim = null;
      a.retirer('cet-anim', 'cet-souffle');
    }

    function peindre(app, d) {
      const map = app.map, F = frequences(d, esp);
      const cellules = [];
      // Une maille qui touche la côte porte sa seule partie en mer (découpée une fois sur le contour de l'île de l'IGN).
      if (F) d.grille.forEach((c, i) => { const f = F.f[i]; if (f == null) return; const k = classe(f / (F.moy || 1)); if (k < 0) return; cellules.push({ type: 'Feature', properties: { k, coul: CLASSES[k][1] }, geometry: c[9] ? { type: 'MultiPolygon', coordinates: c[9].map(r => [r]) } : { type: 'Polygon', coordinates: carre(c[0], c[1]) } }); });
      const pts = d.obs.filter(o => o[2] === esp && (!mois || o[4] === mois)).map(o => ({ type: 'Feature', properties: { nb: o[5], petit: o[6] > 0 ? 1 : 0, an: o[3], m: o[4] }, geometry: { type: 'Point', coordinates: [o[0], o[1]] } }));
      map.getSource('cet-grille').setData({ type: 'FeatureCollection', features: cellules.filter(c => !masques.has('g' + c.properties.k)) });
      map.getSource('cet-obs').setData({ type: 'FeatureCollection', features: masques.has('obs') ? [] : pts.filter(p => !(masques.has('petit') && p.properties.petit)) });
      return { pts, F };
    }

    const q = {
      theme: opts.theme || 'Baleines', libelle: 'Où voir baleines et dauphins, et quand ?', famille: opts.famille,
      plein: () => ({ rangees: ['.esp'], bloc: '.hist' }),
      aide: 'Les données sont celles de Globice, l\'association réunionnaise qui suit les cétacés en mer depuis 2008, publiées en données ouvertes sur Sextant (Ifremer). Les couleurs disent où l\'on voit l\'espèce le plus souvent, en observations pour 100 km parcourus par les bateaux de Globice, sur la grille de 2 km de 2008 à 2022 : l\'effort de sortie est pris en compte, une zone très fréquentée par les bateaux n\'est donc pas avantagée. Une maille peu parcourue est ramenée vers la moyenne de l\'île, et celles de moins de 25 km parcourus ne sont pas peintes : les sorties partent surtout de la côte ouest, le reste de l\'île est peu connu, ce qui ne veut pas dire sans animaux. Les points sont les observations du mois choisi, toutes années de 2008 à 2018 confondues ; cerclés d\'or, un petit était là. La frise des mois compte les observations par sortie en mer, pour ne pas confondre la saison des baleines avec celle des bateaux, qui sortent bien plus en juillet et en août. Les animaux en mouvement sont un décor : ils nagent dans les mailles où l\'espèce est le plus souvent vue, en nombre suivant le mois, mais ne disent pas où sont les animaux aujourd\'hui. Règles d\'approche : résumé de l\'arrêté préfectoral n° 1098 du 27 juin 2025 et de son projet publié par l\'État ; seul le texte officiel fait foi.',
      async ouvrir(app) {
        const map = app.map;
        const c = q._c = app.repondre(q.libelle, `<div class="vignettes esp">${ESPECES.map(e => `<button data-k="${e.k}" aria-pressed="${e.k === esp}">${vignette(e.k)}<span>${e.nom}</span></button>`).join('')}</div>
          <div class="ligne"><label>Mois</label><button class="annee" aria-pressed="${!mois}" style="padding:4px 10px;font-size:12px">Toute l'année</button></div>
          <div class="hist" style="display:flex;gap:2px;align-items:flex-end;height:64px;margin:6px 0 2px"></div>
          <p class="etat">Lecture des observations…</p><div class="legende"></div>
          <details class="regles" style="margin-top:8px;font-size:12.5px;line-height:1.45"><summary>Règles pour les approcher, drone compris</summary>
            · moteur au point mort à moins de <b>100 m</b> d'une baleine, <b>50 m</b> d'un dauphin ;<br>
            · à moins de 300 m : <b>4 nœuds</b> au plus, <b>trois bateaux</b> au plus ;<br>
            · <b>drone</b> aérien ou sous-marin : jamais à moins de <b>100 m</b> des animaux ;<br>
            · du 1er juillet au 30 septembre : observation de 9 h à 16 h, mise à l'eau de 9 h à 13 h, à 15 m au moins, jamais dans la réserve marine.</details>
          <p class="petit">Observations de Globice, 2008-2018 ; grille de prospection 2008-2022 (Sextant, Ifremer).</p>`);
        let d;
        try { d = await charger(); } catch (e) { c.querySelector('.etat').textContent = 'Les observations ne se chargent pas pour l\'instant.'; return; }
        if (app.active !== q) return;
        // La mer doit être dans la vue : depuis l'intérieur de l'île, on rejoint la côte ouest, là où les sorties sont nombreuses.
        const ct = map.getCenter(); if (!d.grille.some(g => Math.hypot((g[0] - ct.lng) * Math.cos(ct.lat * RAD), g[1] - ct.lat) * 111.2 < 4) || map.getZoom() > 13.5) map.flyTo({ center: [55.25, -21.12], zoom: 10.4, pitch: Math.min(map.getPitch(), 45), bearing: 0, duration: 1600 });
        map.addSource('cet-grille', { type: 'geojson', data: vide }); map.addSource('cet-obs', { type: 'geojson', data: vide });
        map.addLayer({ id: 'cet-grille', type: 'fill', source: 'cet-grille', paint: { 'fill-color': ['get', 'coul'], 'fill-opacity': 0.55, 'fill-antialias': false } }, 'analyses');
        map.addLayer({ id: 'cet-obs', type: 'circle', source: 'cet-obs', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['+', 2, ['*', 0.6, ['ln', ['max', 1, ['get', 'nb']]]]], 14, ['+', 4, ['*', 1.4, ['ln', ['max', 1, ['get', 'nb']]]]]], 'circle-color': '#ffffff', 'circle-opacity': 0.85, 'circle-stroke-color': ['case', ['==', ['get', 'petit'], 1], '#e0b341', '#1a2e4a'], 'circle-stroke-width': ['case', ['==', ['get', 'petit'], 1], 2.2, 1] } }, 'analyses');
        const maj = () => {
          const e = PAR.get(esp), ps = parSortie(d, esp), mx = Math.max(...ps) || 1;
          c.querySelector('.hist').innerHTML = MOIS.map((n, i) => `<button data-m="${i + 1}" aria-pressed="${mois === i + 1}" title="${n}" style="flex:1;padding:0;border-radius:3px;border:0;background:none;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;height:100%"><span style="display:block;background:${mois === i + 1 ? '#b8963e' : '#4a90c2'};border-radius:2px 2px 0 0;height:${Math.round(46 * ps[i] / mx) + 2}px"></span><small style="font-size:9px;color:${mois === i + 1 ? '#b8963e' : '#9aa8bb'};font-weight:${mois === i + 1 ? 700 : 400}">${n.charAt(0).toUpperCase()}</small></button>`).join('');
          c.querySelector('.annee').setAttribute('aria-pressed', String(!mois));
          const { pts, F } = peindre(app, d), petits = pts.filter(p => p.properties.petit).length;
          let phrase;
          if (esp === 'B') {
            const p = mois ? ps[mois - 1] / mx : 1;
            phrase = !mois ? `Elles sont là de juin à octobre, avec un pic en août : ${nombre(pts.length)} observations en onze ans, dont ${nombre(petits)} avec un baleineau.`
              : p < 0.05 ? `En ${MOIS[mois - 1]}, elles sont parties : les baleines à bosse reviennent en juin, le gros de la saison va de juillet à septembre.`
              : `En ${MOIS[mois - 1]}, ${p > 0.6 ? 'plein cœur de la saison' : p > 0.25 ? 'la saison bat son plein' : 'début ou fin de saison'} : ${nombre(pts.length)} observations en onze ans, dont ${nombre(petits)} avec un baleineau.`;
          } else phrase = `${e.nom}${mois ? ` en ${MOIS[mois - 1]}` : ''} : ${nombre(pts.length)} observation${pts.length > 1 ? 's' : ''} en onze ans. ${e.note}`;
          c.querySelector('.etat').innerHTML = phrase + (F ? ' Les couleurs montrent où on les voit le plus souvent.' : '');
          const items = (F ? CLASSES.map((k, i) => ({ cle: 'g' + i, couleur: k[1], texte: k[2] })) : []).concat([{ cle: 'obs', couleur: '#ffffff', texte: 'observations' }, { cle: 'petit', couleur: '#e0b341', texte: esp === 'B' ? 'avec un baleineau' : 'avec un petit' }]);
          app.legende(c, items, () => peindre(app, d), masques);
          animer(app, d);
        };
        c.querySelector('.esp').onclick = ev => { const bt = ev.target.closest('button[data-k]'); if (!bt) return; esp = bt.dataset.k; c.querySelectorAll('.esp button').forEach(x => x.setAttribute('aria-pressed', x === bt)); app.sansBulle(); maj(); };
        c.querySelector('.hist').onclick = ev => { const bt = ev.target.closest('button[data-m]'); if (!bt) return; mois = +bt.dataset.m; maj(); };
        c.querySelector('.annee').onclick = () => { mois = 0; maj(); };
        const actif = c.querySelector('.esp button[aria-pressed="true"]'); if (actif) actif.scrollIntoView({ inline: 'center', block: 'nearest' });
        maj();
      },
      // Toucher la mer : ce qu'on voit dans la maille, comparé au reste de l'île, et les mois où on l'y voit.
      async toucher(app, ll) {
        const d = await charger().catch(() => null); if (!d || app.active !== q) return;
        let best = null, dmin = Infinity; d.grille.forEach((g, i) => { const dd = Math.hypot((g[0] - ll.lng) * Math.cos(ll.lat * RAD), g[1] - ll.lat) * 111.2; if (dd < dmin) { dmin = dd; best = i; } });
        const e = PAR.get(esp);
        if (best == null || dmin > 1.6) { app.bulle(ll, 'Pas de sorties de Globice ici<small>la mer n\'a pas été prospectée à cet endroit, ou c\'est la terre</small>'); return; }
        const g = d.grille[best], F = frequences(d, esp);
        const proches = d.obs.filter(o => o[2] === esp && Math.hypot((o[0] - ll.lng) * Math.cos(ll.lat * RAD), o[1] - ll.lat) * 111.2 < 3);
        const pm = new Array(12).fill(0); proches.forEach(o => pm[o[4] - 1]++); const top = pm.map((v, i) => [v, i]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => MOIS[x[1]]);
        let ligne = '';
        if (F && g[2] >= MINKM) { const f = F.f[best], r = f / F.moy; ligne = `<span class="fort">${r >= 1.5 ? fr(r) + ' fois plus' : r <= 0.67 ? fr(1 / r) + ' fois moins' : 'à peu près autant'}</span> ${r >= 1.5 || r <= 0.67 ? 'qu\'en moyenne autour de l\'île' : 'que la moyenne de l\'île'}`; }
        else if (F) ligne = 'Trop peu de sorties ici pour comparer';
        app.bulle(ll, `${e.nom}${ligne ? ' : ' + ligne : ''}<small>${nombre(Math.round(g[2]))} km de sorties dans cette maille de 2 km, sur ${g[8]} an${g[8] > 1 ? 's' : ''}${top.length ? ' · vus à moins de 3 km surtout en ' + top.join(', ') : proches.length ? '' : ' · aucune observation à moins de 3 km'}</small>`);
      },
      fermer(app) { arreter(); app.retirer('cet-obs', 'cet-grille'); }
    };
    return q;
  }
  window.Socle.baleines = { theme };
})();
