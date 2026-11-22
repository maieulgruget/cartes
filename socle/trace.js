/* Thème « Itinéraire » : on touche la carte pour poser les points d'un tracé ; la carte en tire le profil, la distance,
   le dénivelé, et une lecture propre à chaque carte (opts.analyse). Le tracé est gardé sur l'appareil, s'exporte en GPX
   et s'imprime en fiche. */
(function () {
  'use strict';
  const S = window.Socle, ROSE = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const km = m => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m / 10) * 10 + ' m';
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
    let pts = []; try { pts = JSON.parse(localStorage.getItem(cle)) || []; } catch (e) { pts = []; }
    const garder = () => { try { localStorage.setItem(cle, JSON.stringify(pts)); } catch (e) { } };
    let d = null, tour = 0;

    function dessinerLigne(app) {
      const fc = { type: 'FeatureCollection', features: [] };
      if (pts.length > 1) fc.features.push({ type: 'Feature', properties: { r: 'ligne' }, geometry: { type: 'LineString', coordinates: pts } });
      if (d && d.raide.length) fc.features.push({ type: 'Feature', properties: { r: 'raide' }, geometry: { type: 'MultiLineString', coordinates: d.raide } });
      pts.forEach((p, i) => fc.features.push({ type: 'Feature', properties: { r: i === 0 ? 'depart' : i === pts.length - 1 ? 'arrivee' : 'point' }, geometry: { type: 'Point', coordinates: p } }));
      if (d && d.repere) fc.features.push({ type: 'Feature', properties: { r: 'repere' }, geometry: { type: 'Point', coordinates: d.repere } });
      const m = app.map;
      if (m.getSource('trace')) { m.getSource('trace').setData(fc); return; }
      m.addSource('trace', { type: 'geojson', data: fc });
      m.addLayer({ id: 'trace-bord', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'ligne'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'trace-ligne', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'ligne'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a2e4a', 'line-width': 4 } });
      m.addLayer({ id: 'trace-raide', type: 'line', source: 'trace', filter: ['==', ['get', 'r'], 'raide'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#e63946', 'line-width': 4 } });
      m.addLayer({ id: 'trace-points', type: 'circle', source: 'trace', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': ['match', ['get', 'r'], 'point', 4, 'repere', 8, 7], 'circle-color': ['match', ['get', 'r'], 'depart', '#2a9d8f', 'arrivee', '#b8963e', 'repere', '#e63946', '#1a2e4a'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
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

    async function calculer(app, c) {
      const moi = ++tour; d = null;
      if (pts.length < 2) { c.querySelector('.profil').innerHTML = ''; c.querySelector('.bilan').innerHTML = ''; c.querySelector('.etat').textContent = pts.length ? 'Départ posé. Touche la carte pour poser le point suivant.' : (opts.intro || 'Touche la carte pour poser le départ, puis chaque point de passage.'); dessinerLigne(app); return; }
      // emprise du tracé, élargie pour que les calculs voient le relief alentour
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const p of pts) { o = Math.min(o, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
      const latm = (s + n) / 2, mx = Math.max((e - o) * 0.3, 0.006 / Math.cos(latm * Math.PI / 180)), my = Math.max((n - s) * 0.3, 0.006);
      const b = [o - mx, s - my, e + mx, n + my], largM = (b[2] - b[0]) * 111200 * Math.cos(latm * Math.PI / 180);
      app.occupe(true, 'Lecture du relief…');
      let g; try { g = await app.grille(b, Math.max(200, Math.min(700, largM / 6)), { couche: opts.couche }); } catch (err) { app.occupe(false); if (moi === tour) c.querySelector('.etat').textContent = 'Le relief ne répond pas pour l\'instant. Réessaie dans un moment.'; return; }
      app.occupe(false); if (moi !== tour || app.active !== q) return;
      const a = app.pentes(g);
      // échantillonnage régulier le long du tracé
      const seg = []; let total = 0; for (let i = 1; i < pts.length; i++) { const l = app.distKm(pts[i - 1], pts[i]) * 1000; seg.push(l); total += l; }
      const pas = Math.max(g.pas * 0.8, total / 500), dist = [], z = [], xy = [], pt = [], ex = [];
      for (let i = 0, acc = 0; i < seg.length; i++) {
        const nb = Math.max(1, Math.round(seg[i] / pas));
        for (let k = (i ? 1 : 0); k <= nb; k++) {
          const f = k / nb, lon = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, lat = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, kk = app.indice(g, lon, lat);
          dist.push(acc + seg[i] * f); z.push(altitude(g, lon, lat)); xy.push([lon, lat]); pt.push(kk >= 0 ? a.pente[kk] : NaN); ex.push(kk >= 0 ? a.expo[kk] : NaN);
        }
        acc += seg[i];
      }
      for (let i = 0; i < z.length; i++) if (z[i] !== z[i]) z[i] = i ? z[i - 1] : (z.find(v => v === v) || 0);
      // dénivelés : on ne compte une montée ou une descente qu'au-delà de 3 m, pour ne pas additionner le grain du relevé
      let dplus = 0, dmoins = 0, ref = z[0], zmin = Infinity, zmax = -Infinity, imin = 0, imax = 0;
      z.forEach((v, i) => { if (v - ref > 3) { dplus += v - ref; ref = v; } else if (ref - v > 3) { dmoins += ref - v; ref = v; } if (v < zmin) { zmin = v; imin = i; } if (v > zmax) { zmax = v; imax = i; } });
      const seuil = opts.seuilPente || 30, fort = pt.map(p => p >= seuil), raide = []; let cours = null;
      fort.forEach((f, i) => { if (f) { if (!cours) { cours = [xy[Math.max(0, i - 1)]]; raide.push(cours); } cours.push(xy[i]); } else cours = null; });
      d = { pts, g, a, dist, z, xy, pente: pt, expo: ex, fort, raide: opts.seuilPente === false ? [] : raide, total, dplus, dmoins, zmin, zmax, imin, imax, repere: null };
      if (opts.seuilPente === false) d.fort = d.fort.map(() => false);
      c.querySelector('.etat').innerHTML = `<span class="fort">${km(total)}</span>, <span class="fort">+${Math.round(dplus)} m</span> / −${Math.round(dmoins)} m, de ${Math.round(z[0])} m à ${Math.round(z[z.length - 1])} m${zmax > Math.max(z[0], z[z.length - 1]) + 5 ? ` (point haut ${Math.round(zmax)} m)` : ''}.`;
      c.querySelector('.profil').innerHTML = profil(d);
      let html = ''; try { html = opts.analyse ? await opts.analyse(app, d) : ''; } catch (err) { console.error(err); html = '<p class="petit">L\'analyse du tracé n\'a pas abouti.</p>'; }
      if (moi !== tour || app.active !== q) return;
      c.querySelector('.bilan').innerHTML = html; d.bilan = html; dessinerLigne(app);
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
      let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const p of pts) { o = Math.min(o, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
      const carte = document.querySelector('.reponse'); carte.style.visibility = 'hidden';
      m.fitBounds([[o, s], [e, n]], { padding: 60, pitch: 0, bearing: 0, duration: 0 });
      await Promise.race([new Promise(r => m.once('idle', r)), new Promise(r => setTimeout(r, 7000))]);
      const image = await new Promise(r => { m.once('render', () => { try { r(m.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (err) { r(''); } }); m.triggerRepaint(); });
      carte.style.visibility = ''; m.jumpTo(vue); app.occupe(false);
      let f = document.getElementById('fiche'); if (!f) { f = document.createElement('div'); f.id = 'fiche'; document.body.append(f); }
      f.innerHTML = `<h1>${app.propre(opts.nom || 'Tracé')}</h1><p class="sous">${app.propre(app.cfg.sousTitre || '')} · fiche préparée le ${new Date().toLocaleDateString('fr-FR')}</p>
        ${image ? `<img src="${image}" alt="Carte du tracé">` : ''}
        <p><b>${km(d.total)}</b> · <b>+${Math.round(d.dplus)} m</b> / −${Math.round(d.dmoins)} m · départ ${Math.round(d.z[0])} m · arrivée ${Math.round(d.z[d.z.length - 1])} m · point haut ${Math.round(d.zmax)} m</p>
        ${profil(d, 640, 170)}<div class="bilan">${d.bilan || ''}</div>
        <p class="pied">${opts.pied || ''} Altitudes : IGN. Calculs faits dans la page, à vérifier sur le terrain.</p>`;
      setTimeout(() => window.print(), 150);
    }

    const q = {
      theme: opts.theme || 'Itinéraire', libelle: opts.libelle || 'Par où passer ?',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat"></p><div class="profil"></div><div class="bilan"></div>
          <div class="puces" style="margin-top:8px"><button class="undo">Retirer le dernier point</button><button class="raz">Effacer</button><button class="gpx">GPX</button><button class="imp">Fiche à imprimer</button></div>`);
        q._c = c;
        c.querySelector('.undo').onclick = () => { pts.pop(); garder(); calculer(app, c); };
        c.querySelector('.raz').onclick = () => { pts.length = 0; garder(); calculer(app, c); };
        c.querySelector('.gpx').onclick = gpx;
        c.querySelector('.imp').onclick = () => imprimer(app);
        dessinerLigne(app); await calculer(app, c);
      },
      toucher(app, ll) { pts.push([+ll.lng.toFixed(6), +ll.lat.toFixed(6)]); garder(); dessinerLigne(app); calculer(app, q._c); },
      fermer(app) { tour++; app.retirer('trace-points', 'trace-raide', 'trace-ligne', 'trace-bord'); if (app.map.getSource('trace')) app.map.removeSource('trace'); }
    };
    q.relancer = app => { if (app.active === q) calculer(app, q._c); };
    return q;
  }
  S.trace = trace; S.traceOutils = { km, duree, ROSE, altitude };
})();
