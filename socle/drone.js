/* Thèmes « Drone » : ce que la caméra d'un drone verra depuis un point, à une hauteur et une orientation données,
   drapé sur le relief ; jusqu'où voler sans dépasser 120 m au-dessus du sol ni perdre le drone de vue ; le vent en altitude.
   Les prises de vue se rangent en plan de vol : chacune se reprend d'un toucher, un bilan montre ce qu'elles voient
   ensemble, et le plan s'exporte en KML, au format CSV de Litchi ou en fiche à imprimer.
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
  // Surface en mots : mètres carrés, hectares, puis kilomètres carrés.
  const aire = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + ' km²' : v >= 1e4 ? (v / 1e4).toFixed(v >= 1e5 ? 0 : 1).replace('.', ',') + ' ha' : Math.round(v / 100) * 100 + ' m²';
  // Jusqu'où peut porter le haut de l'image (mètres), pour une hauteur et une inclinaison de nacelle ; bornée à 4 km.
  function portee(h, nacelle, a) {
    const haut = nacelle + a.v / 2;
    return haut >= -3 ? 4000 : Math.min(4000, Math.max(500, (h + 300) / Math.tan(-haut * RAD) * 1.3));
  }
  /* Parcourt les mailles du relief qui tombent dans le cadre d'une caméra placée en (ci, cj) à l'altitude zc, et appelle
     f(k, distance au sol, vue ou cachée) pour chacune. Repère de la caméra : x vers l'est, y vers le nord, z vers le haut.
     Renvoie l'axe de visée. */
  function balayer(g, ci, cj, zc, cap, nacelle, a, rayon, marge, f) {
    const pas = g.pas, sA = Math.sin(cap * RAD), cA = Math.cos(cap * RAD), sT = Math.sin(nacelle * RAD), cT = Math.cos(nacelle * RAD);
    const ax = [sA * cT, cA * cT, sT], rg = [cA, -sA, 0], up = [-sA * sT, -cA * sT, cT], R = rayon / pas;
    const j0 = Math.max(0, Math.floor(cj - R)), j1 = Math.min(g.h - 1, Math.ceil(cj + R)), i0 = Math.max(0, Math.floor(ci - R)), i1 = Math.min(g.w - 1, Math.ceil(ci + R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * g.w + i, x = (i - ci) * pas, y = (cj - j) * pas, z = g.z[k] - zc;
      const zf = x * ax[0] + y * ax[1] + z * ax[2]; if (zf <= 1) continue;
      const xr = (x * rg[0] + y * rg[1]) / zf, yu = (x * up[0] + y * up[1] + z * up[2]) / zf;
      if (Math.abs(xr) > a.th || Math.abs(yu) > a.tv) continue;
      const hz = Math.hypot(x, y); if (hz > rayon) continue;
      f(k, hz, aVue(g, i, j, g.z[k] + 0.5, ci, cj, zc, marge));
    }
    return ax;
  }

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
  function dessinerPlan(app, plan, choisie) {
    const fc = { type: 'FeatureCollection', features: [] };
    if (plan.length > 1) fc.features.push({ type: 'Feature', properties: { r: 'ligne' }, geometry: { type: 'LineString', coordinates: plan.map(p => [p.lon, p.lat]) } });
    plan.forEach((p, i) => {
      fc.features.push({ type: 'Feature', properties: { r: 'prise', n: String(i + 1), s: i === choisie ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      fc.features.push({ type: 'Feature', properties: { r: 'visee' }, geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], decaler(p.lon, p.lat, 60 + p.h, p.cap)] } });
    });
    const map = app.map;
    if (map.getSource('droneplan')) { map.getSource('droneplan').setData(fc); return; }
    map.addSource('droneplan', { type: 'geojson', data: fc });
    map.addLayer({ id: 'droneplan-ligne', type: 'line', source: 'droneplan', filter: ['==', ['get', 'r'], 'ligne'], paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'droneplan-visee', type: 'line', source: 'droneplan', filter: ['==', ['get', 'r'], 'visee'], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.7 } });
    map.addLayer({ id: 'droneplan-prise', type: 'circle', source: 'droneplan', filter: ['==', ['get', 'r'], 'prise'], paint: { 'circle-radius': ['case', ['==', ['get', 's'], 1], 11, 9], 'circle-color': ['case', ['==', ['get', 's'], 1], '#b8963e', '#1a2e4a'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
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
     (comme la carte libre) : on touche la carte pour poser le drone, et ses commandes s'accrochent à lui. Une barre
     verticale à droite du point pour la hauteur, une autre à gauche pour l'inclinaison de la nacelle, un anneau autour
     de lui pour le cap ; les actions sont en bas, sous le pouce. Tout se règle donc sur la carte ; le panneau ne garde
     que les valeurs, le plan de vol et les explications. « Terminer » rend le panneau, où « Reprendre le réglage sur la
     carte » y ramène : le point posé est gardé. Les poignées sont à côté du point et pas dessus, assez grosses pour le
     pouce ; pendant qu'on les tient, la carte ne bouge pas. Le bouton rond du haut ramène la carte sur le point.
     En vue caméra, la barre de la nacelle passe sur le bord droit de l'écran.
     o = { point: () => { lon, lat } ou null, hauteur: { min, max, lire, ecrire }, cap: { lire, ecrire } (facultatif),
           nacelle: { min, max, lire, ecrire } (facultatif), recentrer: () => {} (facultatif),
           actions: [{ texte, actif, visible, action }], apercu: () => bool,
           geste: { debut, bouge } (glisser sur l'écran en vue caméra), etat: () => phrase courte, surFin }. */
  function pilote(app, o) {
    const map = app.map, racine = document.createElement('div'), borne = (v, a, b) => Math.max(a, Math.min(b, v));
    const etaitLibre = document.body.classList.contains('libre');
    let ouvert = true, tenu = false;
    if (!app.relief3d) app.mettre3d(true);   // à plat, on ne verrait pas le drone monter
    racine.className = 'pilote';
    racine.innerHTML = `<div class="p-geste" hidden></div>
      <div class="p-tete"><div class="p-haut">${o.recentrer ? '<button class="p-centre" aria-label="Recentrer la carte sur le point" title="Recentrer sur le point" hidden><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' : ''}<button class="p-fin">Terminer</button></div><p class="p-etat"></p></div>
      <div class="p-ancre" hidden>
        ${o.cap ? '<svg class="p-anneau" viewBox="-80 -80 160 160" aria-hidden="true"><circle r="62"/><line class="p-axe" x1="0" y1="0" x2="0" y2="-62"/></svg><div class="p-poignee" aria-label="Cap"><span></span></div>' : ''}
        <div class="p-barre" aria-label="Hauteur"><b>Hauteur</b><i></i><span></span></div>
      </div>
      ${o.nacelle ? '<div class="p-barre p-nac" aria-label="Inclinaison de la nacelle" hidden><b>Nacelle</b><i></i><span></span></div>' : ''}
      <div class="p-actions">${(o.actions || []).map((x, i) => `<button data-a="${i}"></button>`).join('')}</div>`;
    document.body.append(racine); document.body.classList.add('pilotage'); app.libre(true);
    const ancre = racine.querySelector('.p-ancre'), barre = ancre.querySelector('.p-barre'), pouce = barre.querySelector('i'), valeur = barre.querySelector('span');
    const poignee = racine.querySelector('.p-poignee'), axe = racine.querySelector('.p-axe'), nac = racine.querySelector('.p-nac'), centre = racine.querySelector('.p-centre');
    const geste = racine.querySelector('.p-geste'), etatEl = racine.querySelector('.p-etat');
    // Un glissement tenu par le doigt : la carte n'en reçoit rien, et elle reste figée jusqu'au lâcher.
    function glisser(el, debut, bouge) {
      let dep = null; const fin = () => { if (!dep) return; dep = null; tenu = false; el.classList.remove('tenu'); map.dragPan.enable(); map.touchZoomRotate.enable(); api.maj(); };
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (x) { } map.dragPan.disable(); map.touchZoomRotate.disable(); tenu = true; dep = Object.assign(debut(e), { x: e.clientX, y: e.clientY }); el.classList.add('tenu'); });
      el.addEventListener('pointermove', e => { if (dep) { e.preventDefault(); bouge(dep, e.clientX - dep.x, e.clientY - dep.y, e); } });
      el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
    }
    const H = o.hauteur, N = o.nacelle, HAUT_BARRE = 170;
    glisser(barre, () => ({ v: H.lire() }), (dep, dx, dy) => H.ecrire(borne(Math.round((dep.v - dy / HAUT_BARRE * (H.max - H.min)) / 5) * 5, H.min, H.max)));
    // Nacelle : le doigt monte, la caméra se relève vers l'horizon ; il descend, elle plonge vers le sol.
    if (nac) glisser(nac, () => ({ v: N.lire() }), (dep, dx, dy) => N.ecrire(borne(Math.round(dep.v - dy / HAUT_BARRE * (N.max - N.min)), N.min, N.max)));
    // Cap : l'azimut du point de la carte sous le doigt, vu du drone (juste aussi en vue inclinée).
    if (poignee) glisser(poignee, () => ({}), (dep, dx, dy, e) => {
      const pt = o.point(); if (!pt) return; const r = map.getCanvas().getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]); o.cap.ecrire(Math.round(azimut([pt.lon, pt.lat], [ll.lng, ll.lat])) % 360);
    });
    if (o.geste) glisser(geste, () => o.geste.debut(), (dep, dx, dy) => o.geste.bouge(dep, dx, dy, geste.clientHeight || 600));
    racine.querySelectorAll('[data-a]').forEach(b => { b.onclick = e => { e.stopPropagation(); o.actions[+b.dataset.a].action(); api.maj(); }; });
    if (centre) centre.onclick = e => { e.stopPropagation(); o.recentrer(); };
    const RAYON = 62;
    // Place les commandes sur le point du drone, à chaque mouvement de la carte.
    function caler() {
      if (!ouvert) return;
      const pt = o.point(), ap = o.apercu && o.apercu();
      ancre.hidden = !pt || ap; geste.hidden = !(o.geste && ap);
      if (centre) centre.hidden = !pt || ap;
      if (nac) { nac.hidden = !pt; nac.classList.toggle('bord', !!ap); if (ap) nac.style.transform = ''; }
      if (!pt || ap) return;
      const r = map.getCanvas().getBoundingClientRect(), p = map.project([pt.lon, pt.lat]);
      const x = borne(p.x, nac ? 144 : 90, r.width - 200), y = borne(p.y, nac ? 205 : 175, r.height - (nac ? 215 : 170));
      ancre.style.transform = `translate(${x}px, ${y}px)`;
      if (nac) nac.style.transform = `translate(${x - 136}px, ${y - 85}px)`;
      if (poignee) {
        // Direction du cap à l'écran : on projette un point quelques dizaines de mètres plus loin dans l'axe.
        const res = 40075016.7 * Math.cos(pt.lat * RAD) / (512 * Math.pow(2, map.getZoom()));
        const q = map.project(decaler(pt.lon, pt.lat, res * 40, o.cap.lire()));
        let vx = q.x - p.x, vy = q.y - p.y; const n = Math.hypot(vx, vy) || 1; vx /= n; vy /= n;
        poignee.style.transform = `translate(${vx * RAYON}px, ${vy * RAYON}px)`;
        axe.setAttribute('x2', vx * RAYON); axe.setAttribute('y2', vy * RAYON);
        poignee.querySelector('span').textContent = Math.round(o.cap.lire()) % 360 + '°';
      }
    }
    map.on('move', caler);
    const touche = e => { if (e.key === 'Escape') { e.stopPropagation(); api.fermer(); } };
    window.addEventListener('keydown', touche, true);
    const api = {
      maj() {
        if (!ouvert) return;
        const f = (H.lire() - H.min) / (H.max - H.min);
        pouce.style.bottom = `calc(4px + (100% - 38px) * ${f})`; valeur.style.bottom = `calc(2px + (100% - 38px) * ${f})`; valeur.textContent = Math.round(H.lire()) + ' m';
        if (nac) { nac.querySelector('i').style.bottom = `calc(4px + (100% - 38px) * ${(N.lire() - N.min) / (N.max - N.min)})`; nac.querySelector('span').textContent = Math.round(N.lire()) + '°'; }
        racine.querySelectorAll('[data-a]').forEach(b => { const d = o.actions[+b.dataset.a]; b.textContent = d.texte(); b.hidden = d.visible ? !d.visible() : false; if (d.actif) b.setAttribute('aria-pressed', String(!!d.actif())); });
        const t = o.etat ? o.etat() : ''; etatEl.innerHTML = t; etatEl.hidden = !t;
        caler();
      },
      get tenu() { return tenu; },
      fermer() {
        if (!ouvert) return; ouvert = false;
        map.off('move', caler); window.removeEventListener('keydown', touche, true); racine.remove();
        map.dragPan.enable(); map.touchZoomRotate.enable();
        document.body.classList.remove('pilotage'); if (!etaitLibre) app.libre(false);
        if (o.surFin) o.surFin();
      }
    };
    racine.querySelector('.p-fin').onclick = () => api.fermer();
    api.maj();
    return api;
  }

  /* ---------- Thème 1 : que verra la caméra ? ----------
     Une prise se règle sur la carte (hauteur, cap, nacelle), puis s'enregistre dans le plan de vol. Toucher le point
     d'une prise enregistrée la choisit : la carte montre ce qu'elle voit, et les réglages la modifient directement ;
     on peut alors la déplacer ou la retirer, et changer son rang depuis le tableau du panneau. Toucher ailleurs pose
     une nouvelle prise. Le bilan, calculé à la demande, réunit ce que voient toutes les prises. */
  function camera(opts) {
    opts = opts || {};
    const cle = clePlan(opts.cle || 'defaut'), BORNES = { h: [10, 120], cap: [0, 359], nacelle: [-90, 0] };
    let plan = garde.lire(cle, []);
    const garderPlan = () => garde.ecrire(cle, plan);
    let d = null, tour = 0, viser = false, deplacer = false, apercu = null, masques = new Set(), pil = null;
    let sel = -1;       // rang de la prise enregistrée en cours de réglage ; -1 : une prise pas encore enregistrée
    let fraiche = -1;   // prise qu'on vient d'enregistrer (le temps d'inviter à poser la suivante)
    let bil = null;     // bilan affiché : { g, nb, cad, surf, vue, multi, cache }
    const vu = {};      // ce qui a déjà été réglé une fois : les consignes du plein écran ne se répètent pas
    const pret = () => plan.every(p => p.zSol != null);

    // Les réglages du moment sont ceux de la prise choisie : on les y reporte tout de suite.
    function reporter(app, c) {
      if (sel < 0 || !plan[sel]) return;
      const p = plan[sel]; if (p.h !== etat.h || p.cap !== etat.cap || p.nacelle !== etat.nacelle) p.surf = p.dmax = null;   // à recalculer
      Object.assign(p, { h: etat.h, cap: etat.cap, nacelle: etat.nacelle }); garderPlan(); majPlan(app, c);
    }
    function regler(app, c, k, v) {
      etat[k] = v; vu[k] = true; fraiche = -1; reporter(app, c); synchro(c);
      if (d) leverMat(app, d.lon, d.lat, etat.h); placer(app); if (pil) pil.maj(); q._relancer();
    }
    // Altitude du sol d'une prise déplacée, même si le calcul de la vue est interrompu entre-temps.
    function solDe(app, p) {
      const lon = p.lon, lat = p.lat;
      relief(app, lon, lat, 1200, 360).then(g => { if (p.lon !== lon || p.lat !== lat || p.zSol != null) return; const [fi, fj] = position(g, lon, lat); p.zSol = +alt(g, fi, fj).toFixed(1); garderPlan(); }).catch(() => { });
    }

    async function calculer(app, c) {
      const moi = ++tour;
      if (bil) quitterBilan(app, c);
      c.querySelector('.pose').hidden = !d;
      if (!d) { c.querySelector('.etat').innerHTML = 'Choisis ton drone, puis <span class="fort">touche la carte là où il décolle</span> : la carte s\'y rapproche et les réglages (hauteur, cap, nacelle) se posent autour du point.'; return; }
      const a = angles(etat.diag), t = etat.nacelle;
      // Portée du calcul : jusqu'où peut porter le haut de l'image, bornée à 4 km.
      const haut = t + a.v / 2, rayon = portee(etat.h, t, a);
      const r = rayon > 2500 ? 4000 : rayon > 1200 ? 2500 : 1200;
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await relief(app, d.lon, d.lat, r, r >= 4000 ? 420 : 360); } catch (e) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      const [ci, cj] = position(g, d.lon, d.lat);
      d.zSol = alt(g, ci, cj); const zc = d.zSol + etat.h, pas = g.pas;
      const n = g.w * g.h, cls = new Uint8Array(n), dist = new Float32Array(n);
      let vus = 0, caches = 0, dmax = 0, dmin = Infinity;
      const f = balayer(g, ci, cj, zc, etat.cap, t, a, Infinity, 0.5, (k, hz, ok) => {
        if (ok) { cls[k] = 1; vus++; dist[k] = hz; if (hz > dmax) dmax = hz; if (hz < dmin) dmin = hz; } else { cls[k] = 2; caches++; }
      });
      // Centre de l'image : premier contact du rayon central avec le relief.
      let centre = null, dCentre = null;
      for (let s = pas; s < r * 1.4; s += Math.max(pas * 0.5, s * 0.01)) {
        const x = f[0] * s, y = f[1] * s, z = zc + f[2] * s, fi = ci + x / pas, fj = cj - y / pas;
        if (fi < 0 || fj < 0 || fi > g.w - 1 || fj > g.h - 1) break;
        if (alt(g, fi, fj) >= z) { centre = S.versGeo(g.x0 + (fi + 0.5) / g.w * (g.x1 - g.x0), g.y1 - (fj + 0.5) / g.h * (g.y1 - g.y0)); dCentre = s; break; }
      }
      d.g = g; d.cls = cls; d.surf = vus * pas * pas; d.dmax = dmax;
      peindre(app, g, cls, dist, dmax);
      dessinerDrone(app, { lon: d.lon, lat: d.lat, h: etat.h }, centre || decaler(d.lon, d.lat, 400, etat.cap));
      // La prise choisie garde l'altitude de son sol, la surface qu'elle montre et jusqu'où elle voit.
      if (sel >= 0 && plan[sel] && plan[sel].lon === d.lon && plan[sel].lat === d.lat) { Object.assign(plan[sel], { zSol: +d.zSol.toFixed(1), surf: Math.round(d.surf), dmax: Math.round(dmax) }); garderPlan(); majPlan(app, c); }
      // Bilan en mots : les valeurs réglées se lisent au-dessus, la phrase dit ce que la photo montre.
      const mod = modele(), resol = dCentre ? dCentre * 2 * a.th / mod.px * 100 : null;
      let txt;
      if (!vus) txt = 'La caméra ne voit pas le sol : elle regarde au-dessus de l\'horizon, ou le relief est trop loin.';
      else {
        txt = `${sel >= 0 ? `Prise ${sel + 1} : la` : 'La'} photo montre <span class="fort">${aire(d.surf)}</span> de terrain, de ${m(dmin)} à ${m(dmax)} du drone${haut >= 0 ? ', et du ciel en haut de l\'image' : ''}.`;
        if (dCentre) txt += ` Centre de l'image à ${m(dCentre)}${resol ? `, environ <span class="fort">${resol < 10 ? resol.toFixed(1).replace('.', ',') : Math.round(resol)} cm par pixel</span>` : ''}.`;
        if (caches > vus * 0.08) txt += ' Une partie du cadre est cachée derrière le relief (en bleu sombre).';
      }
      // Hauteur au-dessus du sol le long de la visée : la limite des 120 m se compte depuis le sol.
      let hMax = etat.h; for (let s = 0; s < Math.min(dCentre || 600, 1200); s += pas) { const fi = ci + Math.sin(etat.cap * RAD) * s / pas, fj = cj - Math.cos(etat.cap * RAD) * s / pas; if (fi < 0 || fj < 0 || fi > g.w - 1 || fj > g.h - 1) break; hMax = Math.max(hMax, zc - alt(g, fi, fj)); }
      c.querySelector('.etat').innerHTML = txt;
      c.querySelector('.v-alt').textContent = `soit ${Math.round(zc)} m d'altitude`;
      c.querySelector('.alerte').innerHTML = hMax > 125 ? `<p class="petit">Attention : en avançant dans l'axe, le sol descend et le drone se trouverait jusqu'à ${Math.round(hMax)} m au-dessus. Le thème Vol montre où.</p>` : '';
      if (pil) pil.maj();
    }

    function peindre(app, g, cls, dist, dmax) {
      const url = app.peindre(g, k => {
        if (cls[k] === 1 && !masques.has('vu')) { const f = Math.min(1, dist[k] / (dmax || 1)); return [Math.round(232 - 40 * f), Math.round(190 - 30 * f), Math.round(92 + 60 * f), Math.round(150 - 50 * f)]; }
        if (cls[k] === 2 && !masques.has('cache')) return [40, 52, 86, 130];
      });
      app.poser('dronevue', g, url, 0.9);
    }
    // Repeint après une bascule de légende : le bilan s'il est affiché, sinon la vue de la prise en cours.
    function repeindre(app) { if (bil) peindreBilan(app); else if (d && d.g) peindre(app, d.g, d.cls, recalcDist(d), dmaxDe(d)); }
    function legender(app, c) {
      const items = [{ cle: 'vu', couleur: '#e0b85c', texte: bil ? 'vu par une prise' : 'vu par la caméra' }];
      if (bil) items.push({ cle: 'multi', couleur: 'rgb(42,157,143)', texte: 'vu par plusieurs prises' });
      items.push({ cle: 'cache', couleur: '#28345a', texte: bil ? 'dans un cadre, caché par le relief' : 'caché par le relief' });
      masques = app.legende(c, items, () => repeindre(app), masques);
    }

    /* ---------- Bilan : tout ce que voient les prises du plan ----------
       Une seule grille de relief couvre toutes les prises ; chacune y est projetée comme dans la vue d'une prise, et
       l'on compte pour chaque maille le nombre de prises qui la voient. Doré : une prise ; vert : plusieurs ; bleu
       sombre : dans un cadre mais derrière le relief. La grille s'arrête un peu après le sol le plus lointain que
       chaque prise voit (relevé quand sa vue a été calculée), pour garder des mailles fines ; à défaut, à la portée de
       son cadre. Calculé à la demande : sur un téléphone, il prend quelques secondes. */
    async function bilan(app, c) {
      if (!plan.length) return;
      if (apercu) vueCamera(app, c);
      const moi = ++tour, a = angles(etat.diag), port = plan.map(p => p.dmax ? Math.max(150, p.dmax * 1.2) : Math.min(3000, portee(p.h, p.nacelle, a))), R = Math.max(...port);
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const p of plan) { o = Math.min(o, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
      const latM = (s + n) / 2, dlat = R / 111200, dlon = R / (111200 * Math.cos(latM * RAD));
      const bornes = [o - dlon, s - dlat, e + dlon, n + dlat], forme = (bornes[2] - bornes[0]) * Math.cos(latM * RAD) / (bornes[3] - bornes[1]);
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await app.grille(bornes, Math.round(440 * Math.min(1, forme))); } catch (err) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      for (let k = 0; k < g.z.length; k++) if (g.z[k] !== g.z[k]) g.z[k] = 0;   // hors relevé : la mer
      g.zmax = Math.max(g.zmax, 0);
      const nMailles = g.w * g.h, nb = new Uint8Array(nMailles), cad = new Uint8Array(nMailles), surf = [], pas2 = g.pas * g.pas;
      for (let i = 0; i < plan.length; i++) {
        app.occupe(true, `Bilan : prise ${i + 1} sur ${plan.length}…`);
        await new Promise(res => setTimeout(res, 0));   // laisse l'écran afficher l'avancement
        if (moi !== tour || app.active !== q) { app.occupe(false); return; }
        const p = plan[i], [ci, cj] = position(g, p.lon, p.lat); let vus = 0;
        balayer(g, ci, cj, alt(g, ci, cj) + p.h, p.cap, p.nacelle, a, port[i], 0.5 + 0.04 * g.pas, (k, hz, ok) => { if (ok) { if (nb[k] < 255) nb[k]++; vus++; } else cad[k] = 1; });
        surf.push(vus * pas2);
      }
      app.occupe(false);
      let vue = 0, multi = 0, cache = 0, ia = g.w, ib = -1, ja = g.h, jb = -1;
      for (let k = 0; k < nMailles; k++) {
        if (nb[k]) { vue++; if (nb[k] > 1) multi++; const i = k % g.w, j = (k - i) / g.w; if (i < ia) ia = i; if (i > ib) ib = i; if (j < ja) ja = j; if (j > jb) jb = j; }
        else if (cad[k]) cache++;
      }
      // Cadrage : le sol vu et les points des prises, avec un peu d'air autour.
      const air = 120 / 111200; let cadre = [o - air, s - air, e + air, n + air];
      if (ib >= 0) { const [lo, ha] = S.versGeo(g.x0 + ia / g.w * (g.x1 - g.x0), g.y1 - ja / g.h * (g.y1 - g.y0)), [ld, ba] = S.versGeo(g.x0 + (ib + 1) / g.w * (g.x1 - g.x0), g.y1 - (jb + 1) / g.h * (g.y1 - g.y0)); cadre = [Math.min(cadre[0], lo), Math.min(cadre[1], ba), Math.max(cadre[2], ld), Math.max(cadre[3], ha)]; }
      bil = { g, nb, cad, surf, cadre, vue: vue * pas2, multi: multi * pas2, cache: cache * pas2 };
      legender(app, c); peindreBilan(app);
      for (const id of couchesDrone) if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', 'none');
      const b = c.querySelector('.dbilan'); b.setAttribute('aria-pressed', 'true'); b.textContent = 'Fermer le bilan';
      const np = plan.length;
      let txt = `Bilan : ${np > 1 ? `les ${np} prises montrent` : 'la prise montre'} <span class="fort">${aire(bil.vue)}</span> de terrain`;
      if (np > 1) txt += bil.multi ? `, dont <span class="fort">${aire(bil.multi)}</span> (${Math.round(100 * bil.multi / (bil.vue || 1))} %) vus par plusieurs prises` : ', sans recouvrement entre elles';
      txt += '.'; if (bil.cache > bil.vue * 0.05) txt += ' Une partie des cadres est cachée derrière le relief (en bleu sombre).';
      c.querySelector('.etat').innerHTML = txt; c.querySelector('.alerte').innerHTML = '';
      majPlan(app, c);
      app.map.fitBounds([[cadre[0], cadre[1]], [cadre[2], cadre[3]]], { padding: app.marges({ top: 70, bottom: Math.round(window.innerHeight * 0.42), left: 24, right: 24 }), maxZoom: 17, duration: 900 });
    }
    function peindreBilan(app) {
      const { g, nb, cad } = bil;
      app.poser('dronevue', g, app.peindre(g, k => {
        if (nb[k] > 1) return masques.has('multi') ? undefined : [42, 157, 143, 150];
        if (nb[k] === 1) return masques.has('vu') ? undefined : [226, 184, 98, 140];
        if (cad[k] && !masques.has('cache')) return [40, 52, 86, 130];
      }), 0.9);
    }
    function quitterBilan(app, c) {
      if (!bil) return; bil = null;
      const b = c.querySelector('.dbilan'); b.setAttribute('aria-pressed', 'false'); b.textContent = 'Bilan du plan';
      legender(app, c);
      for (const id of couchesDrone) if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', 'visible');
      if (!d) app.retirer('dronevue');
      majPlan(app, c);
    }

    async function vueCamera(app, c) {
      if (!d || !d.zSol) return;
      const map = app.map, b = c.querySelector('.apercu');
      if (apercu) { quitterApercu(app); b.textContent = 'Vue caméra'; b.setAttribute('aria-pressed', 'false'); if (pil) pil.maj(); return; }
      if (bil) { quitterBilan(app, c); repeindre(app); }
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
    function approcher(app) {
      if (!d) return; const map = app.map, pt = [d.lon, d.lat];
      map.easeTo({ center: pt, zoom: Math.max(map.getZoom(), 15.3), duration: 900 });
      // En vue inclinée sur le relief, le centre de la carte n'est pas le milieu de l'écran : on décale du même écart
      // que celui qui sépare le point de ce qu'on voit à l'endroit voulu, deux fois au plus (le relief change en chemin).
      const recentrer = n => { if (!pil || !d || d.lon !== pt[0]) return; const r = map.getCanvas().getBoundingClientRect(), cible = [r.width / 2, r.height * 0.46], p = map.project(pt);
        if (n < 1 || Math.hypot(p.x - cible[0], p.y - cible[1]) < 30) return; const ll = map.unproject(cible), c = map.getCenter();
        map.easeTo({ center: [c.lng + pt[0] - ll.lng, c.lat + pt[1] - ll.lat], duration: 300 }); map.once('moveend', () => recentrer(n - 1)); };
      map.once('moveend', () => recentrer(2));
    }
    // Les valeurs du panneau suivent les réglages faits sur la carte.
    function synchro(c) {
      for (const [k, u] of [['h', ' m'], ['cap', '°'], ['nacelle', '°']]) { const b = c.querySelector(`.val[data-k="${k}"] b`); if (b && !b.querySelector('input')) b.textContent = Math.round(etat[k]) + u; }
    }
    /* Saisie d'une valeur exacte : toucher un chiffre du panneau l'ouvre à la frappe. Le clavier chiffré des téléphones
       n'a pas de signe moins : pour la nacelle, on tape l'angle sous l'horizon (30 pour −30°). */
    function saisir(app, c, bouton) {
      const k = bouton.dataset.k, b = bouton.querySelector('b'); if (b.querySelector('input')) return;
      b.innerHTML = `<input type="text" inputmode="decimal" enterkeyhint="done" size="3" value="${Math.abs(Math.round(etat[k]))}" aria-label="Valeur exacte">`;
      const inp = b.querySelector('input'); inp.focus(); inp.select();
      const finir = ok => {
        if (!inp.isConnected) return; let v = parseFloat(inp.value.replace(',', '.')); b.textContent = '';
        if (ok && v === v) { if (k === 'nacelle') v = -Math.abs(v); if (k === 'cap') v = ((v % 360) + 360) % 360; regler(app, c, k, Math.max(BORNES[k][0], Math.min(BORNES[k][1], Math.round(v)))); }
        synchro(c);
      };
      inp.onclick = e => e.stopPropagation();
      inp.onkeydown = e => { if (e.key === 'Enter') finir(true); else if (e.key === 'Escape') { e.stopPropagation(); finir(false); } };
      inp.onblur = () => finir(true);
    }

    // ---------- Prises du plan : choisir, enregistrer, retirer, changer de rang ----------
    function choisir(app, c, i, centrer) {
      const p = plan[i]; if (!p) return;
      if (apercu) vueCamera(app, c);
      sel = i; fraiche = -1; viser = deplacer = false;
      d = { lon: p.lon, lat: p.lat }; garde.ecrire(cle + '.point', d);
      etat.h = p.h; etat.cap = p.cap; etat.nacelle = p.nacelle; retenirReglages(); synchro(c); majPlan(app, c);
      if (centrer) app.map.easeTo({ center: [p.lon, p.lat], duration: 600 });
      calculer(app, c); if (pil) pil.maj();
    }
    function enregistrer(app, c) {
      if (!d || d.zSol == null || sel >= 0) return;
      d.lon = +d.lon.toFixed(7); d.lat = +d.lat.toFixed(7);
      plan.push({ lon: d.lon, lat: d.lat, zSol: +d.zSol.toFixed(1), h: etat.h, cap: etat.cap, nacelle: etat.nacelle, surf: d.surf != null ? Math.round(d.surf) : null, dmax: d.dmax != null ? Math.round(d.dmax) : null });
      sel = fraiche = plan.length - 1; garderPlan(); if (bil) quitterBilan(app, c); majPlan(app, c); if (pil) pil.maj();
    }
    function retirer(app, c, i) {
      if (!plan[i]) return; plan.splice(i, 1);
      if (sel === i) sel = -1; else if (sel > i) sel--;
      fraiche = -1; deplacer = false; garderPlan();
      if (bil) { quitterBilan(app, c); repeindre(app); if (d) calculer(app, c); }
      majPlan(app, c); if (pil) pil.maj();
    }
    function ranger(app, c, i, sens) {
      const j = i + sens; if (!plan[i] || !plan[j]) return;
      [plan[i], plan[j]] = [plan[j], plan[i]]; if (bil) [bil.surf[i], bil.surf[j]] = [bil.surf[j], bil.surf[i]];
      if (sel === i) sel = j; else if (sel === j) sel = i;
      fraiche = -1; garderPlan(); majPlan(app, c); if (pil) pil.maj();
    }

    /* Plein écran : on touche la carte pour poser le drone ; barre de hauteur, barre de nacelle et anneau de cap
       accrochés à lui ; « Enregistrer la prise » range la prise dans le plan de vol, et le toucher suivant pose la prise
       d'après. Toucher une prise déjà enregistrée la reprend. En vue caméra, glisser sur l'écran tourne et incline la caméra. */
    function pleinEcran(app, c) {
      if (pil) return;
      if (bil) { quitterBilan(app, c); calculer(app, c); }
      const valeurs = () => `${Math.round(etat.h)} m${d && d.zSol != null ? ` (${Math.round(d.zSol + etat.h)} m d'altitude)` : ''} · cap ${Math.round(etat.cap)}° · nacelle ${Math.round(etat.nacelle)}°`;
      pil = pilote(app, {
        point: () => d,
        hauteur: { min: BORNES.h[0], max: BORNES.h[1], lire: () => etat.h, ecrire: v => regler(app, c, 'h', v) },
        cap: { lire: () => etat.cap, ecrire: v => regler(app, c, 'cap', v) },
        nacelle: { min: BORNES.nacelle[0], max: BORNES.nacelle[1], lire: () => etat.nacelle, ecrire: v => regler(app, c, 'nacelle', v) },
        recentrer: () => approcher(app),
        actions: [
          { texte: () => 'Viser', actif: () => viser, visible: () => !!d && !apercu, action: () => { viser = !viser; deplacer = false; } },
          { texte: () => 'Vue caméra', actif: () => !!apercu, visible: () => !!d, action: () => { vu.nacelle = true; viser = deplacer = false; vueCamera(app, c); } },
          { texte: () => 'Enregistrer la prise', visible: () => !!d && sel < 0, action: () => enregistrer(app, c) },
          { texte: () => 'Déplacer', actif: () => deplacer, visible: () => sel >= 0 && !apercu, action: () => { deplacer = !deplacer; viser = false; } },
          { texte: () => 'Retirer', visible: () => sel >= 0 && !apercu, action: () => retirer(app, c, sel) }],
        apercu: () => !!apercu,
        geste: {
          debut: () => ({ cap: etat.cap, nac: etat.nacelle }),
          bouge: (dep, dx, dy, H) => { const k = angles(etat.diag).v / H; etat.cap = ((Math.round(dep.cap - dx * k) % 360) + 360) % 360; regler(app, c, 'nacelle', Math.max(-90, Math.min(0, Math.round(dep.nac + dy * k)))); }
        },
        // Une consigne à la fois, dans l'ordre où l'on règle une prise ; une fois le tour fait, les valeurs.
        etat: () => apercu ? 'Glisse sur l\'écran pour regarder autour, ou la barre de droite pour incliner · « Vue caméra » pour revenir à la carte'
          : viser ? 'Touche le point que la caméra doit viser'
          : deplacer ? `Touche le nouvel emplacement de la prise ${sel + 1}`
          : !d ? 'Touche la carte là où le drone décolle'
          : sel >= 0 && fraiche === sel ? `<span class="fort">Prise ${sel + 1} enregistrée.</span> Touche la carte pour poser la suivante, ou « Terminer » pour le bilan et l'export.`
          : sel >= 0 ? `<span class="fort">Prise ${sel + 1} sur ${plan.length}</span> · ${valeurs()} — tes réglages la modifient ; touche ailleurs pour une nouvelle prise`
          : !vu.h ? '<span class="fort">1 · Hauteur</span> — fais glisser la barre à droite du point : le drone monte avec elle'
          : !vu.cap ? '<span class="fort">2 · Cap</span> — fais tourner la poignée dorée autour du point'
          : !vu.nacelle ? '<span class="fort">3 · Nacelle</span> — fais glisser la barre à gauche du point pour incliner la caméra, ou regarde l\'image avec « Vue caméra »'
          : `<span class="fort">${valeurs()}</span> — « Enregistrer la prise » quand le cadre te convient`,
        surFin: () => { if (apercu) vueCamera(app, c); pil = null; viser = deplacer = false; }
      });
    }
    function quitterApercu(app) {
      if (!apercu) return; const map = app.map;
      map.setVerticalFieldOfView(apercu.fov); map.setCenterClampedToGround(true); map.jumpTo(apercu.vue); map.setMaxPitch(78); apercu = null;
      for (const id of ['dronevue', ...couchesDrone, ...couchesPlan]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    }

    // Le plan de vol en tableau : une ligne par prise ; toucher une ligne choisit la prise et montre ce qu'elle voit.
    function majPlan(app, c) {
      dessinerPlan(app, plan, sel);
      c.querySelector('.dplan').hidden = !plan.length;
      c.querySelector('.nplan').textContent = `Plan de vol · ${plan.length} prise${plan.length > 1 ? 's' : ''}`;
      c.querySelector('.prises tbody').innerHTML = plan.map((p, i) => { const s = p.surf != null ? p.surf : bil ? bil.surf[i] : null;
        return `<tr data-i="${i}" aria-selected="${i === sel}"><td>${i + 1}</td><td>${Math.round(p.h)} m</td><td>${Math.round(p.cap)}° ${cap8(p.cap)}</td><td>${Math.round(p.nacelle)}°</td><td>${s != null ? aire(s) : '–'}</td></tr>`; }).join('');
      c.querySelector('.dprise').hidden = sel < 0;
      c.querySelector('.monter').disabled = sel <= 0; c.querySelector('.descendre').disabled = sel < 0 || sel >= plan.length - 1;
    }

    // Fiche à imprimer ou à partager : la carte cadrée sur le plan (avec le bilan s'il est affiché) et le tableau des prises.
    async function fiche(app, c) {
      if (!plan.length) return;
      if (apercu) vueCamera(app, c);
      const map = app.map, ce = map.getCenter(), vue = { center: [ce.lng, ce.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      app.occupe(true, 'Préparation de la fiche…');
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const p of plan) { o = Math.min(o, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
      const dlat = 400 / 111200, dlon = 400 / (111200 * Math.cos(s * RAD)), cadre = bil ? bil.cadre : [o - dlon, s - dlat, e + dlon, n + dlat];
      map.fitBounds([[cadre[0], cadre[1]], [cadre[2], cadre[3]]], { padding: 40, pitch: 0, bearing: 0, maxZoom: 17, duration: 0 });
      await Promise.race([new Promise(r => map.once('idle', r)), new Promise(r => setTimeout(r, 7000))]);
      const image = await new Promise(r => { map.once('render', () => { try { r(map.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (err) { r(''); } }); map.triggerRepaint(); });
      map.jumpTo(vue); app.occupe(false);
      let f = document.getElementById('fiche'); if (!f) { f = document.createElement('div'); f.id = 'fiche'; document.body.append(f); }
      const lignes = plan.map((p, i) => { const surf = p.surf != null ? p.surf : bil ? bil.surf[i] : null;
        return `<tr><td>${i + 1}</td><td>${p.lat.toFixed(6)}</td><td>${p.lon.toFixed(6)}</td><td>${Math.round(p.zSol)} m</td><td>${Math.round(p.h)} m</td><td>${Math.round(p.zSol + p.h)} m</td><td>${Math.round(p.cap)}° ${cap8(p.cap)}</td><td>${Math.round(p.nacelle)}°</td><td>${surf != null ? aire(surf) : '–'}</td></tr>`; }).join('');
      f.innerHTML = `<h1>${app.propre(opts.nom || 'Plan de vol')}</h1><p class="sous">${app.propre(modele().nom)} · ${plan.length} prise${plan.length > 1 ? 's' : ''} · fiche préparée le ${new Date().toLocaleDateString('fr-FR')}</p>
        ${image ? `<img src="${image}" alt="Carte du plan de vol">` : ''}
        <table><thead><tr><th>Prise</th><th>Latitude</th><th>Longitude</th><th>Sol</th><th>Hauteur</th><th>Altitude de vol</th><th>Cap</th><th>Nacelle</th><th>Sol vu</th></tr></thead><tbody>${lignes}</tbody></table>
        ${bil ? `<p>Ensemble des prises : <b>${aire(bil.vue)}</b> de terrain vus${plan.length < 2 ? '' : bil.multi ? `, dont ${aire(bil.multi)} par plusieurs prises` : ', sans recouvrement entre les prises'}.</p>` : ''}
        <p class="pied">Hauteurs comptées au-dessus du point de décollage de chaque prise ; nacelle : 0° à l'horizon, −90° à la verticale. Relief : IGN, sans arbres ni bâtiments. Calculs faits dans la page, à vérifier sur le terrain. Cette fiche ne dit pas où le vol est autorisé.</p>`;
      setTimeout(() => window.print(), 150);
    }

    const q = {
      theme: opts.theme || 'Drone', libelle: opts.libelle || 'Que verra la caméra ?',
      aide: 'Le drone est posé là où l\'on touche, à la hauteur choisie au-dessus de ce point. Chaque maille du relief est projetée dans le cadre de la caméra (format 4:3, angle de champ du modèle), puis on vérifie qu\'aucune crête ne la cache. En doré, le sol que la photo montrera, plus pâle au loin ; en bleu sombre, ce qui est dans le cadre mais caché par le relief. Tout se règle sur la carte : la hauteur à droite du point, la nacelle à gauche, le cap autour ; toucher un chiffre du panneau permet de taper une valeur exacte. Toucher le point d\'une prise enregistrée montre ce qu\'elle voit et permet de la corriger. « Bilan du plan » réunit toutes les prises : en vert, ce que plusieurs d\'entre elles voient. « Vue caméra » place la vue 3D à la position du drone : le cadre du téléphone n\'a pas les proportions de la photo, c\'est un aperçu. Les angles de champ sont ceux des fiches constructeur, à vérifier ; le relief est le modèle de terrain de l\'IGN, sans arbres ni bâtiments. La carte ne dit pas où le vol est autorisé.',
      async ouvrir(app) {
        const puce = (k, lib, u) => `<button class="val" data-k="${k}" aria-label="${lib} : toucher pour taper une valeur exacte">${lib} <b>${Math.round(etat[k])}${u}</b></button>`;
        const c = app.repondre(q.libelle, `<p class="etat"></p><div class="alerte"></div>
          <div class="legende"></div>
          <div class="pose" hidden>
          <div class="puces valeurs">${puce('h', 'Hauteur', ' m')}${puce('cap', 'Cap', '°')}${puce('nacelle', 'Nacelle', '°')}</div>
          <p class="petit2 v-alt" style="margin:2px 0 6px"></p>
          <div class="puces"><button class="plein" aria-pressed="true">Reprendre le réglage sur la carte</button><button class="apercu" aria-pressed="false">Vue caméra</button></div>
          </div>
          <div class="dplan" hidden>
          <p class="petit2 nplan" style="margin:10px 0 2px"></p>
          <table class="prises"><thead><tr><th>Prise</th><th>Hauteur</th><th>Cap</th><th>Nacelle</th><th>Sol vu</th></tr></thead><tbody></tbody></table>
          <div class="puces dprise" hidden><button class="monter">Monter</button><button class="descendre">Descendre</button><button class="surcarte">Régler sur la carte</button><button class="oter">Retirer</button></div>
          <div class="puces exports"><button class="dbilan" aria-pressed="false">Bilan du plan</button><button class="kml">KML</button><button class="csv">Litchi (CSV)</button><button class="dfiche">Fiche</button><button class="raz">Tout effacer</button></div>
          </div>
          <div class="ligne" style="margin-top:10px"><label style="min-width:72px">Drone</label><select class="mod">${MODELES.map(x => `<option value="${x.id}"${x.id === etat.modele ? ' selected' : ''}>${x.nom}</option>`).join('')}</select></div>
          <div class="ligne angle" style="display:${etat.modele === 'autre' ? 'flex' : 'none'}"><label style="min-width:72px">Angle</label><input type="range" class="diag" min="40" max="120" step="1" value="${etat.diag}" style="flex:1;min-width:110px"><span class="fort v-diag">${Math.round(etat.diag)}°</span></div>
          <p class="petit">Le format Litchi est celui que je connais de leurs missions : à ouvrir dans Litchi Mission Hub et à contrôler avant tout vol.</p>`);
        q._c = c;
        legender(app, c);
        const relancer = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { retenirReglages(); calculer(app, c); }, 220); }; })();
        q._relancer = relancer;
        c.querySelector('.diag').oninput = e => { etat.diag = +e.target.value; c.querySelector('.v-diag').textContent = Math.round(etat.diag) + '°'; placer(app); relancer(); };
        c.querySelector('.mod').onchange = e => { etat.modele = e.target.value; const mo = modele(); if (mo.id !== 'autre') etat.diag = mo.diag; c.querySelector('.angle').style.display = mo.id === 'autre' ? 'flex' : 'none'; c.querySelector('.diag').value = etat.diag; c.querySelector('.v-diag').textContent = Math.round(etat.diag) + '°'; relancer(); };
        c.querySelectorAll('.val').forEach(b => { b.onclick = () => saisir(app, c, b); });
        c.querySelector('.apercu').onclick = () => vueCamera(app, c);
        c.querySelector('.plein').onclick = () => { pleinEcran(app, c); approcher(app); };
        c.querySelector('.prises tbody').onclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) choisir(app, c, +tr.dataset.i, true); };
        c.querySelector('.monter').onclick = () => ranger(app, c, sel, -1);
        c.querySelector('.descendre').onclick = () => ranger(app, c, sel, 1);
        c.querySelector('.surcarte').onclick = () => { pleinEcran(app, c); approcher(app); };
        c.querySelector('.oter').onclick = () => retirer(app, c, sel);
        c.querySelector('.dbilan').onclick = () => { if (bil) { quitterBilan(app, c); repeindre(app); if (d) calculer(app, c); } else bilan(app, c); };
        const attendre = () => { app.occupe(true, 'Altitude d\'une prise en cours de lecture, réessaie dans un instant'); setTimeout(() => app.occupe(false), 2500); };
        c.querySelector('.kml').onclick = () => !pret() ? attendre() : plan.length && exporter((opts.cle || 'drone') + '-plan.kml', 'application/vnd.google-earth.kml+xml', kml(plan, opts.nom || 'Plan de vol'));
        c.querySelector('.csv').onclick = () => !pret() ? attendre() : plan.length && exporter((opts.cle || 'drone') + '-litchi.csv', 'text/csv', litchi(plan));
        c.querySelector('.dfiche').onclick = () => !pret() ? attendre() : fiche(app, c);
        // « Tout effacer » demande un second toucher : un plan de vol ne se refait pas en deux gestes.
        let sur = 0; c.querySelector('.raz').onclick = e => {
          if (Date.now() > sur) { sur = Date.now() + 3000; e.target.textContent = 'Effacer tout le plan ?'; setTimeout(() => { if (e.target.isConnected) e.target.textContent = 'Tout effacer'; }, 3000); return; }
          sur = 0; e.target.textContent = 'Tout effacer'; plan = []; sel = fraiche = -1; deplacer = false; garderPlan(); if (bil) { quitterBilan(app, c); repeindre(app); } majPlan(app, c); if (d) calculer(app, c);
        };
        if (!d) { const p = garde.lire(cle + '.point', null) || plan[plan.length - 1]; if (p) d = { lon: p.lon, lat: p.lat }; }
        // Le point retrouvé est-il celui d'une prise du plan ? Alors c'est elle qu'on reprend, pas une prise de plus.
        sel = d ? plan.findIndex(p => Math.abs(p.lon - d.lon) < 2e-7 && Math.abs(p.lat - d.lat) < 2e-7) : -1;
        if (sel >= 0) { const p = plan[sel]; d = { lon: p.lon, lat: p.lat }; etat.h = p.h; etat.cap = p.cap; etat.nacelle = p.nacelle; }
        synchro(c); majPlan(app, c);
        await calculer(app, c);
      },
      toucher(app, ll) {
        if (apercu) return;
        const c = q._c, map = app.map;
        if (viser && d) {
          // Orienter vers le point touché : cap, puis inclinaison vers son altitude.
          etat.cap = Math.round(azimut([d.lon, d.lat], [ll.lng, ll.lat]) / 5) * 5 % 360;
          let zt = d.zSol || 0; if (d.g) { const [fi, fj] = position(d.g, ll.lng, ll.lat); if (fi >= 0 && fj >= 0 && fi <= d.g.w - 1 && fj <= d.g.h - 1) zt = alt(d.g, fi, fj); }
          const dist = S.distKm([d.lon, d.lat], [ll.lng, ll.lat]) * 1000;
          etat.nacelle = Math.max(-90, Math.min(0, Math.round(Math.atan2(zt - (d.zSol + etat.h), dist) / RAD / 5) * 5));
          viser = false; vu.cap = vu.nacelle = true; fraiche = -1; reporter(app, c); synchro(c); retenirReglages();
        } else if (deplacer && sel >= 0 && plan[sel]) {
          // La prise choisie change de place ; ses réglages la suivent, son sol est relu.
          const p = plan[sel]; p.lon = +ll.lng.toFixed(7); p.lat = +ll.lat.toFixed(7); p.zSol = p.surf = p.dmax = null;
          d = { lon: p.lon, lat: p.lat }; deplacer = false; fraiche = -1; garde.ecrire(cle + '.point', d); garderPlan(); majPlan(app, c); solDe(app, p);
        } else {
          // Le doigt est-il sur une prise du plan ? On la choisit : la carte montre ce qu'elle voit.
          const pt = map.project([ll.lng, ll.lat]); let i = -1, pres = 24;
          plan.forEach((p, k) => { const s = map.project([p.lon, p.lat]), e = Math.hypot(s.x - pt.x, s.y - pt.y); if (e < pres) { pres = e; i = k; } });
          if (i >= 0) { if (i !== sel) choisir(app, c, i); return; }
          d = { lon: ll.lng, lat: ll.lat }; sel = fraiche = -1; garde.ecrire(cle + '.point', d); majPlan(app, c);
          if (!pil) { pleinEcran(app, c); approcher(app); }
          if (!garde.lire('cartes.drone.reglages', null)) { etat.cap = ((Math.round(app.map.getBearing() / 5) * 5) % 360 + 360) % 360; synchro(c); }
        }
        calculer(app, c); if (pil) pil.maj();
      },
      fermer(app) { tour++; if (pil) pil.fermer(); quitterApercu(app); viser = deplacer = false; bil = null; sel = fraiche = -1; app.retirer('dronevue', ...couchesDrone, ...couchesPlan); for (const s of ['drone', 'droneplan']) if (app.map.getSource(s)) app.map.removeSource(s); matCourant = null; }
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
        // Plein écran : la barre de hauteur seule, accrochée au point de décollage ; la carte reste libre pour voir où passe la limite des 120 m.
        c.querySelector('.plein').onclick = () => {
          if (pil) return;
          pil = pilote(app, {
            point: () => d,
            hauteur: { min: 20, max: 120, lire: () => etat.hVol, ecrire: v => { etat.hVol = v; inp.value = v; c.querySelector('.v-hv').textContent = v + ' m'; if (d) leverMat(app, d.lon, d.lat, v); pil.maj(); relancer(); } },
            etat: () => !d ? 'Touche la carte à l\'endroit d\'où tu décolles' : `Vol à <span class="fort">${Math.round(etat.hVol)} m</span> au-dessus du décollage${d.z0 != null ? `, soit ${Math.round(d.z0 + etat.hVol)} m d'altitude` : ''}`,
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
