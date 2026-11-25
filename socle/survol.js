/* Survol d'un itinéraire : la caméra suit le tracé, tournée vers la suite du chemin, et marque une halte aux endroits
   qui comptent (le départ, les points hauts, cols et sommets, l'arrivée) : elle y tourne autour du lieu, le temps de
   le nommer. Les haltes sont tirées du profil (un point haut compte s'il domine nettement ce qui le précède et ce qui
   le suit) ; leur nom vient des lieux-dits de l'IGN, s'il y en a un à moins de 250 m. Toucher la carte arrête le survol. */
(function () {
  'use strict';
  const S = window.Socle, RAD = Math.PI / 180;
  const cap = (a, b) => { const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD), x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD); return Math.atan2(y, x) / RAD; };
  const ecart = (a, b) => (((a - b) % 360) + 540) % 360 - 180;   // de b vers a, par le plus court
  const doux = u => u * u * (3 - 2 * u);

  // Haltes d'un tracé : pts = [[lon, lat, alt], …], d = distances cumulées (km).
  function haltes(pts, d, max) {
    const n = pts.length, z = new Float32Array(n);
    for (let i = 0, a = 0, b = 0, s = 0; i < n; i++) {   // altitude adoucie sur 200 m : une bosse du relevé n'est pas un col
      while (b < n && d[b] - d[i] <= 0.1) s += pts[b++][2]; while (d[i] - d[a] > 0.1) s -= pts[a++][2];
      z[i] = s / (b - a);
    }
    let zmin = Infinity, zmax = -Infinity; for (const v of z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    const seuil = Math.max(50, 0.12 * (zmax - zmin)), ext = [{ i: 0, haut: false }];
    let monte = true, k = 0;
    for (let i = 1; i < n; i++) {
      if (monte) { if (z[i] > z[k]) k = i; else if (z[k] - z[i] >= seuil) { ext.push({ i: k, haut: true }); monte = false; k = i; } }
      else { if (z[i] < z[k]) k = i; else if (z[i] - z[k] >= seuil) { ext.push({ i: k, haut: false }); monte = true; k = i; } }
    }
    ext.push({ i: n - 1, haut: false });
    const hauts = [];
    ext.forEach((e, j) => {
      if (!e.haut || d[e.i] < 0.4 || d[n - 1] - d[e.i] < 0.4) return;
      hauts.push({ i: e.i, type: 'haut', saillie: z[e.i] - Math.max(z[ext[j - 1].i], z[ext[j + 1].i]) });
    });
    hauts.sort((a, b) => b.saillie - a.saillie); hauts.length = Math.min(hauts.length, max || 5); hauts.sort((a, b) => a.i - b.i);
    return [{ i: 0, type: 'depart' }, ...hauts, { i: n - 1, type: 'arrivee' }];
  }
  // Nom d'une halte : le sommet, le col, le refuge ou le lac le plus proche, à moins de 250 m.
  const NATURES = /sommet|col|pic|crête|refuge|cabane|lac|chapelle|belvédère|bergerie|gîte/i;
  async function nommer(h, p) {
    try {
      const r = await fetch(`${S.GEOPF}/geocodage/reverse?index=poi&limit=8&lon=${p[0]}&lat=${p[1]}`), j = await r.json();
      const f = (j.features || []).find(f => f.properties.distance < 250 && (f.properties.category || []).some(c => NATURES.test(c)) && (f.properties.toponym || f.properties.name));
      if (f) h.nom = f.properties.toponym || f.properties.name;
    } catch (e) { /* sans nom */ }
  }

  function lancer(app, pts, opts) {
    opts = opts || {};
    const m = app.map, n = pts.length, d = [0];
    for (let i = 1; i < n; i++) d.push(d[i - 1] + app.distKm(pts[i - 1], pts[i]));
    const total = d[n - 1], etapes = haltes(pts, d, opts.haltes);
    const lieu = s => { let a = 0, b = n - 1; while (b - a > 1) { const k = (a + b) >> 1; d[k] < s ? a = k : b = k; } const u = d[b] > d[a] ? Math.min(1, Math.max(0, (s - d[a]) / (d[b] - d[a]))) : 0; return { i: u < 0.5 ? a : b, p: [pts[a][0] + (pts[b][0] - pts[a][0]) * u, pts[a][1] + (pts[b][1] - pts[a][1]) * u] }; };
    const duree = Math.min(110, Math.max(22, total * 4.5)), vitesse = total / duree;   // km par seconde
    const regard = Math.min(1.2, Math.max(0.25, total / 25)), zoomRoute = total > 25 ? 13.4 : total > 8 ? 13.9 : 14.5, PAUSE = 4.6;
    const fige = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let vivant = true, raf = 0, s = 0, suivante = 0, halte = null, t1 = null, angle = m.getBearing(), zoom = m.getZoom(), pitch = m.getPitch();
    const panneau = document.querySelector('.reponse'), etaitReplie = panneau && panneau.classList.contains('replie');
    const fin = (alafin) => {
      if (!vivant) return; vivant = false; cancelAnimationFrame(raf); app.sansBulle();
      m.off('dragstart', stop); m.getCanvas().removeEventListener('wheel', stop); m.getCanvas().removeEventListener('touchstart', stop); m.getCanvas().removeEventListener('mousedown', stop);
      if (panneau && !etaitReplie) panneau.classList.remove('replie');
      if (opts.fin) opts.fin(!!alafin);
    };
    const stop = () => fin(false);
    const annoncer = h => {
      const p = pts[h.i], titre = h.nom || (h.type === 'depart' ? 'Départ' : h.type === 'arrivee' ? 'Arrivée' : 'Point haut');
      app.bulle({ lng: p[0], lat: p[1] }, `<span class="fort">${app.propre(titre)}</span><small>${Math.round(p[2]).toLocaleString('fr-FR')} m · km ${d[h.i].toFixed(1).replace('.', ',')}${h.nom && h.type !== 'haut' ? (h.type === 'depart' ? ' · départ' : ' · arrivée') : ''}</small>`);
    };
    function image(t) {
      if (!vivant) return;
      const dt = t1 === null ? 0 : Math.min(0.1, (t - t1) / 1000); t1 = t;
      let cible = zoomRoute, inclinaison = 64;
      if (halte) {   // halte : la caméra tourne autour du lieu, un peu plus près
        halte.t += dt; const u = Math.min(1, halte.t / PAUSE);
        angle = halte.angle + 110 * doux(u); cible = zoomRoute + 0.25 * Math.sin(Math.PI * u); inclinaison = 56;   // un peu plus haut : sur un sommet, une vue rasante ne montre que le premier plan
        if (u >= 1) { app.sansBulle(); const derniere = halte.h.type === 'arrivee'; halte = null; if (derniere) { fin(true); return; } }
      } else {
        s = Math.min(total, s + vitesse * dt);
        const h = etapes[suivante];
        if (h && s >= d[h.i]) { s = d[h.i]; suivante++; halte = { h, t: 0, angle }; annoncer(h); }
        else { const a = lieu(s).p, b = lieu(Math.min(total, s + regard)).p; if (s + 0.02 < total) angle += ecart(cap(a, b), angle) * Math.min(1, dt * 1.8); }
      }
      zoom += (cible - zoom) * Math.min(1, dt * 2.2); pitch += (inclinaison - pitch) * Math.min(1, dt * 1.5);
      const ici = lieu(s); m.jumpTo({ center: ici.p, bearing: angle, pitch, zoom });
      if (opts.suivre) opts.suivre(ici.i);
      raf = requestAnimationFrame(image);
    }
    (async () => {
      if (!app.relief3d) app.mettre3d(true);
      if (panneau) panneau.classList.add('replie');   // le panneau se réduit le temps du survol : la carte d'abord
      await Promise.race([Promise.all(etapes.map(h => nommer(h, pts[h.i]))), new Promise(r => setTimeout(r, 2500))]);
      if (!vivant) return;
      m.on('dragstart', stop); m.getCanvas().addEventListener('wheel', stop, { passive: true }); m.getCanvas().addEventListener('touchstart', stop, { passive: true }); m.getCanvas().addEventListener('mousedown', stop);
      if (fige) {   // mouvement réduit demandé : on passe d'une halte à l'autre, sans voyage
        for (const h of etapes) { if (!vivant) return; m.jumpTo({ center: [pts[h.i][0], pts[h.i][1]], zoom: zoomRoute + 0.5, pitch: 60 }); annoncer(h); if (opts.suivre) opts.suivre(h.i); await new Promise(r => setTimeout(r, 3500)); }
        fin(true); return;
      }
      angle = cap(pts[0], lieu(Math.min(total, regard)).p);
      m.easeTo({ center: [pts[0][0], pts[0][1]], zoom: zoomRoute, pitch: 64, bearing: angle, duration: 1800 });
      await new Promise(r => setTimeout(r, 1900)); if (!vivant) return;
      zoom = m.getZoom(); pitch = m.getPitch(); angle = m.getBearing();
      raf = requestAnimationFrame(image);
    })();
    return { arreter: stop, etapes, get enCours() { return vivant; } };
  }
  S.survol = { lancer, haltes };
})();
