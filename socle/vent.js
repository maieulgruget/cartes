/* Vent : champ de vent d'Open-Meteo lu sur une grille de points autour de la vue, interpolé, puis montré de deux façons :
   une teinte par force, sous les noms, et des traînées blanches qui suivent le vent, dessinées par-dessus la carte.
   Les traînées sont projetées sur la carte à chaque image : elles suivent la vue, inclinée ou non.
   Le module sert à plusieurs cartes ; il donne aussi le vent d'un point (pointVent) et le nom d'une allure. */
(function () {
  'use strict';
  const S = window.Socle, RAD = Math.PI / 180;
  const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const rose = d => ROSE[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
  const BFT = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  const beaufort = kn => { let b = 0; while (b < 12 && kn >= BFT[b]) b++; return b; };
  // Classes de force, en nœuds (limites de l'échelle de Beaufort, forces 3 à 8).
  const CLASSES = [[7, [159, 211, 230], 'moins de 7 nœuds'], [11, [108, 197, 160], '7 à 10'], [17, [233, 215, 88], '11 à 16'], [22, [242, 165, 65], '17 à 21'], [28, [228, 87, 46], '22 à 27'], [34, [181, 23, 158], '28 à 33'], [999, [106, 27, 154], '34 et plus']];
  const classe = kn => CLASSES.find(c => kn < c[0]) || CLASSES[CLASSES.length - 1];
  const hhmm = iso => iso.slice(11, 13) + ' h';

  // Champ de vent sur l'emprise b = [ouest, sud, est, nord], en n × n points, heure par heure sur 24 heures.
  async function lireChamp(app, b, n, fuseau) {
    const lats = [], lons = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { lats.push((b[1] + (b[3] - b[1]) * j / (n - 1)).toFixed(3)); lons.push((b[0] + (b[2] - b[0]) * i / (n - 1)).toFixed(3)); }
    const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_hours=24&timezone=${encodeURIComponent(fuseau)}`);
    if (!j) return null;
    const pts = Array.isArray(j) ? j : [j]; if (pts.length !== n * n || !pts[0].hourly) return null;
    const heures = pts[0].hourly.time, U = heures.map(() => new Float32Array(n * n)), V = heures.map(() => new Float32Array(n * n)), R = heures.map(() => new Float32Array(n * n));
    pts.forEach((p, k) => heures.forEach((_, h) => {
      const sp = p.hourly.wind_speed_10m[h] || 0, d = (p.hourly.wind_direction_10m[h] || 0) * RAD;
      U[h][k] = -sp * Math.sin(d); V[h][k] = -sp * Math.cos(d); R[h][k] = p.hourly.wind_gusts_10m[h] || sp;   // le vent souffle vers l'opposé de sa provenance
    }));
    return { o: b[0], s: b[1], e: b[2], n: b[3], nx: n, heures, U, V, R };
  }
  // Vent interpolé en un point : [vers l'est, vers le nord, rafales] en nœuds ; rien hors du champ.
  function vent(ch, h, lon, lat) {
    const fx = (lon - ch.o) / (ch.e - ch.o) * (ch.nx - 1), fy = (lat - ch.s) / (ch.n - ch.s) * (ch.nx - 1);
    if (fx < 0 || fy < 0 || fx > ch.nx - 1 || fy > ch.nx - 1) return null;
    const i = Math.min(ch.nx - 2, Math.floor(fx)), j = Math.min(ch.nx - 2, Math.floor(fy)), u = fx - i, v = fy - j, a = j * ch.nx + i, b = a + ch.nx;
    const mix = T => (T[a] * (1 - u) + T[a + 1] * u) * (1 - v) + (T[b] * (1 - u) + T[b + 1] * u) * v;
    return [mix(ch.U[h]), mix(ch.V[h]), mix(ch.R[h])];
  }
  const force = w => Math.hypot(w[0], w[1]);
  const provenance = w => (Math.atan2(-w[0], -w[1]) / RAD + 360) % 360;
  const phrase = w => { const kn = force(w); return kn < 1 ? 'calme' : `<span class="fort">${Math.round(kn)} nœuds</span> de ${rose(provenance(w))} (force ${beaufort(kn)}), rafales ${Math.round(w[2])}`; };

  // Vent d'un seul point sur 24 heures (gardé vingt minutes).
  const memoPoint = new Map();
  async function pointVent(app, lon, lat, fuseau) {
    const cle = lon.toFixed(2) + ',' + lat.toFixed(2), m = memoPoint.get(cle);
    if (m && Date.now() - m.t < 12e5) return m.d;
    const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_hours=24&timezone=${encodeURIComponent(fuseau)}`);
    const d = j && j.hourly ? { heures: j.hourly.time, kn: j.hourly.wind_speed_10m, dir: j.hourly.wind_direction_10m, raf: j.hourly.wind_gusts_10m } : null;
    if (d) memoPoint.set(cle, { t: Date.now(), d });
    return d;
  }
  /* Allure d'un bateau qui fait route au cap donné, par un vent venant de dir. Les limites sont celles de l'usage courant ;
     l'angle au plus près dépend du bateau. */
  function allure(cap, dir) {
    const e = ((dir - cap + 540) % 360) - 180, a = Math.abs(e), bord = e > 0 ? 'tribord amures' : 'bâbord amures';
    if (a < 40) return { angle: a, nom: 'vent debout', note: 'il faut tirer des bords', debout: true };
    return { angle: a, nom: (a < 55 ? 'près' : a < 80 ? 'bon plein' : a < 105 ? 'travers' : a < 150 ? 'largue' : 'vent arrière') + (a < 165 ? ', ' + bord : '') };
  }

  function theme(opts) {
    opts = opts || {};
    const F = opts.fuseau || 'Europe/Paris';
    let ch = null, h = 0, toile = null, anim = null, tour = 0, vider = null, taille = null;
    const parts = [];

    async function charger(app, c) {
      const vue = app.emprise(0);
      const dedans = ch && vue[0] >= ch.o && vue[1] >= ch.s && vue[2] <= ch.e && vue[3] <= ch.n && (ch.e - ch.o) < 5 * (vue[2] - vue[0]);
      if (!dedans) {
        const moi = ++tour; app.occupe(true, 'Lecture du vent…');
        const neuf = await lireChamp(app, app.emprise(0.45), 7, F);
        app.occupe(false); if (moi !== tour || app.active !== q) return;
        if (!neuf) { if (!ch) c.querySelector('.etat').textContent = 'Le vent n\'a pas pu être lu. Vérifie la connexion, puis rouvre le thème.'; return; }
        ch = neuf; h = Math.min(h, ch.heures.length - 1); c.querySelector('.hv').max = ch.heures.length - 1;
      }
      fond(app); dire(app, c);
    }
    // Teinte de fond : la force du vent, interpolée entre les points du modèle.
    function fond(app) {
      if (!ch) return;
      const N = 56, [x0, y0] = S.versMerc(ch.o, ch.s), [x1, y1] = S.versMerc(ch.e, ch.n), g = { w: N, h: N, x0, y0, x1, y1 };
      const url = app.peindre(g, k => {
        const i = k % N, j = (k - i) / N, [lon, lat] = S.versGeo(x0 + (i + 0.5) / N * (x1 - x0), y1 - (j + 0.5) / N * (y1 - y0)), w = vent(ch, h, lon, lat);
        if (!w) return null; const col = classe(force(w))[1]; return [col[0], col[1], col[2], 255];
      });
      app.poser('ventfond', g, url, 0.5); app.map.setPaintProperty('ventfond', 'raster-resampling', 'linear');
    }
    function dire(app, c) {
      if (!ch) return;
      const ct = app.map.getCenter(), w = vent(ch, h, ct.lng, ct.lat), i = c.querySelector('.hv');
      i.value = h; c.querySelector('.hh').textContent = (h === 0 ? 'maintenant' : hhmm(ch.heures[h]));
      c.querySelector('.etat').innerHTML = w ? `Au centre de la carte, à ${hhmm(ch.heures[h])} : ${phrase(w)}.` : 'Déplace la carte : son centre est hors de la zone lue.';
    }
    function boucle(app) {
      if (!toile) return; anim = requestAnimationFrame(() => boucle(app));
      if (!ch) return;
      const map = app.map, ctx = toile.getContext('2d'), dpr = taille.dpr, bd = map.getBounds();
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.93)'; ctx.fillRect(0, 0, toile.width, toile.height);
      ctx.globalCompositeOperation = 'source-over';
      const o = Math.max(bd.getWest(), ch.o), e = Math.min(bd.getEast(), ch.e), s = Math.max(bd.getSouth(), ch.s), n = Math.min(bd.getNorth(), ch.n);
      if (e <= o || n <= s) return;
      const degPx = 360 / (512 * Math.pow(2, map.getZoom())), pas = 0.11 * degPx;   // un vent de 10 nœuds avance d'un peu plus d'un pixel par image
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3 * dpr; ctx.lineCap = 'round'; ctx.beginPath();
      for (const p of parts) {
        if (p.age <= 0 || p.lon < o || p.lon > e || p.lat < s || p.lat > n) { p.lon = o + Math.random() * (e - o); p.lat = s + Math.random() * (n - s); p.age = 30 + Math.random() * 70; continue; }
        const w = vent(ch, h, p.lon, p.lat); if (!w) { p.age = 0; continue; }
        const lon2 = p.lon + w[0] * pas, lat2 = p.lat + w[1] * pas * Math.cos(p.lat * RAD);
        const a = map.project([p.lon, p.lat]), b = map.project([lon2, lat2]);
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 60) { ctx.moveTo(a.x * dpr, a.y * dpr); ctx.lineTo(b.x * dpr, b.y * dpr); }
        p.lon = lon2; p.lat = lat2; p.age--;
      }
      ctx.stroke();
    }
    const q = {
      theme: opts.theme || 'Vent', libelle: opts.libelle || 'D\'où souffle le vent ?',
      aide: 'Vent à 10 m de hauteur, prévu par Open-Meteo (modèles de Météo-France sur la France), lu sur une grille de quarante-neuf points autour de la vue et interpolé entre eux. La teinte donne la force, les traînées blanches la direction : elles avancent d\'autant plus vite que le vent est fort. La maille du modèle est de l\'ordre du kilomètre et demi à deux kilomètres et demi : les effets d\'un cap, d\'une île ou d\'une calanque ne sont rendus qu\'en gros. C\'est une prévision, pas une mesure ; le bulletin côtier de Météo-France reste la référence avant de sortir.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat">Lecture du vent…</p>
          <div class="ligne"><button class="now">Maintenant</button><input type="range" class="hv" min="0" max="23" value="${h}" style="flex:1;min-width:120px"><span class="fort hh" style="min-width:74px;text-align:right"></span></div>
          <div class="legende">${CLASSES.map(k => `<span><i style="background:rgb(${k[1].join()})"></i>${k[2]}</span>`).join('')}</div>
          <p class="petit">Glisse pour avancer heure par heure sur 24 heures. Touche la carte pour le vent en un point.</p>`);
        q._c = c;
        toile = document.createElement('canvas'); toile.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none';
        document.body.append(toile);
        const caler = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); taille = { dpr }; toile.width = Math.round(innerWidth * dpr); toile.height = Math.round(innerHeight * dpr); };
        caler(); q._caler = caler; addEventListener('resize', caler);
        vider = () => { if (toile) toile.getContext('2d').clearRect(0, 0, toile.width, toile.height); };
        app.map.on('move', vider);
        parts.length = 0; for (let i = 0; i < (opts.particules || 1100); i++) parts.push({ lon: 0, lat: 0, age: 0 });
        c.querySelector('.hv').oninput = e => { h = +e.target.value; fond(app); dire(app, c); if (q.dernier) q.toucher(app, q.dernier); };
        c.querySelector('.now').onclick = () => { h = 0; fond(app); dire(app, c); if (q.dernier) q.toucher(app, q.dernier); };
        app.suivre(q, () => charger(app, c));
        boucle(app); await charger(app, c);
      },
      toucher(app, ll) {
        q.dernier = ll; if (!ch) return; const w = vent(ch, h, ll.lng, ll.lat);
        app.bulle(ll, w ? `${phrase(w)}<small>à ${hhmm(ch.heures[h])}, à 10 m de hauteur</small>` : 'Hors de la zone lue : déplace la carte.');
      },
      fermer(app) {
        tour++; cancelAnimationFrame(anim); anim = null; if (vider) app.map.off('move', vider); removeEventListener('resize', q._caler);
        if (toile) { toile.remove(); toile = null; } q.dernier = null; app.retirer('ventfond');
      }
    };
    return q;
  }
  S.vent = { theme, pointVent, allure, rose, beaufort, phrase, lireChamp, vent, CLASSES };
})();
