/* Thème « Itinéraire » : on touche la carte pour poser les points d'un tracé ; la carte en tire le profil, la distance,
   le dénivelé, et une lecture propre à chaque carte (opts.analyse). Le tracé est gardé sur l'appareil, s'exporte en GPX
   et s'imprime en fiche. */
(function () {
  'use strict';
  const S = window.Socle, ROSE = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const km = m => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m / 10) * 10 + ' m';
  const heure = m => { m = ((Math.round(m / 5) * 5) % 1440 + 1440) % 1440; return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  const duree = h => { const m = Math.round(h * 60 / 5) * 5; return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };

  // Altitude interpolée entre les quatre mailles voisines.
  function altitude(g, lon, lat) {
    const [x, y] = S.versMerc(lon, lat), fx = (x - g.x0) / (g.x1 - g.x0) * g.w - 0.5, fy = (g.y1 - y) / (g.y1 - g.y0) * g.h - 0.5;
    const i = Math.max(0, Math.min(g.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(g.h - 2, Math.floor(fy))), u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j));
    const a = g.z[j * g.w + i], b = g.z[j * g.w + i + 1], c = g.z[(j + 1) * g.w + i], d = g.z[(j + 1) * g.w + i + 1];
    if (a !== a || b !== b || c !== c || d !== d) { const k = [a, b, c, d].filter(q => q === q); return k.length ? k.reduce((s, q) => s + q, 0) / k.length : NaN; }
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function trace(opts) {
    opts = opts || {};
    const cle = 'cartes.trace.' + (opts.cle || 'defaut');
    /* pts : les points posés. brins : le chemin entre deux points posés (brins[i] va de pts[i] à pts[i + 1]) : une ligne
       droite, ou, avec opts.sentiers, le chemin que le calcul d'itinéraire piéton de l'IGN trouve sur les sentiers et les
       routes de la BD TOPO. */
    let depart = 480;        // heure de départ, en minutes depuis minuit (8 h par défaut) : elle donne l'heure de passage en chaque point
    let profilVu = false;    // le profil du tracé gardé, en bandeau sous les autres thèmes (pastille « Tracé », « Profil »)
    let gardeTrace = true;   // le tracé reste dessiné quand on change de thème (pour rejoindre un point de vol, une cueillette…)
    let pts = [], brins = [], surSentiers = opts.sentiers === true;   // opts.sentiers : true (suivi d'office), 'choix' (bouton proposé, éteint au départ)
    try { const v = JSON.parse(localStorage.getItem(cle)); if (Array.isArray(v)) pts = v; else if (v && v.pts) { pts = v.pts; brins = v.brins || []; surSentiers = opts.sentiers ? (v.sentiers == null ? surSentiers : !!v.sentiers) : false; gardeTrace = v.garde !== false; profilVu = !!v.profil; if (v.depart >= 0 && v.depart < 1440) depart = v.depart; } } catch (e) { pts = []; }
    for (let i = 0; i < pts.length - 1; i++) if (!brins[i] || brins[i].length < 2) brins[i] = [pts[i], pts[i + 1]];
    brins.length = Math.max(0, pts.length - 1);
    const garder = () => { try { localStorage.setItem(cle, JSON.stringify({ pts, brins, sentiers: surSentiers, garde: gardeTrace, profil: profilVu, depart })); } catch (e) { } };
    /* Tracés enregistrés : « Enregistrer » range le tracé en cours sous un nom, sur l'appareil ; la rangée du panneau les
       ressort d'un toucher (le tracé en cours est alors remplacé). Ils ne quittent pas l'appareil : le GPX sert à les
       emporter ailleurs. */
    const cleGardes = cle + '.gardes';
    let gardes = []; try { const v = JSON.parse(localStorage.getItem(cleGardes)); if (Array.isArray(v)) gardes = v.filter(g => g && g.nom && Array.isArray(g.pts)); } catch (e) { gardes = []; }
    let courant = null;      // nom du tracé enregistré que l'on a sous les yeux, tant qu'on ne l'a pas modifié
    const rangerGardes = () => { try { localStorage.setItem(cleGardes, JSON.stringify(gardes)); } catch (e) { } };
    const chemin = () => { const l = []; brins.forEach((b, i) => { for (let k = i ? 1 : 0; k < b.length; k++) l.push(b[k]); }); return l; };
    async function brin(a, b) {
      if (!surSentiers) return [a, b];
      try {
        const r = await fetch(`${S.GEOPF}/navigation/itineraire?resource=bdtopo-osrm&profile=pedestrian&optimization=shortest&start=${a[0]},${a[1]}&end=${b[0]},${b[1]}&geometryFormat=geojson&getSteps=false`);
        const g = r.ok ? (await r.json()).geometry : null, c = g && g.coordinates;
        if (!c || c.length < 2) return [a, b];
        // Le calcul part du chemin le plus proche : on raccorde aux points posés. Un détour démesuré (pas de sentier ici) : ligne droite.
        const droit = S.distKm(a, b), l = c.map(q => [+q[0].toFixed(6), +q[1].toFixed(6)]);
        if (S.distKm(a, l[0]) > Math.max(0.4, droit) || S.distKm(b, l[l.length - 1]) > Math.max(0.4, droit)) return [a, b];
        return [a, ...l, b];
      } catch (e) { return [a, b]; }
    }
    let d = null, tour = 0, suivi = null;
    // Échantillon du tracé le plus proche d'une distance (m) depuis le départ, ou d'un point de la carte.
    const indiceA = s => { let a = 0, b = d.dist.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (d.dist[m] < s) a = m; else b = m; } return s - d.dist[a] < d.dist[b] - s ? a : b; };
    const indicePres = ll => { const k = Math.cos(ll.lat * Math.PI / 180); let im = 0, dm = Infinity; d.xy.forEach((p, i) => { const dx = (p[0] - ll.lng) * k, dy = p[1] - ll.lat, q = dx * dx + dy * dy; if (q < dm) { dm = q; im = i; } }); return im; };
    /* Le profil se suit du doigt : distance, altitude, pente du tracé (sur une centaine de mètres) et, là où elle compte,
       pente du versant sous le tracé ; le repère se pose au même endroit sur la carte. */
    function lier(app, svg, phrase, bas, lacher) {
      if (!svg || !d) return null;
      const dd = d, n = dd.dist.length;
      return app.suiviProfil(svg, { x0: 4, x1: 316, total: dd.total, y: [6, bas], phrase, lacher: lacher && (s => lacher(dd.xy[indiceA(s)])), ici(s) {
        if (dd !== d) return null;
        const i = indiceA(s); let a = i, b = i; while (a > 0 && dd.dist[i] - dd.dist[a] < 50) a--; while (b < n - 1 && dd.dist[b] - dd.dist[i] < 50) b++;
        const pc = dd.dist[b] > dd.dist[a] ? (dd.z[b] - dd.z[a]) / (dd.dist[b] - dd.dist[a]) * 100 : 0, v = dd.pente[i];
        return { p: dd.xy[i], texte: `<span class="fort">${km(dd.dist[i])}</span> · <span class="fort">${Math.round(dd.z[i])} m</span> · ${pc >= 0.5 ? 'montée' : pc <= -0.5 ? 'descente' : 'plat'}${Math.abs(pc) >= 0.5 ? ' ' + Math.round(Math.abs(pc)) + ' %' : ''}${opts.seuilPente !== false && v === v ? ` · versant ${Math.round(v)}°` : ''} · vers <span class="fort">${heure(depart + dd.temps[i] * 60)}</span>` };
      } });
    }
    // À la souris, le sens inverse : survoler le tracé sur la carte place le trait sur le profil (au doigt, toucher la carte pose un point).
    const surTrace = e => { if (suivi && d && e.originalEvent && e.originalEvent.buttons === 0) suivi.montrer(d.dist[indicePres(e.lngLat)]); }, horsTrace = () => { if (suivi) suivi.effacer(); };

    function dessinerLigne(app) {
      const fc = { type: 'FeatureCollection', features: [] };
      if (pts.length > 1) fc.features.push({ type: 'Feature', properties: { r: 'ligne' }, geometry: { type: 'LineString', coordinates: chemin() } });
      if (d && d.raide.length) fc.features.push({ type: 'Feature', properties: { r: 'raide' }, geometry: { type: 'MultiLineString', coordinates: d.raide } });
      pts.forEach((p, i) => fc.features.push({ type: 'Feature', properties: { r: i === 0 ? 'depart' : i === pts.length - 1 ? 'arrivee' : 'point' }, geometry: { type: 'Point', coordinates: p } }));
      if (d && d.repere) fc.features.push({ type: 'Feature', properties: { r: 'repere', nom: d.repere === d.repereAnalyse ? (d.repereNom || '') : '' }, geometry: { type: 'Point', coordinates: d.repere } });
      const m = app.map;
      if (m.getSource('trace')) { m.getSource('trace').setData(fc); return; }
      m.addSource('trace', { type: 'geojson', data: fc });
      m.addLayer({ id: 'trace-bord', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'ligne'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'trace-ligne', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'ligne'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a2e4a', 'line-width': 4 } });
      m.addLayer({ id: 'trace-raide', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'raide'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#e63946', 'line-width': 4 } });
      m.addLayer({ id: 'trace-points', type: 'circle', source: 'trace', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': ['match', ['get', 'r'], 'point', 4, 'repere', 8, 7], 'circle-color': ['match', ['get', 'r'], 'depart', '#2a9d8f', 'arrivee', '#b8963e', 'repere', '#e63946', '#1a2e4a'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      // Le point rouge porte son nom (ce que l'analyse de la carte y signale : la pente la plus forte, par exemple).
      m.addLayer({ id: 'trace-repere-nom', type: 'symbol', source: 'trace', filter: ['==', ['get', 'r'], 'repere'], layout: { 'text-field': ['get', 'nom'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 12.5, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#8f1d27', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    }

    // Profil en long : aire sous la courbe, tronçons raides en rouge, repères d'altitude et de distance.
    function profil(d, large, haut) {
      const W = large || 320, H = haut || 96, mg = 4, z0 = Math.floor(d.zmin / 50) * 50, z1 = Math.max(z0 + 50, Math.ceil(d.zmax / 50) * 50);
      const X = s => mg + (W - 2 * mg) * s / d.total, Y = z => H - 14 - (H - 26) * (z - z0) / (z1 - z0);
      let chemin = '', rouge = '';
      d.dist.forEach((s, i) => { chemin += (i ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(d.z[i]).toFixed(1); });
      for (let i = 1; i < d.dist.length; i++) if (d.fort[i]) rouge += `M${X(d.dist[i - 1]).toFixed(1)} ${Y(d.z[i - 1]).toFixed(1)}L${X(d.dist[i]).toFixed(1)} ${Y(d.z[i]).toFixed(1)}`;
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profil du tracé" style="display:block;margin:4px 0">
        <path d="${chemin}L${X(d.total).toFixed(1)} ${H - 14}L${mg} ${H - 14}Z" fill="currentColor" opacity="0.14"/>
        <path d="${chemin}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="${rouge}" fill="none" stroke="#e63946" stroke-width="2.6" stroke-linecap="round"/>
        <text x="${mg}" y="10" font-size="9" fill="currentColor" opacity="0.75">${Math.round(d.zmax)} m</text>
        <text x="${mg}" y="${H - 3}" font-size="9" fill="currentColor" opacity="0.75">${Math.round(d.zmin)} m · départ</text>
        <text x="${W - mg}" y="${H - 3}" font-size="9" fill="currentColor" opacity="0.75" text-anchor="end">${km(d.total)}</text></svg>`;
    }

    // La phrase du tracé : longueur, dénivelé, puis l'horaire (départ choisi, arrivée estimée).
    const resume = () => `<span class="fort">${km(d.total)}</span>, <span class="fort">+${Math.round(d.dplus)} m</span> / −${Math.round(d.dmoins)} m · départ ${heure(depart)}, arrivée vers <span class="fort">${heure(depart + d.heures * 60)}</span> (${duree(d.heures)}, pauses non comprises). De ${Math.round(d.z[0])} m à ${Math.round(d.z[d.z.length - 1])} m${d.zmax > Math.max(d.z[0], d.z[d.z.length - 1]) + 5 ? `, point haut ${Math.round(d.zmax)} m` : ''}.`;
    const majHeure = c => { const b = c && c.querySelector('.hdep'); if (b) b.textContent = 'Départ ' + heure(depart); if (c && d && !(suivi && suivi.actif)) c.querySelector('.etat').innerHTML = resume(); if (bandeau) { bandeau._d = null; majBandeau(); } };
    async function calculer(app, c) {
      const moi = ++tour; d = null; app.survol.maj();
      suivi = null; app.repereProfil(null);
      if (pts.length < 2) { c.querySelector('.profil').innerHTML = ''; c.querySelector('.bilan').innerHTML = ''; c.querySelector('.etat').textContent = pts.length ? 'Départ posé. Touche la carte pour poser le point suivant.' : (opts.intro || 'Touche la carte pour poser le départ, puis chaque point de passage.'); dessinerLigne(app); return; }
      // emprise du tracé, élargie pour que les calculs voient le relief alentour
      const lg = chemin();
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const p of lg) { o = Math.min(o, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
      const latm = (s + n) / 2, mx = Math.max((e - o) * 0.3, 0.006 / Math.cos(latm * Math.PI / 180)), my = Math.max((n - s) * 0.3, 0.006);
      const b = [o - mx, s - my, e + mx, n + my], largM = (b[2] - b[0]) * 111200 * Math.cos(latm * Math.PI / 180);
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await app.grille(b, Math.max(200, Math.min(700, largM / 6)), { couche: opts.couche }); } catch (err) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      const a = app.pentes(g);
      // échantillonnage régulier le long du tracé
      const seg = []; let total = 0; for (let i = 1; i < lg.length; i++) { const l = app.distKm(lg[i - 1], lg[i]) * 1000; seg.push(l); total += l; }
      const pas = Math.max(g.pas * 0.8, total / 800), dist = [], z = [], xy = [], pt = [], ex = [];
      for (let i = 0, acc = 0; i < seg.length; i++) {
        const nb = Math.max(1, Math.round(seg[i] / pas));
        for (let k = (i ? 1 : 0); k <= nb; k++) {
          const f = k / nb, lon = lg[i][0] + (lg[i + 1][0] - lg[i][0]) * f, lat = lg[i][1] + (lg[i + 1][1] - lg[i][1]) * f, kk = app.indice(g, lon, lat);
          dist.push(acc + seg[i] * f); z.push(altitude(g, lon, lat)); xy.push([lon, lat]); pt.push(kk >= 0 ? a.pente[kk] : NaN); ex.push(kk >= 0 ? a.expo[kk] : NaN);
        }
        acc += seg[i];
      }
      for (let i = 0; i < z.length; i++) if (z[i] !== z[i]) z[i] = i ? z[i - 1] : (z.find(v => v === v) || 0);
      // dénivelés : on ne compte une montée ou une descente qu'au-delà de 3 m, pour ne pas additionner le grain du relevé
      let dplus = 0, dmoins = 0, ref = z[0], zmin = Infinity, zmax = -Infinity, imin = 0, imax = 0;
      z.forEach((v, i) => { if (v - ref > 3) { dplus += v - ref; ref = v; } else if (ref - v > 3) { dmoins += ref - v; ref = v; } if (v < zmin) { zmin = v; imin = i; } if (v > zmax) { zmax = v; imax = i; } });
      /* Temps de marche cumulé en chaque point : le plat (km/h) et le dénivelé (m/h en montée, en descente) comptés
         chacun de leur côté, puis le plus long des deux plus la moitié de l'autre (règle des topos de randonnée).
         Les allures sont celles de la carte (opts.allure) ; les pauses ne sont pas comptées. */
      const al = Object.assign({ plat: 4, montee: 300, descente: 500 }, opts.allure || {}), temps = new Float32Array(z.length);
      { let r2 = z[0], cp = 0, cm = 0; z.forEach((v, i) => { if (v - r2 > 3) { cp += v - r2; r2 = v; } else if (r2 - v > 3) { cm += r2 - v; r2 = v; } const a = dist[i] / 1000 / al.plat, b = cp / al.montee + cm / al.descente; temps[i] = Math.max(a, b) + Math.min(a, b) / 2; }); }
      const seuil = opts.seuilPente || 30, fort = pt.map(p => p >= seuil), raide = []; let cours = null;
      fort.forEach((f, i) => { if (f) { if (!cours) { cours = [xy[Math.max(0, i - 1)]]; raide.push(cours); } cours.push(xy[i]); } else cours = null; });
      d = { pts, g, a, dist, z, xy, pente: pt, expo: ex, fort, raide: opts.seuilPente === false ? [] : raide, total, dplus, dmoins, zmin, zmax, imin, imax, temps, heures: temps[temps.length - 1], allure: al, repere: null };
      if (opts.seuilPente === false) d.fort = d.fort.map(() => false);
      c.querySelector('.etat').innerHTML = resume();
      c.querySelector('.profil').innerHTML = profil(d); suivi = lier(app, c.querySelector('.profil svg'), c.querySelector('.etat'), 82);
      let html = ''; try { html = opts.analyse ? await opts.analyse(app, d) : ''; } catch (err) { console.error(err); html = '<p class="petit">L\'analyse du tracé n\'a pas abouti.</p>'; }
      if (moi !== tour || app.active !== q) return;
      c.querySelector('.bilan').innerHTML = html; d.bilan = html; d.repereAnalyse = d.repere; dessinerLigne(app); app.survol.maj();
      if (opts.apres) opts.apres(app, c, d);
    }

    function gpx() {
      const t = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="cartes" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${opts.nom || 'Tracé'}</name><trkseg>\n` +
        (d ? d.xy.map((p, i) => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"><ele>${d.z[i].toFixed(0)}</ele></trkpt>`) : pts.map(p => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"></trkpt>`)).join('\n') + '\n</trkseg></trk></gpx>';
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/gpx+xml' })); a.download = (opts.cle || 'trace') + '.gpx'; document.body.append(a); a.click(); a.remove();
    }

    // Fiche à imprimer : la carte cadrée sur le tracé, le profil, les chiffres et l'analyse.
    async function imprimer(app) {
      if (!d) return;
      const m = app.map, vue = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
      app.occupe(true, 'Préparation de la fiche…');
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const p of chemin()) { o = Math.min(o, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
      const carte = document.querySelector('.reponse'); carte.style.visibility = 'hidden';
      m.fitBounds([[o, s], [e, n]], { padding: 60, pitch: 0, bearing: 0, duration: 0 });
      await Promise.race([new Promise(r => m.once('idle', r)), new Promise(r => setTimeout(r, 7000))]);
      const image = await new Promise(r => { m.once('render', () => { try { r(m.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (err) { r(''); } }); m.triggerRepaint(); });
      carte.style.visibility = ''; m.jumpTo(vue); app.occupe(false);
      let f = document.getElementById('fiche'); if (!f) { f = document.createElement('div'); f.id = 'fiche'; document.body.append(f); }
      f.innerHTML = `<h1>${app.propre(opts.nom || 'Tracé')}</h1><p class="sous">${app.propre(app.cfg.sousTitre || '')} · fiche préparée le ${new Date().toLocaleDateString('fr-FR')}</p>
        ${image ? `<img src="${image}" alt="Carte du tracé">` : ''}
        <p><b>${km(d.total)}</b> · <b>+${Math.round(d.dplus)} m</b> / −${Math.round(d.dmoins)} m · départ ${Math.round(d.z[0])} m · arrivée ${Math.round(d.z[d.z.length - 1])} m · point haut ${Math.round(d.zmax)} m</p>
        <p>Départ à <b>${heure(depart)}</b>, arrivée vers <b>${heure(depart + d.heures * 60)}</b> : ${duree(d.heures)} sans les pauses, à ${String(d.allure.plat).replace('.', ',')} km/h sur le plat, ${d.allure.montee} m/h en montée et ${d.allure.descente} m/h en descente.</p>
        ${profil(d, 640, 170)}<div class="bilan">${d.bilan || ''}</div>
        <p class="pied">${opts.pied || ''} Altitudes : IGN. Calculs faits dans la page, à vérifier sur le terrain.</p>`;
      setTimeout(() => window.print(), 150);
    }

    /* Hors du thème, un tracé gardé sur la carte porte une pastille « Tracé » : un toucher propose de le masquer, de
       l'effacer ou de le reprendre, sans avoir à revenir au thème pour s'en défaire. */
    let pastille = null, appli = null, bandeau = null, caleur = null;
    /* « Profil » de la pastille : le profil du tracé gardé, en bandeau au-dessus des commandes du thème en cours. Le doigt
       s'y promène comme dans le thème ; quand on le lève, le thème en cours répond pour cet endroit du tracé (l'épaisseur
       de neige, la pente, la météo, la forêt…), comme si l'on avait touché la carte là. */
    const majBandeau = () => {
      const voir = profilVu && !!d && !!pastille && !pastille.hidden;
      if (pastille) { const b = pastille.querySelector('.pr'); b.hidden = !d; b.setAttribute('aria-pressed', String(voir)); }
      if (!voir) { if (bandeau && !bandeau.hidden) { bandeau.hidden = true; clearInterval(caleur); appli.repereProfil(null); } return; }
      if (!bandeau) {
        bandeau = document.createElement('div'); bandeau.className = 'bandeautrace';
        bandeau.innerHTML = '<div class="tete"><p class="etat"></p><button class="x" aria-label="Fermer le profil">×</button></div><div class="dessin"></div>';
        bandeau.querySelector('.x').onclick = () => { profilVu = false; garder(); majBandeau(); };
        document.body.append(bandeau);
      }
      if (bandeau._d !== d) {
        bandeau._d = d;
        bandeau.querySelector('.etat').innerHTML = `<span class="fort">${km(d.total)}</span>, +${Math.round(d.dplus)} m / −${Math.round(d.dmoins)} m · départ ${heure(depart)}, arrivée vers ${heure(depart + d.heures * 60)}`;
        bandeau.querySelector('.dessin').innerHTML = profil(d, 320, 74);
        lier(appli, bandeau.querySelector('svg'), bandeau.querySelector('.etat'), 60, p => { const a = appli.active; if (a && a !== q && a.toucher && a.auTrace !== false) { try { a.toucher(appli, new maplibregl.LngLat(p[0], p[1])); } catch (e) { console.error(e); } } });
      }
      bandeau.hidden = false;
      // Le bandeau se pose au-dessus de ce qui occupe le bas de l'écran : commandes du plein écran, panneau du thème, puces.
      const caler = () => {
        let haut = innerHeight, gauche = 0;
        for (const e of document.querySelectorAll('.pilote.plein .p-bas, .bas, .reponse')) { const r = e.getBoundingClientRect(); if (!r.height || !r.width) continue; if (r.width < innerWidth * 0.6) { if (r.left < 40) gauche = Math.max(gauche, r.right); continue; } if (r.top > innerHeight * 0.25) haut = Math.min(haut, r.top); }
        bandeau.style.bottom = Math.max(10, innerHeight - haut + 8) + 'px'; bandeau.style.left = gauche + 10 + 'px';
      };
      caler(); clearInterval(caleur); caleur = setInterval(caler, 400);
    };
    const oter = app => { app.retirer('trace-repere-nom', 'trace-points', 'trace-raide', 'trace-ligne', 'trace-bord'); if (app.map.getSource('trace')) app.map.removeSource('trace'); };
    const majPastille = () => {
      const voir = !!appli && appli.active !== q && gardeTrace && pts.length > 1 && !!appli.map.getSource('trace');
      if (!voir) { if (pastille) pastille.hidden = true; majBandeau(); return; }
      if (!pastille) {
        pastille = document.createElement('div'); pastille.className = 'pastilletrace';
        pastille.innerHTML = `<button class="p" aria-expanded="false" title="Tracé gardé sur la carte"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 19c2.5-6 5-2 7.5-7S16 6 19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/></svg> Tracé</button>
          <div class="choix" hidden><button class="pr" aria-pressed="false">Profil</button><button class="m">Masquer le tracé</button><button class="e">Effacer le tracé</button><button class="r">Le modifier</button></div>`;
        document.body.append(pastille);
        const b = pastille.querySelector('.p'), choix = pastille.querySelector('.choix'), plier = () => { choix.hidden = true; b.setAttribute('aria-expanded', 'false'); };
        b.onclick = () => { choix.hidden = !choix.hidden; b.setAttribute('aria-expanded', String(!choix.hidden)); };
        pastille.querySelector('.pr').onclick = () => { plier(); profilVu = !profilVu; garder(); majBandeau(); };
        pastille.querySelector('.m').onclick = () => { plier(); gardeTrace = false; garder(); oter(appli); majPastille(); };
        pastille.querySelector('.e').onclick = () => { plier(); pts.length = 0; brins.length = 0; d = null; garder(); oter(appli); majPastille(); };
        pastille.querySelector('.r').onclick = () => { plier(); appli.choisir(q); };
        document.addEventListener('pointerdown', e => { if (!pastille.contains(e.target)) plier(); });
      }
      pastille.hidden = false; majBandeau();
    };

    const q = {
      theme: opts.theme || 'Itinéraire', libelle: opts.libelle || 'Par où passer ?', aide: opts.aide || (opts.sentiers ? 'Tracé posé au doigt : entre deux points, la carte suit les sentiers et les routes de la BD TOPO (calcul d\'itinéraire piéton de l\'IGN) ; « Suivre les sentiers » éteint, elle coupe droit, pour le hors-sentier. Elle en tire le profil, la distance et le dénivelé à partir du relevé de l\'IGN. Un sentier absent de la BD TOPO n\'est pas suivi. Le doigt promené sur le profil montre l\'endroit sur la carte et l\'heure de passage, pour le départ choisi (temps sans les pauses).' : 'Tracé posé au doigt : la carte en tire le profil, la distance et le dénivelé à partir du relevé de l\'IGN. Entre deux points, le tracé coupe droit : il faut en poser davantage dans les passages délicats. Le doigt promené sur le profil montre l\'endroit sur la carte.'),
      async ouvrir(app) {
        appli = app; majPastille();
        const c = app.repondre(q.libelle, `<p class="etat"></p><div class="profil"></div><div class="bilan"></div>
          <div class="puces horaire" style="margin-top:8px"><button class="hmoins" aria-label="Partir un quart d'heure plus tôt">− 15 min</button><button class="hdep" title="Toucher pour partir maintenant">Départ ${heure(depart)}</button><button class="hplus" aria-label="Partir un quart d'heure plus tard">+ 15 min</button></div>
          <div class="puces gardes" style="margin-top:8px"></div>
          <div class="puces" style="margin-top:8px">${opts.sentiers ? `<button class="sent" aria-pressed="${surSentiers}">Suivre les sentiers</button>` : ''}<button class="undo">Retirer le dernier point</button><button class="raz">Effacer le tracé</button><button class="garde" aria-pressed="${gardeTrace}" title="Le tracé reste dessiné quand on passe à un autre thème">Garder sur la carte</button><button class="enr" title="Ranger ce tracé sous un nom, sur cet appareil, pour le ressortir plus tard">Enregistrer</button><button class="sup" hidden>Retirer de la liste</button><button class="gpx">GPX</button><button class="imp">Fiche à imprimer</button></div>`);
        q._c = c;
        if (opts.sentiers) c.querySelector('.sent').onclick = e => { surSentiers = !surSentiers; e.currentTarget.setAttribute('aria-pressed', surSentiers); garder(); };
        c.querySelector('.undo').onclick = () => { pts.pop(); brins.length = Math.max(0, pts.length - 1); courant = null; garder(); calculer(app, c); majGardes(); };
        c.querySelector('.raz').onclick = () => { pts.length = 0; brins.length = 0; courant = null; garder(); calculer(app, c); majGardes(); };
        // Tracés enregistrés.
        const majGardes = q._majGardes = () => {
          c.querySelector('.gardes').innerHTML = gardes.map((g, i) => `<button data-g="${i}" aria-pressed="${g.nom === courant}">${app.propre(g.nom)}<small>${g.km ? km(g.km) : ''}${g.dplus ? ' · +' + Math.round(g.dplus) + ' m' : ''}</small></button>`).join('');
          const s = c.querySelector('.sup'); s.hidden = !courant; if (courant) s.textContent = `Retirer « ${courant} » de la liste`;
        };
        c.querySelector('.gardes').onclick = e => {
          const b = e.target.closest('button[data-g]'), g = b && gardes[+b.dataset.g]; if (!g) return;
          pts = g.pts.map(p => p.slice()); brins = (g.brins || []).map(l => l.map(p => p.slice()));
          for (let i = 0; i < pts.length - 1; i++) if (!brins[i] || brins[i].length < 2) brins[i] = [pts[i], pts[i + 1]];
          brins.length = Math.max(0, pts.length - 1);
          if (g.depart >= 0) depart = g.depart; courant = g.nom; garder(); majHeure(c); dessinerLigne(app); calculer(app, c); majGardes();
          let o = Infinity, s = Infinity, e2 = -Infinity, n = -Infinity; for (const p of chemin()) { o = Math.min(o, p[0]); e2 = Math.max(e2, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
          app.map.fitBounds([[o, s], [e2, n]], { padding: app.marges({ top: 110, bottom: Math.round(innerHeight * 0.45), left: 40, right: 70 }), pitch: app.map.getPitch(), bearing: app.map.getBearing(), maxZoom: 15.5, duration: 1200 });
        };
        c.querySelector('.enr').onclick = () => {
          if (pts.length < 2) { app.occupe(true, 'Pose au moins deux points avant d\'enregistrer'); setTimeout(() => app.occupe(false), 2200); return; }
          const nom = (prompt('Nom du tracé à enregistrer', courant || `Tracé du ${new Date().toLocaleDateString('fr-FR')}`) || '').trim().slice(0, 60); if (!nom) return;
          const g = { nom, pts: pts.map(p => p.slice()), brins: brins.map(l => l.map(p => p.slice())), depart, km: d ? d.total : 0, dplus: d ? d.dplus : 0, date: new Date().toISOString().slice(0, 10) };
          const i = gardes.findIndex(x => x.nom === nom); if (i >= 0) gardes[i] = g; else gardes.push(g);
          courant = nom; rangerGardes(); majGardes();
          app.occupe(true, `« ${nom} » enregistré sur cet appareil`); setTimeout(() => app.occupe(false), 2200);
        };
        c.querySelector('.sup').onclick = () => { if (!courant || !confirm(`Retirer « ${courant} » des tracés enregistrés ? Le tracé affiché reste sur la carte.`)) return; gardes = gardes.filter(g => g.nom !== courant); courant = null; rangerGardes(); majGardes(); };
        majGardes();
        c.querySelector('.garde').onclick = e => { gardeTrace = !gardeTrace; e.currentTarget.setAttribute('aria-pressed', gardeTrace); garder(); };
        c.querySelector('.gpx').onclick = gpx;
        // Heure de départ : par quarts d'heure ; toucher l'heure la met à maintenant. Elle donne l'arrivée et l'heure de passage sur le profil.
        const regler = m => { depart = ((Math.round(m / 5) * 5) % 1440 + 1440) % 1440; garder(); majHeure(c); };
        c.querySelector('.hmoins').onclick = () => regler(depart - 15); c.querySelector('.hplus').onclick = () => regler(depart + 15);
        c.querySelector('.hdep').onclick = () => { const t = new Date(); regler(Math.ceil((t.getHours() * 60 + t.getMinutes()) / 5) * 5); };
        // Le tracé est proposé au bouton « Survol » des outils de la carte, tant que le thème est ouvert.
        app.survol.proposer('trace', () => { if (!d) return null; const dd = d; return { pts: dd.xy.map((p, i) => [p[0], p[1], dd.z[i]]), suivre(i) { dd.repere = dd.xy[i]; dessinerLigne(app); }, fin() { dd.repere = dd.repereAnalyse || null; if (app.active === q) dessinerLigne(app); } }; });
        c.querySelector('.imp').onclick = () => imprimer(app);
        dessinerLigne(app); app.map.on('mousemove', 'trace-bord', surTrace); app.map.on('mouseleave', 'trace-bord', horsTrace); await calculer(app, c);
      },
      async toucher(app, ll) {
        const p = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)], avant = pts[pts.length - 1];
        if (avant) { if (surSentiers) app.occupe(true, 'Recherche du sentier…'); const b = await brin(avant, p); app.occupe(false); if (app.active !== q || pts[pts.length - 1] !== avant) return; brins.push(b); }
        pts.push(p); courant = null; if (q._majGardes) q._majGardes(); garder(); dessinerLigne(app); calculer(app, q._c);
      },
      // Plein écran : on pose les points sur toute la carte ; le profil reste dessous, avec les gestes utiles en route.
      plein() { return { bloc: '.profil', boutons: ['.hmoins', '.hdep', '.hplus', opts.sentiers ? '.sent' : null, '.undo', '.raz', '.garde', '.enr', '.gpx'].filter(Boolean), consigne: opts.intro || 'Touche la carte pour poser le départ, puis chaque point de passage.' }; },
      // « Garder sur la carte » : le tracé reste dessiné sous les autres thèmes ; on revient ici pour le retirer ou l'effacer.
      fermer(app) { tour++; suivi = null; app.map.off('mousemove', 'trace-bord', surTrace); app.map.off('mouseleave', 'trace-bord', horsTrace); app.survol.arreter(); app.survol.retirer('trace'); if (gardeTrace && pts.length > 1) { setTimeout(majPastille, 0); return; } oter(app); majPastille(); }
    };
    q.relancer = app => { if (app.active === q) calculer(app, q._c); };
    return q;
  }
  S.trace = trace; S.traceOutils = { km, duree, ROSE, altitude };
})();
