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
  const CLASSES = [[7, [159, 211, 230], '0 à 6'], [11, [108, 197, 160], '7 à 10'], [17, [233, 215, 88], '11 à 16'], [22, [242, 165, 65], '17 à 21'], [28, [228, 87, 46], '22 à 27'], [34, [181, 23, 158], '28 à 33'], [999, [106, 27, 154], '34 et plus']];
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
  /* Unité d'affichage : les nœuds en mer (par défaut), les km/h à terre (opts.unite = 'kmh'). Les calculs restent en nœuds. */
  const KMH = 1.852, enKmh = kn => Math.round(kn * KMH), dire2 = (kn, u) => u === 'kmh' ? enKmh(kn) + ' km/h' : Math.round(kn) + ' nœuds';
  const phrase = (w, u) => { const kn = force(w); return kn < 1 ? 'calme' : `<span class="fort">${dire2(kn, u)}</span> de ${rose(provenance(w))} (force ${beaufort(kn)}), rafales ${u === 'kmh' ? enKmh(w[2]) : Math.round(w[2])}`; };
  // Libellés des classes de la légende, dans l'unité choisie.
  const libelles = u => u !== 'kmh' ? CLASSES.map(k => k[2]) : CLASSES.map((k, i) => { const bas = i ? enKmh(CLASSES[i - 1][0]) : 0; return i === CLASSES.length - 1 ? bas + ' et plus' : bas + ' à ' + (enKmh(k[0]) - 1); });

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
    const F = opts.fuseau || 'Europe/Paris', UN = opts.unite === 'kmh' ? 'kmh' : 'nd';
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
      app.poser('ventfond', g, url, 0.32); app.map.setPaintProperty('ventfond', 'raster-resampling', 'linear');
    }
    function dire(app, c) {
      if (!ch) return;
      const ct = app.map.getCenter(), w = vent(ch, h, ct.lng, ct.lat), i = c.querySelector('.hv');
      i.value = h; c.querySelector('.hh').textContent = (h === 0 ? 'maintenant' : hhmm(ch.heures[h]));
      c.querySelector('.etat').innerHTML = w ? `Au centre de la carte, à ${hhmm(ch.heures[h])} : ${phrase(w, UN)}.` : 'Déplace la carte : son centre est hors de la zone lue.';
    }
    function boucle(app, t) {
      /* Trente images par seconde au plus, quel que soit l'écran (un téléphone à 120 Hz en demandait quatre fois plus, et
         les traînées y filaient deux fois trop vite) : chaque image avance donc du double, et s'efface un peu plus. */
      if (!toile) return; anim = requestAnimationFrame(t => boucle(app, t));
      if (t - (boucle.t || 0) < 31) return; boucle.t = t;
      if (!ch) return;
      const map = app.map, ctx = toile.getContext('2d'), dpr = taille.dpr, bd = map.getBounds();
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.87)'; ctx.fillRect(0, 0, toile.width, toile.height);
      ctx.globalCompositeOperation = 'source-over';
      const o = Math.max(bd.getWest(), ch.o), e = Math.min(bd.getEast(), ch.e), s = Math.max(bd.getSouth(), ch.s), n = Math.min(bd.getNorth(), ch.n);
      if (e <= o || n <= s) return;
      const degPx = 360 / (512 * Math.pow(2, map.getZoom())), pas = 0.22 * degPx;   // un vent de 10 nœuds avance d'un peu plus de deux pixels par image
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3 * dpr; ctx.lineCap = 'round'; ctx.beginPath();
      for (const p of parts) {
        if (p.age <= 0 || p.lon < o || p.lon > e || p.lat < s || p.lat > n) { p.lon = o + Math.random() * (e - o); p.lat = s + Math.random() * (n - s); p.age = 15 + Math.random() * 35; continue; }
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
          <p class="petit2" style="margin:8px 0 0">${UN === 'kmh' ? 'Force du vent, en km/h (les paliers sont ceux de l\'échelle de Beaufort)' : 'Force du vent, en nœuds (1 nœud = 1,85 km/h)'} :</p>
          <div class="legende"><span class="unite">${UN === 'kmh' ? 'km/h' : 'nœuds'} :</span>${CLASSES.map((k, i) => `<span><i style="background:rgb(${k[1].join()})"></i>${libelles(UN)[i]}</span>`).join('')}</div>
          <p class="petit">Glisse pour avancer heure par heure sur 24 heures. Touche la carte pour le vent en un point.</p>`);
        q._c = c;
        toile = document.createElement('canvas'); toile.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none';
        document.body.append(toile);
        // Des traînées floues par nature : inutile de les dessiner plus fin qu'une fois et demie l'écran.
        const caler = () => { const dpr = Math.min(1.5, window.devicePixelRatio || 1); taille = { dpr }; toile.width = Math.round(innerWidth * dpr); toile.height = Math.round(innerHeight * dpr); };
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
        app.bulle(ll, w ? `${phrase(w, UN)}<small>à ${hhmm(ch.heures[h])}, à 10 m de hauteur${UN === 'kmh' ? '' : ' · ' + enKmh(force(w)) + ' km/h'}</small>` : 'Hors de la zone lue : déplace la carte.');
      },
      fermer(app) {
        tour++; cancelAnimationFrame(anim); anim = null; if (vider) app.map.off('move', vider); removeEventListener('resize', q._caler);
        if (toile) { toile.remove(); toile = null; } q.dernier = null; app.retirer('ventfond');
      }
    };
    return q;
  }
  /* Vent par nappes d'altitude : la même animation, à plusieurs hauteurs à la fois. Chaque nappe flotte à sa hauteur
     au-dessus de la mer (exagérée pour qu'on les sépare à l'œil) ; la nappe du sol suit le terrain.
     Prototype : les traînées sont projetées avec la matrice de la vue 3D, empruntée à une couche vide de la carte. */
  async function lireNappes(app, b, n, fuseau, niveaux) {
    const lats = [], lons = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { lats.push((b[1] + (b[3] - b[1]) * j / (n - 1)).toFixed(3)); lons.push((b[0] + (b[2] - b[0]) * i / (n - 1)).toFixed(3)); }
    const vars = niveaux.map(v => `wind_speed_${v.cle},wind_direction_${v.cle}`).join(',');
    const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${vars}&wind_speed_unit=kn&forecast_hours=24&timezone=${encodeURIComponent(fuseau)}`);
    if (!j) return null;
    const pts = Array.isArray(j) ? j : [j]; if (pts.length !== n * n || !pts[0].hourly) return null;
    const heures = pts[0].hourly.time;
    const couches = niveaux.map(v => {
      const U = heures.map(() => new Float32Array(n * n)), V = heures.map(() => new Float32Array(n * n));
      pts.forEach((p, k) => heures.forEach((_, h) => { const sp = p.hourly['wind_speed_' + v.cle][h] || 0, d = (p.hourly['wind_direction_' + v.cle][h] || 0) * RAD; U[h][k] = -sp * Math.sin(d); V[h][k] = -sp * Math.cos(d); }));
      return { o: b[0], s: b[1], e: b[2], n: b[3], nx: n, heures, U, V, R: U };
    });
    return { o: b[0], s: b[1], e: b[2], n: b[3], heures, couches };
  }
  function nappes(opts) {
    opts = opts || {};
    const F = opts.fuseau || 'Europe/Paris', EX = opts.exageration || 3, UN = opts.unite === 'kmh' ? 'kmh' : 'nd';
    const NIV = opts.niveaux || [{ cle: '10m', alt: null, nom: 'au sol', coul: '#ffffff' }, { cle: '975hPa', alt: 300, nom: 'vers 300 m', coul: '#ffd166' }, { cle: '900hPa', alt: 1000, nom: 'vers 1 000 m', coul: '#ff7b9c' }];
    let ch = null, h = 0, toile = null, anim = null, tour = 0, vider = null, dpr = 1, M = null;
    const masques = new Set(), parts = NIV.map(() => []);
    const couche = { id: 'nappes-vue', type: 'custom', renderingMode: '3d', onAdd() { }, render(gl, args) { const m = args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix; if (m) M = m; } };
    async function charger(app, c) {
      const vue = app.emprise(0);
      const dedans = ch && vue[0] >= ch.o && vue[1] >= ch.s && vue[2] <= ch.e && vue[3] <= ch.n && (ch.e - ch.o) < 5 * (vue[2] - vue[0]);
      if (!dedans) {
        const moi = ++tour; app.occupe(true, 'Lecture du vent en altitude…');
        const neuf = await lireNappes(app, app.emprise(0.45), 6, F, NIV);
        app.occupe(false); if (moi !== tour || app.active !== q) return;
        if (!neuf) { if (!ch) c.querySelector('.etat').textContent = 'Le vent en altitude n\'a pas pu être lu. Réessaie dans un moment.'; return; }
        ch = neuf; h = Math.min(h, ch.heures.length - 1); c.querySelector('.hv').max = ch.heures.length - 1;
      }
      dire(app, c);
    }
    function dire(app, c) {
      if (!ch) return; const ct = app.map.getCenter();
      c.querySelector('.hv').value = h; c.querySelector('.hh').textContent = h === 0 ? 'maintenant' : hhmm(ch.heures[h]);
      const ws = ch.couches.map(k => vent(k, h, ct.lng, ct.lat));
      if (ws.some(w => !w)) { c.querySelector('.etat').textContent = 'Déplace la carte : son centre est hors de la zone lue.'; return; }
      const ecart = Math.abs(((provenance(ws[ws.length - 1]) - provenance(ws[0]) + 540) % 360) - 180);
      c.querySelector('.etat').innerHTML = `Au centre de la carte, à ${hhmm(ch.heures[h])} : ` + NIV.map((v, i) => `${v.nom}, <span class="fort">${dire2(force(ws[i]), UN)}</span> de ${rose(provenance(ws[i]))}`).join(' ; ') + `. ${ecart > 30 ? `Le vent tourne de ${Math.round(ecart)}° entre le sol et la nappe du haut.` : 'Le vent garde à peu près la même direction à toutes les hauteurs.'}`;
    }
    function boucle(app, t) {
      /* Trente images par seconde au plus, quel que soit l'écran (un téléphone à 120 Hz en demandait quatre fois plus, et
         les traînées y filaient deux fois trop vite) : chaque image avance donc du double, et s'efface un peu plus. */
      if (!toile) return; anim = requestAnimationFrame(t => boucle(app, t));
      if (t - (boucle.t || 0) < 31) return; boucle.t = t;
      if (!ch || !M) return;
      const map = app.map, ctx = toile.getContext('2d'), W = toile.width, H = toile.height, bd = map.getBounds();
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.87)'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
      const o = Math.max(bd.getWest(), ch.o), e = Math.min(bd.getEast(), ch.e), s = Math.max(bd.getSouth(), ch.s), n = Math.min(bd.getNorth(), ch.n);
      if (e <= o || n <= s) return;
      const pas = 0.22 * 360 / (512 * Math.pow(2, map.getZoom())), relief = !!map.getTerrain();
      // Position à l'écran d'un point (longitude, latitude, altitude en mètres), par la matrice de la vue.
      const ecran = (lon, lat, alt) => {
        const x = (lon + 180) / 360, y = (1 - Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / Math.PI) / 2, z = alt / (40075016.686 * Math.cos(lat * RAD));
        const cw = M[3] * x + M[7] * y + M[11] * z + M[15]; if (cw <= 0) return null;
        return [((M[0] * x + M[4] * y + M[8] * z + M[12]) / cw + 1) / 2 * W, (1 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / cw) / 2 * H];
      };
      NIV.forEach((niv, L) => {
        if (masques.has(niv.cle)) return;
        ctx.strokeStyle = niv.coul; ctx.globalAlpha = 0.9; ctx.lineWidth = (niv.alt == null ? 1.2 : 1.6) * dpr; ctx.lineCap = 'round'; ctx.beginPath();
        for (const p of parts[L]) {
          if (p.age <= 0 || p.lon < o || p.lon > e || p.lat < s || p.lat > n) {
            p.lon = o + Math.random() * (e - o); p.lat = s + Math.random() * (n - s); p.age = 15 + Math.random() * 35;
            const sol = relief ? (map.queryTerrainElevation([p.lon, p.lat]) || 0) : 0;
            p.z = niv.alt == null ? sol : niv.alt * EX; if (niv.alt != null && sol > p.z) p.age = 0;   // le relief dépasse la nappe : pas de vent ici
            continue;
          }
          const w = vent(ch.couches[L], h, p.lon, p.lat); if (!w) { p.age = 0; continue; }
          const lon2 = p.lon + w[0] * pas, lat2 = p.lat + w[1] * pas * Math.cos(p.lat * RAD), a = ecran(p.lon, p.lat, p.z), b = ecran(lon2, lat2, p.z);
          if (a && b && Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) < 80 * dpr) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
          p.lon = lon2; p.lat = lat2; p.age--;
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    const q = {
      theme: opts.theme || 'Vent 3D', libelle: opts.libelle || 'Comment le vent change-t-il avec la hauteur ?',
      aide: 'Prototype. Trois nappes de traînées, une par hauteur : le vent au sol (à 10 m), puis deux niveaux d\'altitude du modèle météo (Open-Meteo, niveaux de pression, dont la hauteur réelle varie d\'une centaine de mètres selon le temps). Chaque nappe est dessinée à sa hauteur au-dessus de la mer, multipliée par ' + EX + ' pour que l\'œil les sépare ; là où le relief dépasse une nappe, elle s\'interrompt. On y voit par exemple une brise de mer au ras de l\'eau sous un vent d\'altitude différent. La maille du modèle reste de l\'ordre de deux kilomètres : c\'est la structure d\'ensemble qui est juste, pas le détail. Incline la carte pour séparer les nappes.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<p class="etat">Lecture du vent en altitude…</p>
          <div class="ligne"><button class="now">Maintenant</button><input type="range" class="hv" min="0" max="23" value="${h}" style="flex:1;min-width:120px"><span class="fort hh" style="min-width:74px;text-align:right"></span></div>
          <div class="legende"></div><p class="petit">Touche une hauteur de la légende pour la masquer. Incline la carte (bouton 3D) pour voir les nappes l'une au-dessus de l'autre.</p>`);
        app.legende(c, NIV.map(v => ({ cle: v.cle, couleur: v.coul, texte: v.nom })), () => { if (toile) toile.getContext('2d').clearRect(0, 0, toile.width, toile.height); }, masques);
        toile = document.createElement('canvas'); toile.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none'; document.body.append(toile);
        const caler = () => { dpr = Math.min(1.5, window.devicePixelRatio || 1); toile.width = Math.round(innerWidth * dpr); toile.height = Math.round(innerHeight * dpr); };
        caler(); q._caler = caler; addEventListener('resize', caler);
        vider = () => { if (toile) toile.getContext('2d').clearRect(0, 0, toile.width, toile.height); }; app.map.on('move', vider);
        if (!app.map.getLayer('nappes-vue')) app.map.addLayer(couche);
        parts.forEach(l => { l.length = 0; for (let i = 0; i < (opts.particules || 650); i++) l.push({ lon: 0, lat: 0, age: 0, z: 0 }); });
        c.querySelector('.hv').oninput = e => { h = +e.target.value; dire(app, c); if (q.dernier) q.toucher(app, q.dernier); };
        c.querySelector('.now').onclick = () => { h = 0; dire(app, c); if (q.dernier) q.toucher(app, q.dernier); };
        if (app.map.getPitch() < 30) app.map.easeTo({ pitch: 60, duration: 800 });
        app.suivre(q, () => charger(app, c)); boucle(app); await charger(app, c);
      },
      // Au point touché : le vent à chaque hauteur, à l'heure du curseur.
      toucher(app, ll) {
        q.dernier = ll; if (!ch) return;
        const ws = ch.couches.map(k => vent(k, h, ll.lng, ll.lat));
        app.bulle(ll, ws.some(w => !w) ? 'Hors de la zone lue : déplace la carte.' : `<span class="fort">Vent à ${hhmm(ch.heures[h])}</span>` + NIV.map((v, i) => `<small>${v.nom} : <span class="fort">${dire2(force(ws[i]), UN)}</span> de ${rose(provenance(ws[i]))}</small>`).join(''));
      },
      fermer(app) {
        q.dernier = null;
        tour++; cancelAnimationFrame(anim); anim = null; if (vider) app.map.off('move', vider); removeEventListener('resize', q._caler);
        if (toile) { toile.remove(); toile = null; } if (app.map.getLayer('nappes-vue')) app.map.removeLayer('nappes-vue'); M = null;
      }
    };
    return q;
  }
  S.vent = { theme, nappes, pointVent, allure, rose, beaufort, phrase, lireChamp, vent, CLASSES };
})();
