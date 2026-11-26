/* Thèmes « Drone » : ce que la caméra d'un drone verra depuis un point, à une hauteur et une orientation données,
   drapé sur le relief ; jusqu'où voler sans dépasser 120 m au-dessus du sol ni perdre le drone de vue ; le vent en altitude.
   Les prises de vue se rangent en plan de vol, exportable en KML et au format CSV de Litchi.
   Tout est calculé dans la page, sur le relief de l'IGN. La carte ne dit pas où le vol est autorisé. */
(function () {
  'use strict';
  const S = window.Socle, RAD = Math.PI / 180, ROSE = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const cap8 = az => ROSE[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  const m = v => v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(v / 5) * 5 + ' m';

  /* Caméras : angle de champ diagonal et largeur d'image donnés par les constructeurs, à vérifier sur la fiche du modèle.
     Format 4:3 pour toutes. « Autre » laisse régler l'angle à la main. */
  const MODELES = [
    { id: 'mini', nom: 'DJI Mini 3 / Mini 4 Pro', diag: 82.1, px: 4032 },
    { id: 'mini2', nom: 'DJI Mini 2 / Mini SE', diag: 83, px: 4000 },
    { id: 'air3', nom: 'DJI Air 3 (grand-angle)', diag: 82, px: 4032 },
    { id: 'mavic3', nom: 'DJI Mavic 3', diag: 84, px: 5280 },
    { id: 'autre', nom: 'Autre (angle à régler)', diag: 80, px: 4000 }
  ];
  // Angles horizontal et vertical (degrés) à partir de l'angle diagonal, pour une image 4:3.
  function angles(diag) {
    const t = Math.tan(diag / 2 * RAD), th = t * 4 / 5, tv = t * 3 / 5;
    return { th, tv, h: 2 * Math.atan(th) / RAD, v: 2 * Math.atan(tv) / RAD };
  }

  const garde = { lire(c, d) { try { return JSON.parse(localStorage.getItem(c)) || d; } catch (e) { return d; } }, ecrire(c, v) { try { localStorage.setItem(c, JSON.stringify(v)); } catch (e) { } } };
  const etat = Object.assign({ modele: 'mini', diag: 82.1, h: 60, cap: 0, nacelle: -30, hVol: 120 }, garde.lire('cartes.drone.reglages', {}));
  const retenirReglages = () => garde.ecrire('cartes.drone.reglages', { modele: etat.modele, diag: etat.diag, h: etat.h, cap: etat.cap, nacelle: etat.nacelle, hVol: etat.hVol });
  const modele = () => MODELES.find(x => x.id === etat.modele) || MODELES[0];

  // ---------- Relief local ----------
  const memo = new Map();
  async function relief(app, lon, lat, rayon, largeur) {
    const cle = [lon.toFixed(4), lat.toFixed(4), rayon, largeur].join();
    if (!memo.has(cle)) {
      const dlat = rayon / 111200, dlon = rayon / (111200 * Math.cos(lat * RAD));
      memo.set(cle, app.grille([lon - dlon, lat - dlat, lon + dlon, lat + dlat], largeur).then(g => {
        for (let k = 0; k < g.z.length; k++) if (g.z[k] !== g.z[k]) g.z[k] = 0;   // hors relevé : la mer
        g.zmax = Math.max(g.zmax, 0); return g;
      }));
      if (memo.size > 12) memo.delete(memo.keys().next().value);
    }
    try { return await memo.get(cle); } catch (e) { memo.delete(cle); throw e; }
  }
  // Position fractionnaire d'un point dans la grille (en mailles), et altitude interpolée.
  function position(g, lon, lat) {
    const [x, y] = S.versMerc(lon, lat);
    return [(x - g.x0) / (g.x1 - g.x0) * g.w - 0.5, (g.y1 - y) / (g.y1 - g.y0) * g.h - 0.5];
  }
  function alt(g, fi, fj) {
    const i = Math.max(0, Math.min(g.w - 2, Math.floor(fi))), j = Math.max(0, Math.min(g.h - 2, Math.floor(fj)));
    const u = Math.max(0, Math.min(1, fi - i)), v = Math.max(0, Math.min(1, fj - j)), z = g.z, a = j * g.w + i;
    return (z[a] * (1 - u) + z[a + 1] * u) * (1 - v) + (z[a + g.w] * (1 - u) + z[a + g.w + 1] * u) * v;
  }
  // Le segment entre la maille (i, j, altitude zp) et le point (ci, cj, zc) passe-t-il au-dessus du relief ?
  function aVue(g, i, j, zp, ci, cj, zc, marge) {
    const di = ci - i, dj = cj - j, n = Math.hypot(di, dj);
    if (n < 1) return true;
    for (let t = 1; t < n; t += (t < 12 ? 0.7 : t * 0.05)) {
      const f = t / n, zl = zp + (zc - zp) * f;
      if (zl > g.zmax) return true;
      if (alt(g, i + di * f, j + dj * f) > zl + marge) return false;
    }
    return true;
  }
  // Point à une distance (mètres) et un azimut donnés.
  function decaler(lon, lat, dist, az) {
    return [lon + dist * Math.sin(az * RAD) / (111200 * Math.cos(lat * RAD)), lat + dist * Math.cos(az * RAD) / 111200];
  }
  const azimut = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * RAD), b[1] - a[1]) / RAD + 360) % 360;

  // ---------- Plan de vol : prises gardées sur l'appareil ----------
  const clePlan = id => 'cartes.drone.plan.' + id;
  function exporter(nom, type, texte) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texte], { type })); a.download = nom; document.body.append(a); a.click(); a.remove();
  }
  function kml(plan, titre) {
    const pm = plan.map((p, i) => `<Placemark><name>Prise ${i + 1}</name><description>${Math.round(p.h)} m au-dessus du décollage, cap ${Math.round(p.cap)}°, nacelle ${Math.round(p.nacelle)}°</description><Point><altitudeMode>absolute</altitudeMode><coordinates>${p.lon.toFixed(6)},${p.lat.toFixed(6)},${(p.zSol + p.h).toFixed(1)}</coordinates></Point></Placemark>`).join('\n');
    const ligne = plan.length > 1 ? `<Placemark><name>Trajet</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>${plan.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${(p.zSol + p.h).toFixed(1)}`).join(' ')}</coordinates></LineString></Placemark>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${titre}</name>\n${pm}\n${ligne}\n</Document></kml>`;
  }
  /* Format CSV des missions Litchi (tel que je le connais : à contrôler dans Litchi Mission Hub avant tout vol).
     Altitudes comptées depuis le point de décollage de la première prise ; une photo par prise, nacelle réglée point par point. */
  function litchi(plan) {
    const tete = ['latitude', 'longitude', 'altitude(m)', 'heading(deg)', 'curvesize(m)', 'rotationdir', 'gimbalmode', 'gimbalpitchangle'];
    for (let k = 1; k <= 15; k++) tete.push('actiontype' + k, 'actionparam' + k);
    tete.push('altitudemode', 'speed(m/s)', 'poi_latitude', 'poi_longitude', 'poi_altitude(m)', 'poi_altitudemode', 'photo_timeinterval', 'photo_distinterval');
    const z0 = plan[0].zSol, lignes = plan.map(p => {
      const l = [p.lat.toFixed(7), p.lon.toFixed(7), (p.zSol + p.h - z0).toFixed(1), Math.round(p.cap), 0, 0, 2, Math.round(p.nacelle), 1, 0];
      for (let k = 2; k <= 15; k++) l.push(-1, 0);
      l.push(0, 0, 0, 0, 0, 0, -1, -1);
      return l.join(',');
    });
    return tete.join(',') + '\n' + lignes.join('\n') + '\n';
  }
  function dessinerPlan(app, plan) {
    const fc = { type: 'FeatureCollection', features: [] };
    if (plan.length > 1) fc.features.push({ type: 'Feature', properties: { r: 'ligne' }, geometry: { type: 'LineString', coordinates: plan.map(p => [p.lon, p.lat]) } });
    plan.forEach((p, i) => {
      fc.features.push({ type: 'Feature', properties: { r: 'prise', n: String(i + 1) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      fc.features.push({ type: 'Feature', properties: { r: 'visee' }, geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], decaler(p.lon, p.lat, 60 + p.h, p.cap)] } });
    });
    const map = app.map;
    if (map.getSource('droneplan')) { map.getSource('droneplan').setData(fc); return; }
    map.addSource('droneplan', { type: 'geojson', data: fc });
    map.addLayer({ id: 'droneplan-ligne', type: 'line', source: 'droneplan', filter: ['==', ['get', 'r'], 'ligne'], paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'droneplan-visee', type: 'line', source: 'droneplan', filter: ['==', ['get', 'r'], 'visee'], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.7 } });
    map.addLayer({ id: 'droneplan-prise', type: 'circle', source: 'droneplan', filter: ['==', ['get', 'r'], 'prise'], paint: { 'circle-radius': 9, 'circle-color': '#1a2e4a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'droneplan-num', type: 'symbol', source: 'droneplan', filter: ['==', ['get', 'r'], 'prise'], layout: { 'text-field': ['get', 'n'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
  }
  const couchesPlan = ['droneplan-num', 'droneplan-prise', 'droneplan-visee', 'droneplan-ligne'];

  // Repère du drone et axe de visée.
  function dessinerDrone(app, d, cible) {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { r: 'drone', t: Math.round(d.h) + ' m' }, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } }] };
    if (cible) fc.features.push({ type: 'Feature', properties: { r: 'axe' }, geometry: { type: 'LineString', coordinates: [[d.lon, d.lat], cible] } }, { type: 'Feature', properties: { r: 'centre' }, geometry: { type: 'Point', coordinates: cible } });
    const map = app.map;
    if (map.getSource('drone')) { map.getSource('drone').setData(fc); leverMat(app, d.lon, d.lat, d.h); return; }
    map.addSource('drone', { type: 'geojson', data: fc });
    map.addLayer({ id: 'drone-axe', type: 'line', source: 'drone', filter: ['==', ['get', 'r'], 'axe'], paint: { 'line-color': '#b8963e', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
    map.addLayer({ id: 'drone-centre', type: 'circle', source: 'drone', filter: ['==', ['get', 'r'], 'centre'], paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#b8963e', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'drone-point', type: 'circle', source: 'drone', filter: ['==', ['get', 'r'], 'drone'], paint: { 'circle-radius': 5, 'circle-color': '#b8963e', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    leverMat(app, d.lon, d.lat, d.h);
    map.addLayer({ id: 'drone-h', type: 'symbol', source: 'drone', filter: ['==', ['get', 'r'], 'drone'], layout: { 'text-field': ['get', 't'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 12, 'text-offset': [0, -1.5], 'text-allow-overlap': true }, paint: { 'text-color': '#1a2e4a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
  }
  const couchesDrone = ['drone-h', 'dronemat', 'drone-point', 'drone-centre', 'drone-axe'];

  /* Le drone à sa hauteur : une tête dorée au bout d'un trait blanc qui la relie au point de décollage. En vue 3D, elle
     monte et descend avec le réglage de la hauteur, sans attendre le calcul. La hauteur est vraie ; les largeurs sont
     recalculées au zoom pour rester lisibles (un trait de 30 cm ne se verrait pas de loin). */
  let matCourant = null;
  function leverMat(app, lon, lat, h) {
    const map = app.map; matCourant = { app, lon, lat, h };
    const res = 40075016.7 * Math.cos(lat * RAD) / (512 * Math.pow(2, map.getZoom()));   // mètres par point d'écran
    const tour = (r, n) => [Array.from({ length: n + 1 }, (_, k) => decaler(lon, lat, r, 45 + k * 360 / n))];
    const trait = Math.max(0.3, res * 1.3), tete = Math.max(1.2, res * 5.5);
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { base: 0, haut: Math.max(1, h), c: '#ffffff' }, geometry: { type: 'Polygon', coordinates: tour(trait, 4) } },
      { type: 'Feature', properties: { base: Math.max(0, h - tete * 0.7), haut: h + tete * 0.7, c: '#b8963e' }, geometry: { type: 'Polygon', coordinates: tour(tete, 10) } }] };
    if (map.getSource('dronemat')) { map.getSource('dronemat').setData(fc); return; }
    map.addSource('dronemat', { type: 'geojson', data: fc });
    map.addLayer({ id: 'dronemat', type: 'fill-extrusion', source: 'dronemat', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'haut'], 'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': false } });
    if (!map._droneMat) { map._droneMat = true; map.on('zoom', () => { if (matCourant && map.getSource('dronemat')) leverMat(matCourant.app, matCourant.lon, matCourant.lat, matCourant.h); }); }
  }

  /* ---------- Réglage en plein écran ----------
     Sur un téléphone, le panneau des réglages cache la carte au moment où l'on a besoin de la voir. Ce mode range tout
     (comme la carte libre) et pose les commandes sur les bords, sous les pouces : une glissière par côté, un cadran de
     cap en bas. Le geste est relatif : on glisse depuis n'importe où sur la commande, la valeur ne saute pas sous le doigt.
     o = { glissieres: [{ cote, nom, min, max, unite, lire, ecrire }], cap: { lire, ecrire }, boutons: [{ texte, actif, action }],
           geste: { actif, debut, bouge } (glisser sur la carte elle-même, pour la vue caméra), etat: () => phrase courte, surFin }. */
  function pilote(app, o) {
    const map = app.map, racine = document.createElement('div'), borne = (v, a, b) => Math.max(a, Math.min(b, v));
    let ouvert = true; const etaitLibre = document.body.classList.contains('libre');
    if (!app.relief3d) app.mettre3d(true);   // à plat, on ne verrait pas le drone monter
    racine.className = 'pilote';
    racine.innerHTML = `<div class="p-geste" hidden></div><div class="p-tete"><div class="p-haut"><button class="p-fin">Terminer</button>${(o.boutons || []).map((b, i) => `<button data-b="${i}"></button>`).join('')}</div><p class="p-etat"></p></div>`;
    document.body.append(racine); document.body.classList.add('pilotage'); app.libre(true);
    function glisser(el, debut, bouge) {
      let dep = null; const fin = () => { dep = null; el.classList.remove('tenu'); };
      el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (x) { } dep = Object.assign(debut(e), { x: e.clientX, y: e.clientY }); el.classList.add('tenu'); });
      el.addEventListener('pointermove', e => { if (dep) bouge(dep, e.clientX - dep.x, e.clientY - dep.y, e); });
      el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
    }
    const majs = (o.glissieres || []).map(gl => {
      const el = document.createElement('div'); el.className = 'p-gliss ' + gl.cote; el.innerHTML = `<b>${gl.nom}</b><div class="p-rail"><i></i><span></span></div>`; racine.append(el);
      const rail = el.querySelector('.p-rail'), bouton = rail.querySelector('i'), val = rail.querySelector('span');
      glisser(el, () => ({ v: gl.lire(), h: rail.clientHeight || 200 }), (dep, dx, dy) => gl.ecrire(borne(Math.round(dep.v - dy / dep.h * (gl.max - gl.min)), gl.min, gl.max)));
      return () => { const v = gl.lire(); const f = (v - gl.min) / (gl.max - gl.min); bouton.style.bottom = `calc(4px + (100% - 38px) * ${f})`; val.style.bottom = `calc(6px + (100% - 38px) * ${f})`; val.textContent = Math.round(v) + gl.unite; };
    });
    let majCadran = () => { };
    if (o.cap) {
      const el = document.createElement('div'); el.className = 'p-cadran';
      const traits = Array.from({ length: 12 }, (_, k) => `<line x1="0" y1="${k % 3 ? -51 : -48}" x2="0" y2="-55" transform="rotate(${k * 30})"/>`).join('');
      el.innerHTML = `<svg viewBox="-64 -64 128 128" aria-hidden="true"><g class="rose">${traits}${['N', 'E', 'S', 'O'].map((t, k) => `<text y="-37" transform="rotate(${k * 90})"${k ? '' : ' class="nord"'}>${t}</text>`).join('')}</g><path class="aig" d="M0 -62 L7 -47 L-7 -47 Z"/></svg><span></span>`;
      racine.append(el);
      const rose = el.querySelector('.rose'), aig = el.querySelector('.aig'), txt = el.querySelector('span');
      const angle = e => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY) / RAD; };
      glisser(el, e => ({ v: o.cap.lire(), a: angle(e) }), (dep, dx, dy, e) => o.cap.ecrire(((Math.round(dep.v + angle(e) - dep.a) % 360) + 360) % 360));
      // La rose suit la carte (son N montre le nord de l'écran) ; l'aiguille montre le cap.
      majCadran = () => { const c = o.cap.lire(), b = map.getBearing(); rose.setAttribute('transform', `rotate(${-b})`); aig.setAttribute('transform', `rotate(${c - b})`); txt.innerHTML = `${Math.round(c) % 360}°<small>${cap8(c)}</small>`; };
      map.on('rotate', majCadran);
    }
    const geste = racine.querySelector('.p-geste'), etatEl = racine.querySelector('.p-etat');
    if (o.geste) glisser(geste, () => o.geste.debut(), (dep, dx, dy) => o.geste.bouge(dep, dx, dy, geste.clientHeight || 600));
    const touche = e => { if (e.key === 'Escape') { e.stopPropagation(); api.fermer(); } };
    window.addEventListener('keydown', touche, true);
    const api = {
      maj() {
        if (!ouvert) return; majs.forEach(f => f()); majCadran();
        racine.querySelectorAll('[data-b]').forEach(b => { const d = o.boutons[+b.dataset.b]; b.textContent = d.texte(); if (d.actif) b.setAttribute('aria-pressed', String(!!d.actif())); });
        geste.hidden = !(o.geste && o.geste.actif());
        const t = o.etat ? o.etat() : ''; etatEl.innerHTML = t; etatEl.hidden = !t;
      },
      fermer() {
        if (!ouvert) return; ouvert = false;
        map.off('rotate', majCadran); window.removeEventListener('keydown', touche, true); racine.remove();
        document.body.classList.remove('pilotage'); if (!etaitLibre) app.libre(false);
        if (o.surFin) o.surFin();
      }
    };
    racine.querySelector('.p-fin').onclick = api.fermer;
    racine.querySelectorAll('[data-b]').forEach(b => { b.onclick = () => { o.boutons[+b.dataset.b].action(); api.maj(); }; });
    api.maj();
    return api;
  }

  /* ---------- Thème 1 : que verra la caméra ? ---------- */
  function camera(opts) {
    opts = opts || {};
    let plan = garde.lire(clePlan(opts.cle || 'defaut'), []);
    const garderPlan = () => garde.ecrire(clePlan(opts.cle || 'defaut'), plan);
    let d = null, tour = 0, viser = false, apercu = null, masques = new Set(), dernier = null, pil = null;

    function curseur(cls, lib, min, max, pas, val, unite) {
      return `<div class="ligne"><label style="min-width:72px">${lib}</label><input type="range" class="${cls}" min="${min}" max="${max}" step="${pas}" value="${val}" style="flex:1;min-width:110px"><span class="fort v-${cls}" style="min-width:44px;text-align:right">${val}${unite}</span></div>`;
    }

    async function calculer(app, c) {
      const moi = ++tour;
      if (!d) { c.querySelector('.etat').textContent = 'Touche la carte pour poser le drone (son point de décollage).'; return; }
      const a = angles(etat.diag), t = etat.nacelle;
      // Portée du calcul : jusqu'où peut porter le haut de l'image, bornée à 4 km.
      const haut = t + a.v / 2, rayon = haut >= -3 ? 4000 : Math.min(4000, Math.max(500, (etat.h + 300) / Math.tan(-haut * RAD) * 1.3));
      const r = rayon > 2500 ? 4000 : rayon > 1200 ? 2500 : 1200;
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await relief(app, d.lon, d.lat, r, r >= 4000 ? 420 : 360); } catch (e) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      const [ci, cj] = position(g, d.lon, d.lat);
      d.zSol = alt(g, ci, cj); const zc = d.zSol + etat.h, pas = g.pas;
      // Repère de la caméra : x vers l'est, y vers le nord, z vers le haut.
      const sA = Math.sin(etat.cap * RAD), cA = Math.cos(etat.cap * RAD), sT = Math.sin(t * RAD), cT = Math.cos(t * RAD);
      const f = [sA * cT, cA * cT, sT], rg = [cA, -sA, 0], up = [-sA * sT, -cA * sT, cT];
      const n = g.w * g.h, cls = new Uint8Array(n), dist = new Float32Array(n);
      let vus = 0, caches = 0, dmax = 0, dmin = Infinity;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const k = j * g.w + i, x = (i - ci) * pas, y = (cj - j) * pas, z = g.z[k] - zc;
        const zf = x * f[0] + y * f[1] + z * f[2]; if (zf <= 1) continue;
        const xr = (x * rg[0] + y * rg[1]) / zf, yu = (x * up[0] + y * up[1] + z * up[2]) / zf;
        if (Math.abs(xr) > a.th || Math.abs(yu) > a.tv) continue;
        const hz = Math.hypot(x, y);
        if (aVue(g, i, j, g.z[k] + 0.5, ci, cj, zc, 0.5)) { cls[k] = 1; vus++; dist[k] = hz; if (hz > dmax) dmax = hz; if (hz < dmin) dmin = hz; } else { cls[k] = 2; caches++; }
      }
      // Centre de l'image : premier contact du rayon central avec le relief.
      let centre = null, dCentre = null;
      for (let s = pas; s < r * 1.4; s += Math.max(pas * 0.5, s * 0.01)) {
        const x = f[0] * s, y = f[1] * s, z = zc + f[2] * s, fi = ci + x / pas, fj = cj - y / pas;
        if (fi < 0 || fj < 0 || fi > g.w - 1 || fj > g.h - 1) break;
        if (alt(g, fi, fj) >= z) { centre = S.versGeo(g.x0 + (fi + 0.5) / g.w * (g.x1 - g.x0), g.y1 - (fj + 0.5) / g.h * (g.y1 - g.y0)); dCentre = s; break; }
      }
      d.g = g; d.cls = cls;
      peindre(app, g, cls, dist, dmax);
      dessinerDrone(app, { lon: d.lon, lat: d.lat, h: etat.h }, centre || decaler(d.lon, d.lat, 400, etat.cap));
      // Bilan en mots
      const mod = modele(), resol = dCentre ? dCentre * 2 * a.th / mod.px * 100 : null;
      let txt = `Drone à <span class="fort">${Math.round(etat.h)} m</span> au-dessus du décollage (${Math.round(zc)} m d'altitude), cap ${Math.round(etat.cap)}° (${cap8(etat.cap)}), nacelle ${Math.round(t)}°.`;
      if (!vus) txt += ' La caméra ne voit pas le sol : elle regarde au-dessus de l\'horizon, ou le relief est trop loin.';
      else {
        txt += ` Le sol vu s'étend de <span class="fort">${m(dmin)}</span> à <span class="fort">${m(dmax)}</span> du drone${haut >= 0 ? ', et le haut de l\'image montre le ciel' : ''}.`;
        if (dCentre) txt += ` Centre de l'image à ${m(dCentre)}${resol ? `, environ <span class="fort">${resol < 10 ? resol.toFixed(1).replace('.', ',') : Math.round(resol)} cm par pixel</span> à cet endroit` : ''}.`;
        if (caches > vus * 0.08) txt += ' Une partie du cadre est cachée derrière le relief (en bleu sombre).';
      }
      // Hauteur au-dessus du sol le long de la visée : la limite des 120 m se compte depuis le sol.
      let hMax = etat.h; for (let s = 0; s < Math.min(dCentre || 600, 1200); s += pas) { const fi = ci + Math.sin(etat.cap * RAD) * s / pas, fj = cj - Math.cos(etat.cap * RAD) * s / pas; if (fi < 0 || fj < 0 || fi > g.w - 1 || fj > g.h - 1) break; hMax = Math.max(hMax, zc - alt(g, fi, fj)); }
      c.querySelector('.etat').innerHTML = txt;
      c.querySelector('.alerte').innerHTML = hMax > 125 ? `<p class="petit">Attention : en avançant dans l'axe, le sol descend et le drone se trouverait jusqu'à ${Math.round(hMax)} m au-dessus. Le thème Vol montre où.</p>` : '';
      dernier = { centre };
      if (pil) pil.maj();
    }

    function peindre(app, g, cls, dist, dmax) {
      const url = app.peindre(g, k => {
        if (cls[k] === 1 && !masques.has('vu')) { const f = Math.min(1, dist[k] / (dmax || 1)); return [Math.round(232 - 40 * f), Math.round(190 - 30 * f), Math.round(92 + 60 * f), Math.round(150 - 50 * f)]; }
        if (cls[k] === 2 && !masques.has('cache')) return [40, 52, 86, 130];
      });
      app.poser('dronevue', g, url, 0.9);
    }

    async function vueCamera(app, c) {
      if (!d || !d.zSol) return;
      const map = app.map, b = c.querySelector('.apercu');
      if (apercu) { quitterApercu(app); b.textContent = 'Vue caméra'; b.setAttribute('aria-pressed', 'false'); return; }
      const ce = map.getCenter();
      apercu = { fov: map.getVerticalFieldOfView(), vue: { center: [ce.lng, ce.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } };
      app.mettre3d(true);
      for (const id of ['dronevue', ...couchesDrone, ...couchesPlan]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      map.setMaxPitch(85); map.setVerticalFieldOfView(angles(etat.diag).v);
      const opt = map.calculateCameraOptionsFromCameraLngLatAltRotation([d.lon, d.lat], d.zSol + etat.h, etat.cap, Math.min(85, 90 + etat.nacelle), 0);
      map.setCenterClampedToGround(false);   // sinon la carte ramène le centre de la vue au sol et la caméra n'est plus où on l'a mise
      map.jumpTo(opt);
      if (pil) pil.maj();
      b.textContent = 'Quitter la vue caméra'; b.setAttribute('aria-pressed', 'true');
    }
    // Replace la vue caméra sur les réglages du moment (en plein écran, elle suit les commandes).
    function placer(app) {
      if (!apercu || !d || d.zSol == null) return;
      app.map.jumpTo(app.map.calculateCameraOptionsFromCameraLngLatAltRotation([d.lon, d.lat], d.zSol + etat.h, etat.cap, Math.min(85, 90 + etat.nacelle), 0));
    }
    function synchro(c) {
      for (const [cls, cle, u] of [['h', 'h', ' m'], ['cap', 'cap', '°'], ['nac', 'nacelle', '°']]) { c.querySelector('.' + cls).value = etat[cle]; c.querySelector('.v-' + cls).textContent = Math.round(etat[cle]) + u; }
    }
    /* Plein écran : hauteur à droite, nacelle à gauche, cap au cadran du bas. En vue caméra, glisser sur l'écran
       tourne et incline la caméra, comme on regarde autour de soi ; la vue suit le doigt. */
    function pleinEcran(app, c) {
      if (pil) return;
      const changer = (cle, v) => { etat[cle] = v; synchro(c); if (d) leverMat(app, d.lon, d.lat, etat.h); placer(app); pil.maj(); q._relancer(); };
      pil = pilote(app, {
        glissieres: [
          { cote: 'droite', nom: 'Hauteur', min: 10, max: 120, unite: ' m', lire: () => etat.h, ecrire: v => changer('h', v) },
          { cote: 'gauche', nom: 'Nacelle', min: -90, max: 0, unite: '°', lire: () => etat.nacelle, ecrire: v => changer('nacelle', v) }],
        cap: { lire: () => etat.cap, ecrire: v => changer('cap', v) },
        boutons: [
          { texte: () => 'Vue caméra', actif: () => !!apercu, action: () => vueCamera(app, c) },
          { texte: () => 'Ajouter la prise', action: () => c.querySelector('.ajout').click() }],
        geste: {
          actif: () => !!apercu, debut: () => ({ cap: etat.cap, nac: etat.nacelle }),
          bouge: (dep, dx, dy, H) => { const k = angles(etat.diag).v / H; etat.cap = ((Math.round(dep.cap - dx * k) % 360) + 360) % 360; changer('nacelle', Math.max(-90, Math.min(0, Math.round(dep.nac + dy * k)))); }
        },
        etat: () => !d ? 'Touche la carte pour poser le drone.' : `<span class="fort">${Math.round(etat.h)} m</span> au-dessus du décollage${d.zSol != null ? ` (${Math.round(d.zSol + etat.h)} m d'altitude)` : ''} · ${plan.length} prise${plan.length > 1 ? 's' : ''}`,
        surFin: () => { if (apercu) vueCamera(app, c); pil = null; }
      });
    }
    function quitterApercu(app) {
      if (!apercu) return; const map = app.map;
      map.setVerticalFieldOfView(apercu.fov); map.setCenterClampedToGround(true); map.jumpTo(apercu.vue); map.setMaxPitch(78); apercu = null;
      for (const id of ['dronevue', ...couchesDrone, ...couchesPlan]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    }

    function majPlan(app, c) {
      dessinerPlan(app, plan);
      c.querySelector('.nplan').textContent = plan.length ? `Plan de vol : ${plan.length} prise${plan.length > 1 ? 's' : ''}` : 'Plan de vol vide';
      c.querySelectorAll('.exp').forEach(b => { b.disabled = !plan.length; });
    }

    const q = {
      theme: opts.theme || 'Drone', libelle: opts.libelle || 'Que verra la caméra ?',
      aide: 'Le drone est posé là où l\'on touche, à la hauteur choisie au-dessus de ce point. Chaque maille du relief est projetée dans le cadre de la caméra (format 4:3, angle de champ du modèle), puis on vérifie qu\'aucune crête ne la cache. En doré, le sol que la photo montrera, plus pâle au loin ; en bleu sombre, ce qui est dans le cadre mais caché par le relief. « Vue caméra » place la vue 3D à la position du drone : le cadre du téléphone n\'a pas les proportions de la photo, c\'est un aperçu. Les angles de champ sont ceux des fiches constructeur, à vérifier ; le relief est le modèle de terrain de l\'IGN, sans arbres ni bâtiments. La carte ne dit pas où le vol est autorisé.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat"></p><div class="alerte"></div><div class="legende"></div>
          <div class="ligne"><label style="min-width:72px">Drone</label><select class="mod">${MODELES.map(x => `<option value="${x.id}"${x.id === etat.modele ? ' selected' : ''}>${x.nom}</option>`).join('')}</select></div>
          <div class="ligne angle" style="display:${etat.modele === 'autre' ? 'flex' : 'none'}"><label style="min-width:72px">Angle</label><input type="range" class="diag" min="40" max="120" step="1" value="${etat.diag}" style="flex:1;min-width:110px"><span class="fort v-diag">${Math.round(etat.diag)}°</span></div>
          ${curseur('h', 'Hauteur', 10, 120, 5, etat.h, ' m')}${curseur('cap', 'Cap', 0, 355, 5, etat.cap, '°')}${curseur('nac', 'Nacelle', -90, 0, 5, etat.nacelle, '°')}
          <div class="puces"><button class="plein">Régler en plein écran</button><button class="viser" aria-pressed="false">Viser un point</button><button class="apercu" aria-pressed="false">Vue caméra</button></div>
          <p class="petit2 nplan" style="margin-top:8px"></p>
          <div class="puces"><button class="ajout">Ajouter la prise</button><button class="exp undo">Retirer la dernière</button><button class="exp kml">KML</button><button class="exp csv">Litchi (CSV)</button><button class="exp raz">Effacer</button></div>
          <p class="petit">Le format Litchi est celui que je connais de leurs missions : à ouvrir dans Litchi Mission Hub et à contrôler avant tout vol.</p>`);
        q._c = c;
        masques = app.legende(c, [{ cle: 'vu', couleur: '#e0b85c', texte: 'vu par la caméra' }, { cle: 'cache', couleur: '#28345a', texte: 'caché par le relief' }], () => { if (d && d.g) peindre(app, d.g, d.cls, recalcDist(d), dmaxDe(d)); }, masques);
        const relancer = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { retenirReglages(); calculer(app, c); }, 220); }; })();
        q._relancer = relancer;
        const lier = (cls, cle, unite) => { const inp = c.querySelector('.' + cls); inp.oninput = () => { etat[cle] = +inp.value; c.querySelector('.v-' + cls).textContent = Math.round(etat[cle]) + unite; if (apercu) { quitterApercu(app); c.querySelector('.apercu').textContent = 'Vue caméra'; c.querySelector('.apercu').setAttribute('aria-pressed', 'false'); } relancer(); }; };
        lier('h', 'h', ' m'); lier('cap', 'cap', '°'); lier('nac', 'nacelle', '°'); lier('diag', 'diag', '°');
        c.querySelector('.mod').onchange = e => { etat.modele = e.target.value; const mo = modele(); if (mo.id !== 'autre') etat.diag = mo.diag; c.querySelector('.angle').style.display = mo.id === 'autre' ? 'flex' : 'none'; c.querySelector('.diag').value = etat.diag; c.querySelector('.v-diag').textContent = Math.round(etat.diag) + '°'; relancer(); };
        c.querySelector('.viser').onclick = e => { viser = !viser; e.target.setAttribute('aria-pressed', viser); if (viser && !d) c.querySelector('.etat').textContent = 'Pose d\'abord le drone, puis touche ce qu\'il doit viser.'; else if (viser) c.querySelector('.etat').textContent = 'Touche le point à viser : le cap et la nacelle s\'y orientent.'; };
        c.querySelector('.apercu').onclick = () => vueCamera(app, c);
        c.querySelector('.plein').onclick = () => pleinEcran(app, c);
        c.querySelector('.ajout').onclick = () => { if (!d || d.zSol == null) return; plan.push({ lon: +d.lon.toFixed(7), lat: +d.lat.toFixed(7), zSol: +d.zSol.toFixed(1), h: etat.h, cap: etat.cap, nacelle: etat.nacelle }); garderPlan(); majPlan(app, c); if (pil) { pil.maj(); app.occupe(true, `Prise ${plan.length} ajoutée`); setTimeout(() => app.occupe(false), 1400); } };
        c.querySelector('.undo').onclick = () => { plan.pop(); garderPlan(); majPlan(app, c); };
        c.querySelector('.raz').onclick = () => { plan = []; garderPlan(); majPlan(app, c); };
        c.querySelector('.kml').onclick = () => plan.length && exporter((opts.cle || 'drone') + '-plan.kml', 'application/vnd.google-earth.kml+xml', kml(plan, opts.nom || 'Plan de vol'));
        c.querySelector('.csv').onclick = () => plan.length && exporter((opts.cle || 'drone') + '-litchi.csv', 'text/csv', litchi(plan));
        majPlan(app, c);
        if (!d && plan.length) { const p = plan[plan.length - 1]; d = { lon: p.lon, lat: p.lat }; }
        await calculer(app, c);
      },
      toucher(app, ll) {
        if (apercu) return;
        const c = q._c;
        if (viser && d) {
          // Orienter vers le point touché : cap, puis inclinaison vers son altitude.
          etat.cap = Math.round(azimut([d.lon, d.lat], [ll.lng, ll.lat]) / 5) * 5 % 360;
          let zt = d.zSol || 0; if (d.g) { const [fi, fj] = position(d.g, ll.lng, ll.lat); if (fi >= 0 && fj >= 0 && fi <= d.g.w - 1 && fj <= d.g.h - 1) zt = alt(d.g, fi, fj); }
          const dist = S.distKm([d.lon, d.lat], [ll.lng, ll.lat]) * 1000;
          etat.nacelle = Math.max(-90, Math.min(0, Math.round(Math.atan2(zt - (d.zSol + etat.h), dist) / RAD / 5) * 5));
          c.querySelector('.cap').value = etat.cap; c.querySelector('.v-cap').textContent = etat.cap + '°';
          c.querySelector('.nac').value = etat.nacelle; c.querySelector('.v-nac').textContent = etat.nacelle + '°';
          viser = false; c.querySelector('.viser').setAttribute('aria-pressed', 'false'); retenirReglages();
        } else {
          d = { lon: ll.lng, lat: ll.lat };
          if (!garde.lire('cartes.drone.reglages', null)) { etat.cap = ((Math.round(app.map.getBearing() / 5) * 5) % 360 + 360) % 360; c.querySelector('.cap').value = etat.cap; c.querySelector('.v-cap').textContent = etat.cap + '°'; }
        }
        calculer(app, c); if (pil) pil.maj();
      },
      fermer(app) { tour++; if (pil) pil.fermer(); quitterApercu(app); viser = false; app.retirer('dronevue', ...couchesDrone, ...couchesPlan); for (const s of ['drone', 'droneplan']) if (app.map.getSource(s)) app.map.removeSource(s); matCourant = null; }
    };
    // Distances gardées implicitement : on les recalcule pour repeindre après une bascule de légende.
    function recalcDist(dd) { const g = dd.g, [ci, cj] = position(g, dd.lon, dd.lat), out = new Float32Array(g.w * g.h); for (let k = 0; k < out.length; k++) if (dd.cls[k] === 1) { const i = k % g.w, j = (k - i) / g.w; out[k] = Math.hypot(i - ci, j - cj) * g.pas; } dd._dist = out; return out; }
    function dmaxDe(dd) { let x = 0; for (const v of dd._dist) if (v > x) x = v; return x; }
    return q;
  }

  /* ---------- Thème 2 : jusqu'où voler, et par quel vent ? ---------- */
  function vol(opts) {
    opts = opts || {};
    const F = opts.fuseau || 'UTC';
    let d = null, tour = 0, masques = new Set(), pil = null;
    const COUL = { haut: [231, 111, 81, 150], dessous: [120, 20, 30, 170], cache: [40, 52, 86, 150], ok: [42, 157, 143, 70] };

    async function calculer(app, c) {
      const moi = ++tour;
      if (!d) { c.querySelector('.etat').textContent = 'Touche la carte à l\'endroit d\'où tu décolles.'; return; }
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await relief(app, d.lon, d.lat, 1500, 300); } catch (e) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      const [ci, cj] = position(g, d.lon, d.lat), z0 = alt(g, ci, cj), zv = z0 + etat.hVol, oeil = z0 + 1.7, R = 1500 / g.pas;
      const n = g.w * g.h, cls = new Uint8Array(n); let nHaut = 0, nCache = 0, nTot = 0;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        if (Math.hypot(i - ci, j - cj) > R) continue;
        const k = j * g.w + i, hs = zv - g.z[k]; nTot++;
        if (hs < 5) { cls[k] = 4; continue; }   // le relief atteint la hauteur de vol
        // Le pilote voit-il le drone au-dessus de cette maille ? (segment de l'œil du pilote au drone)
        if (!aVue(g, ci, cj, oeil, i, j, zv, 1)) { cls[k] = 3; nCache++; continue; }
        if (hs > 120) { cls[k] = 2; nHaut++; continue; }
        cls[k] = 1;
      }
      d.g = g; d.cls = cls; d.z0 = z0;
      peindre(app, g, cls);
      const cercles = { type: 'FeatureCollection', features: [500, 1000, 1500].map(rr => ({ type: 'Feature', properties: { t: m(rr) }, geometry: { type: 'LineString', coordinates: Array.from({ length: 73 }, (_, a) => decaler(d.lon, d.lat, rr, a * 5)) } })) };
      if (app.map.getSource('volcercles')) app.map.getSource('volcercles').setData(cercles);
      else { app.map.addSource('volcercles', { type: 'geojson', data: cercles }); app.map.addLayer({ id: 'volcercles', type: 'line', source: 'volcercles', paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [3, 3] } }); }
      dessinerDrone(app, { lon: d.lon, lat: d.lat, h: etat.hVol }, null);
      c.querySelector('.etat').innerHTML = `Décollage à <span class="fort">${Math.round(z0)} m</span>, vol à ${Math.round(etat.hVol)} m au-dessus, soit ${Math.round(zv)} m d'altitude. Dans un rayon de 1,5 km, le drone serait à plus de 120 m du sol sur <span class="fort">${Math.round(100 * nHaut / nTot)} %</span> de la zone, et hors de vue derrière le relief sur <span class="fort">${Math.round(100 * nCache / nTot)} %</span>.`;
      vent(app, c, moi);
      if (pil) pil.maj();
    }
    function peindre(app, g, cls) {
      const cle = ['', 'ok', 'haut', 'cache', 'dessous'];
      app.poser('volzone', g, app.peindre(g, k => { const x = cle[cls[k]]; if (x && !masques.has(x)) return COUL[x]; }), 0.9);
    }
    /* Vent à la hauteur du vol. Le modèle donne le vent à 10, 80, 120 et 180 m au-dessus du sol : on lit celui de la
       hauteur réglée, par interpolation entre les deux niveaux qui l'encadrent. La prévision d'un lieu est gardée :
       changer la hauteur ne relance pas de requête. */
    const NIV = [10, 80, 120, 180], previs = new Map();
    function aHauteur(hh, i, h, nom) {
      h = Math.max(NIV[0], Math.min(NIV[NIV.length - 1], h));
      let n = 0; while (n < NIV.length - 2 && h > NIV[n + 1]) n++;
      const a = hh[`${nom}_${NIV[n]}m`][i], b = hh[`${nom}_${NIV[n + 1]}m`][i], f = (h - NIV[n]) / (NIV[n + 1] - NIV[n]);
      if (a == null) return b; if (b == null) return a;
      if (nom === 'wind_direction') { const d = ((b - a + 540) % 360) - 180; return (a + d * f + 360) % 360; }   // les directions s'interpolent par le plus court chemin
      return a + (b - a) * f;
    }
    async function vent(app, c, moi) {
      const cible = c.querySelector('.vent'), cle = d.lat.toFixed(2) + ',' + d.lon.toFixed(2);
      if (!previs.has(cle)) {
        cible.innerHTML = '<p class="petit">Vent en cours de lecture…</p>';
        const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${d.lat.toFixed(3)}&longitude=${d.lon.toFixed(3)}&hourly=${NIV.map(n => `wind_speed_${n}m,wind_direction_${n}m`).join(',')},wind_gusts_10m,precipitation,precipitation_probability&forecast_hours=24&timezone=${encodeURIComponent(F)}`);
        if (j && j.hourly) previs.set(cle, j);
        if (moi !== tour) return;
      }
      const j = previs.get(cle);
      if (!j) { cible.innerHTML = '<p class="petit">Le vent n\'a pas pu être lu.</p>'; return; }
      const hh = j.hourly, now = Date.now(), H = etat.hVol; let i0 = 0;
      // premier pas horaire à venir (les heures sont locales, sans fuseau : on compare au décalage annoncé)
      for (let i = 0; i < hh.time.length; i++) { const t = Date.parse(hh.time[i] + ':00Z') - (j.utc_offset_seconds || 0) * 1000; if (t >= now - 3600e3) { i0 = i; break; } }
      const max = opts.ventMax || 38, cases = []; for (let i = i0; i < Math.min(hh.time.length, i0 + 12); i += 3) {
        const v = aHauteur(hh, i, H, 'wind_speed'), dir = aHauteur(hh, i, H, 'wind_direction'), r = hh.wind_gusts_10m[i], pl = hh.precipitation ? hh.precipitation[i] : 0, pp = hh.precipitation_probability ? hh.precipitation_probability[i] : null, fort = Math.max(v, r) > max;
        cases.push(`<div${fort ? ' style="outline:1px solid #e76f51"' : ''}><b>${hh.time[i].slice(11, 13)} h</b>${Math.round(v)} km/h<br><small>vient du ${cap8(dir)} · raf. ${Math.round(r)}</small><br><small>${pl > 0.1 ? 'pluie ' + pl.toFixed(1).replace('.', ',') + ' mm' : pp != null && pp >= 30 ? 'pluie possible (' + Math.round(pp) + ' %)' : 'sec'}</small></div>`);
      }
      cible.innerHTML = `<p style="margin-top:6px">Vent <span class="fort">à ${Math.round(H)} m</span> au-dessus du décollage, pour les douze heures à venir.</p><div class="jours">${cases.join('')}</div>
        <p class="petit">Vent du modèle lu à la hauteur réglée (entre ses niveaux de 10, 80, 120 et 180 m) : il change avec le curseur de hauteur. Rafales au sol. Encadré en rouge au-delà de ${max} km/h, la résistance au vent annoncée pour les petits drones DJI (à vérifier pour le sien).</p>`;
    }
    const q = {
      theme: opts.theme || 'Vol', libelle: opts.libelle || 'Jusqu\'où voler, et par quel vent ?',
      aide: 'Depuis le point de décollage touché, le drone vole à la hauteur choisie au-dessus de ce point. Pour chaque maille du relief dans un rayon de 1,5 km, la carte compare cette altitude au sol dessous : la limite légale de 120 m se compte depuis le sol le plus proche, si bien qu\'au-dessus d\'une ravine on la dépasse sans monter. Elle vérifie aussi qu\'aucune crête ne passe entre l\'œil du pilote et le drone : derrière, on perd le drone de vue et souvent la liaison radio. Vent : prévision Open-Meteo, lue à la hauteur de vol réglée. Cette carte ne dit pas où le vol est autorisé : zones d\'aéroport, cœur du Parc national et réserve marine ont leurs propres règles, à vérifier auprès des sources officielles.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat"></p><div class="legende"></div>
          <div class="ligne"><label style="min-width:72px">Hauteur</label><input type="range" class="hv" min="20" max="120" step="5" value="${etat.hVol}" style="flex:1;min-width:110px"><span class="fort v-hv">${etat.hVol} m</span></div>
          <div class="puces"><button class="plein">Régler en plein écran</button></div>
          <div class="vent"></div>`);
        q._c = c;
        masques = app.legende(c, [{ cle: 'ok', couleur: 'rgb(42,157,143)', texte: 'en vue, sous 120 m' }, { cle: 'haut', couleur: 'rgb(231,111,81)', texte: 'plus de 120 m du sol' }, { cle: 'cache', couleur: '#28345a', texte: 'hors de vue' }, { cle: 'dessous', couleur: 'rgb(120,20,30)', texte: 'relief plus haut que le drone' }], () => { if (d && d.g) peindre(app, d.g, d.cls); }, masques);
        const inp = c.querySelector('.hv'); let t;
        const relancer = () => { clearTimeout(t); t = setTimeout(() => { retenirReglages(); calculer(app, c); }, 220); };
        inp.oninput = () => { etat.hVol = +inp.value; c.querySelector('.v-hv').textContent = etat.hVol + ' m'; if (d) leverMat(app, d.lon, d.lat, etat.hVol); relancer(); };
        // Plein écran : la hauteur seule, à droite ; la carte reste libre pour regarder où passe la limite des 120 m.
        c.querySelector('.plein').onclick = () => {
          if (pil) return;
          pil = pilote(app, {
            glissieres: [{ cote: 'droite', nom: 'Hauteur', min: 20, max: 120, unite: ' m', lire: () => etat.hVol, ecrire: v => { etat.hVol = v; inp.value = v; c.querySelector('.v-hv').textContent = v + ' m'; if (d) leverMat(app, d.lon, d.lat, v); pil.maj(); relancer(); } }],
            etat: () => !d ? 'Touche la carte à l\'endroit d\'où tu décolles.' : `Vol à <span class="fort">${Math.round(etat.hVol)} m</span> au-dessus du décollage${d.z0 != null ? `, soit ${Math.round(d.z0 + etat.hVol)} m d'altitude` : ''}`,
            surFin: () => { pil = null; }
          });
        };
        await calculer(app, c);
      },
      toucher(app, ll) { d = { lon: ll.lng, lat: ll.lat }; calculer(app, q._c); },
      fermer(app) { tour++; if (pil) pil.fermer(); app.retirer('volzone', 'volcercles', ...couchesDrone); if (app.map.getSource('drone')) app.map.removeSource('drone'); matCourant = null; }
    };
    return q;
  }

  S.drone = { camera, vol, MODELES, angles };
})();
