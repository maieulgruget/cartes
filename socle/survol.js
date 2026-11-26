/* Survol d'un itinéraire : la caméra suit le tracé, tournée vers la suite du chemin, et marque une halte aux endroits
   qui comptent (le départ, les points hauts, cols et sommets, l'arrivée) : elle y tourne autour du lieu, le temps de
   le nommer. Le bouton « Survol » des outils de la carte le lance dès qu'il y a un tracé à suivre. Les haltes sont tirées du profil (un point haut compte s'il domine nettement ce qui le précède et ce qui
   le suit) ; leur nom vient des lieux-dits de l'IGN, s'il y en a un à moins de 250 m. */
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

  /* Le vol. La caméra suit de près, comme un drone derrière le marcheur (zoom 15,7, vue très inclinée), à 45 m par
     seconde sur le terrain : un long parcours dure donc longtemps, et une barre permet de l'accélérer (× 3, × 8), de le
     mettre en pause ou de sauter à la halte suivante. À l'approche d'une halte, la caméra ralentit et se rapproche ; sur
     place, elle tourne autour du lieu en reculant pour montrer le versant, puis revient et repart. Toucher la carte met
     en pause (on peut alors regarder autour de soi) ; ▶ reprend. */
  const ALLURES = [1, 3, 8], PRES = 15.7, APPROCHE = 0.35, PAUSE = 7.5;
  function lancer(app, pts, opts) {
    opts = opts || {};
    const m = app.map, n = pts.length, d = [0];
    for (let i = 1; i < n; i++) d.push(d[i - 1] + app.distKm(pts[i - 1], pts[i]));
    const total = d[n - 1], etapes = haltes(pts, d, opts.haltes);
    const lieu = s => { s = Math.min(total, Math.max(0, s)); let a = 0, b = n - 1; while (b - a > 1) { const k = (a + b) >> 1; d[k] < s ? a = k : b = k; } const u = d[b] > d[a] ? Math.min(1, Math.max(0, (s - d[a]) / (d[b] - d[a]))) : 0; return { i: u < 0.5 ? a : b, p: [pts[a][0] + (pts[b][0] - pts[a][0]) * u, pts[a][1] + (pts[b][1] - pts[a][1]) * u] }; };
    const fige = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let vivant = true, raf = 0, s = 0, suivante = 0, halte = null, t1 = null, pause = false, allure = 0, angle = m.getBearing(), zoom = m.getZoom(), pitch = m.getPitch();
    const panneau = document.querySelector('.reponse'), etaitReplie = panneau && panneau.classList.contains('replie');
    // Barre de commande
    const barre = document.createElement('div'); barre.className = 'barrevol';
    barre.innerHTML = '<button class="p" aria-label="Pause ou reprise">⏸</button><button class="v" aria-label="Allure du survol">× 1</button><button class="n" aria-label="Aller à la halte suivante">Halte ›</button><span class="ou"></span><button class="x" aria-label="Arrêter le survol">✕</button>';
    const bP = barre.querySelector('.p'), bV = barre.querySelector('.v'), ou = barre.querySelector('.ou');
    const mettrePause = oui => { pause = oui; bP.textContent = oui ? '▶' : '⏸'; t1 = null; };
    bP.onclick = () => mettrePause(!pause);
    bV.onclick = () => { allure = (allure + 1) % ALLURES.length; bV.textContent = '× ' + ALLURES[allure]; };
    barre.querySelector('.n').onclick = () => {   // on saute juste avant la halte suivante, pour garder son approche
      const h = etapes[suivante]; if (!h) return; if (halte) { app.sansBulle(); halte = null; }
      s = Math.max(s, d[h.i] - APPROCHE * 0.6); angle = cap(lieu(s - 0.05).p, lieu(s + 0.2).p); mettrePause(false);
    };
    barre.querySelector('.x').onclick = () => fin(false);
    const fin = (alafin) => {
      if (!vivant) return; vivant = false; cancelAnimationFrame(raf); app.sansBulle(); barre.remove();
      m.off('dragstart', toucher); m.getCanvas().removeEventListener('wheel', toucher); m.getCanvas().removeEventListener('touchstart', toucher); m.getCanvas().removeEventListener('mousedown', toucher);
      if (panneau && !etaitReplie) panneau.classList.remove('replie');
      if (opts.fin) opts.fin(!!alafin);
    };
    const toucher = () => { if (!pause) mettrePause(true); };
    const annoncer = h => {
      const p = pts[h.i], titre = h.nom || (h.type === 'depart' ? 'Départ' : h.type === 'arrivee' ? 'Arrivée' : 'Point haut');
      app.bulle({ lng: p[0], lat: p[1] }, `<span class="fort">${app.propre(titre)}</span><small>${Math.round(p[2]).toLocaleString('fr-FR')} m · km ${d[h.i].toFixed(1).replace('.', ',')}${h.nom && h.type !== 'haut' ? (h.type === 'depart' ? ' · départ' : ' · arrivée') : ''}</small>`);
    };
    function image(t) {
      if (!vivant) return;
      raf = requestAnimationFrame(image);
      if (pause) { t1 = null; return; }
      const dt = t1 === null ? 0 : Math.min(0.3, (t - t1) / 1000); t1 = t;   // plafonné : un appareil lent avance par à-coups plutôt que de prendre du retard sans fin
      let cible = PRES, inclinaison = 69;
      if (halte) {   // halte : tour du lieu, en reculant pour montrer le versant, puis retour
        halte.t += dt * (ALLURES[allure] > 1 ? 1.6 : 1); const u = Math.min(1, halte.t / PAUSE), recul = Math.sin(Math.PI * Math.min(1, u * 1.15));
        angle = halte.angle + 150 * doux(u); cible = PRES + 0.8 - 2.3 * recul; inclinaison = 69 - 13 * recul;
        if (u >= 1) { app.sansBulle(); const derniere = halte.h.type === 'arrivee'; halte = null; if (derniere) { fin(true); return; } }
      } else {
        const h = etapes[suivante], reste = h ? d[h.i] - s : Infinity, pres = reste < APPROCHE ? 1 - reste / APPROCHE : 0;   // 0 loin de la halte, 1 dessus
        s = Math.min(total, s + 0.045 * ALLURES[allure] * (1 - 0.55 * pres) * dt);
        cible = PRES + 0.8 * doux(pres);
        if (h && s >= d[h.i]) { s = d[h.i]; suivante++; halte = { h, t: 0, angle }; annoncer(h); }
        else if (s + 0.02 < total) angle += ecart(cap(lieu(s - 0.04).p, lieu(s + 0.22).p), angle) * Math.min(1, dt * 1.4);
      }
      zoom += (cible - zoom) * Math.min(1, dt * 1.8); pitch += (inclinaison - pitch) * Math.min(1, dt * 1.5);
      const ici = lieu(s); m.jumpTo({ center: ici.p, bearing: angle, pitch, zoom });
      ou.textContent = `km ${s.toFixed(1).replace('.', ',')} / ${total.toFixed(1).replace('.', ',')}`;
      if (opts.suivre) opts.suivre(ici.i);
    }
    (async () => {
      if (!app.relief3d) app.mettre3d(true);
      if (panneau) panneau.classList.add('replie');   // le panneau se réduit le temps du survol : la carte d'abord
      document.body.append(barre);
      await Promise.race([Promise.all(etapes.map(h => nommer(h, pts[h.i]))), new Promise(r => setTimeout(r, 2500))]);
      if (!vivant) return;
      if (fige) {   // mouvement réduit demandé : on passe d'une halte à l'autre, sans voyage
        for (const h of etapes) { if (!vivant) return; m.jumpTo({ center: [pts[h.i][0], pts[h.i][1]], zoom: PRES - 0.8, pitch: 60 }); annoncer(h); if (opts.suivre) opts.suivre(h.i); await new Promise(r => setTimeout(r, 3500)); }
        fin(true); return;
      }
      angle = cap(pts[0], lieu(0.2).p);
      m.easeTo({ center: [pts[0][0], pts[0][1]], zoom: PRES - 1.2, pitch: 62, bearing: angle, duration: 2200 });
      await new Promise(r => setTimeout(r, 2300)); if (!vivant) return;
      m.on('dragstart', toucher); m.getCanvas().addEventListener('wheel', toucher, { passive: true }); m.getCanvas().addEventListener('touchstart', toucher, { passive: true }); m.getCanvas().addEventListener('mousedown', toucher);
      zoom = m.getZoom(); pitch = m.getPitch(); angle = m.getBearing();
      raf = requestAnimationFrame(image);
    })();
    return { arreter: () => fin(false), etapes, get enCours() { return vivant; } };
  }
  S.survol = { lancer, haltes };
})();
