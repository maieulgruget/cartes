/* Fonds marins : profondeurs du modèle bathymétrique de façade du Shom (HOMONIM, maille de 100 m, rapporté aux plus
   basses mers astronomiques), pour la Méditerranée française et la Corse, la façade atlantique en option.
   Le Shom ne sert ce modèle qu'en image colorée : la profondeur est retrouvée en relisant la couleur de chaque point sur
   sa palette (une suite de teintes repères, fondues entre elles). L'erreur de relecture est de l'ordre du demi-mètre
   jusqu'à 150 m de fond, d'une quinzaine de mètres au-delà, où la palette s'étire.
   Le module donne : un fond teinté en tuiles (protocole « fondsmarins »), une grille de profondeurs, des isobathes
   tracées pour la vue, la profondeur d'un point, un profil le long d'une route, et un thème prêt à poser. */
(function () {
  'use strict';
  const S = window.Socle, RAD = Math.PI / 180, R = 20037508.342789244;
  const WMS = 'https://services.data.shom.fr/INSPIRE/wms/r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857';
  // Couches du Shom et leur emprise [ouest, sud, est, nord]. Une requête ne peut en porter qu'une.
  const COUCHES = [
    ['MNT_MED100m_GDL_CA_HOMONIM_PBMA_3857_WMSR', [2.8995, 41.6995, 7.9005, 44.4005]],
    ['MNT_MED100m_CORSE_HOMONIM_PBMA_3857_WMSR', [7.6995, 40.6995, 10.4005, 43.7005]],
    ['MNT_ATL100m_HOMONIM_PBMA_3857_WMSR', [-6.0005, 43.2495, 5.8505, 52.9005]]
  ];
  // Palette du Shom (« Palette MNT HOMONIM 100 m ») : altitude en mètres et teinte, relevées sur sa légende.
  const PALETTE = [[50, 239, 236, 231], [20, 221, 220, 200], [0, 169, 170, 128], [-15, 155, 46, 30], [-30, 248, 214, 22], [-40, 0, 128, 64], [-100, 97, 224, 224],
    [-125, 49, 208, 242], [-150, 3, 151, 222], [-1000, 14, 112, 192], [-3000, 9, 63, 206], [-4000, 0, 0, 176], [-4850, 71, 52, 150]];
  const memoTeinte = new Map();
  // Altitude (négative sous l'eau) d'une teinte : le point le plus proche sur la ligne brisée de la palette.
  function lireTeinte(r, g, b) {
    const cle = (r << 16) | (g << 8) | b; let v = memoTeinte.get(cle); if (v !== undefined) return v;
    let mieux = Infinity;
    for (let k = 0; k < PALETTE.length - 1; k++) {
      const a = PALETTE[k], c = PALETTE[k + 1], vx = c[1] - a[1], vy = c[2] - a[2], vz = c[3] - a[3];
      const t = Math.max(0, Math.min(1, ((r - a[1]) * vx + (g - a[2]) * vy + (b - a[3]) * vz) / (vx * vx + vy * vy + vz * vz)));
      const e = Math.hypot(a[1] + t * vx - r, a[2] + t * vy - g, a[3] + t * vz - b);
      if (e < mieux) { mieux = e; v = a[0] + t * (c[0] - a[0]); }
    }
    if (memoTeinte.size > 60000) memoTeinte.clear();
    memoTeinte.set(cle, v); return v;
  }
  // Teintes de la carte : du clair près du bord au bleu nuit du large. [profondeur, r, v, b]
  const TEINTES = [[0, 222, 240, 236], [5, 186, 226, 228], [10, 150, 208, 220], [20, 112, 184, 208], [50, 76, 150, 188], [100, 52, 116, 164], [200, 38, 88, 140], [500, 28, 62, 110], [1000, 21, 44, 84], [2500, 14, 28, 60]];
  function teinte(p) {
    if (p <= 0) return TEINTES[0];
    for (let k = 1; k < TEINTES.length; k++) if (p <= TEINTES[k][0]) { const a = TEINTES[k - 1], b = TEINTES[k], t = (p - a[0]) / (b[0] - a[0]); return [p, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]), a[3] + t * (b[3] - a[3])]; }
    return TEINTES[TEINTES.length - 1];
  }
  const css = t => `rgb(${Math.round(t[1])},${Math.round(t[2])},${Math.round(t[3])})`;

  // Lit le modèle sur une emprise en Mercator, en w × h mailles : profondeurs en mètres (positives sous l'eau), NaN à terre
  // et hors du modèle.
  async function lire(x0, y0, x1, y1, w, h, signal) {
    const [o, s] = S.versGeo(x0, y0), [e, n] = S.versGeo(x1, y1), out = new Float32Array(w * h).fill(NaN);
    const utiles = COUCHES.filter(c => o < c[1][2] && e > c[1][0] && s < c[1][3] && n > c[1][1]);
    await Promise.all(utiles.map(async c => {
      const r = await fetch(`${WMS}&LAYERS=${c[0]}&BBOX=${x0},${y0},${x1},${y1}&WIDTH=${w}&HEIGHT=${h}`, { signal }); if (!r.ok) throw new Error('Fonds marins : ' + r.status);
      const bmp = await createImageBitmap(await r.blob()), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let k = 0; k < w * h; k++) if (d[4 * k + 3] > 200 && out[k] !== out[k]) { const alt = lireTeinte(d[4 * k], d[4 * k + 1], d[4 * k + 2]); if (alt < 0) out[k] = -alt; }
    }));
    return out;
  }
  // Grille de profondeurs sur une emprise géographique [ouest, sud, est, nord], compatible avec app.poser.
  async function grille(bornes, largeur, signal) {
    const [x0, y0] = S.versMerc(bornes[0], bornes[1]), [x1, y1] = S.versMerc(bornes[2], bornes[3]);
    const w = Math.max(8, Math.min(640, Math.round(largeur))), h = Math.max(8, Math.min(640, Math.round(w * (y1 - y0) / (x1 - x0))));
    return { z: await lire(x0, y0, x1, y1, w, h, signal), w, h, x0, y0, x1, y1, bornes };
  }
  // Profondeur d'un point (mètres, positive) ; NaN à terre ou hors du modèle. repli = true : au large, hors du modèle
  // du Shom, on prend le relief mondial (bien plus grossier).
  async function profondeur(lon, lat, repli) {
    const [x, y] = S.versMerc(lon, lat), d = 150;
    let p = NaN; try { p = (await lire(x - d, y - d, x + d, y + d, 3, 3))[4]; } catch (e) { p = NaN; }
    if (p !== p && repli && !COUCHES.some(c => lon > c[1][0] && lon < c[1][2] && lat > c[1][1] && lat < c[1][3])) { const a = await S.altitudeMonde(lon, lat); if (a < -2) p = -a; }
    return p;
  }
  /* Profil des fonds le long d'une route (liste de [lon, lat]) : n points régulièrement espacés, lus dans une seule
     grille couvrant la route. Renvoie [{ d : distance en milles depuis le départ, p : profondeur ou NaN, lon, lat }]. */
  async function profil(route, n) {
    let o = 180, s = 90, e = -180, nn = -90; for (const q of route) { o = Math.min(o, q[0]); e = Math.max(e, q[0]); s = Math.min(s, q[1]); nn = Math.max(nn, q[1]); }
    const m = Math.max(0.004, (e - o) * 0.04, (nn - s) * 0.04), g = await grille([o - m, s - m, e + m, nn + m], 420);
    const longs = []; let total = 0; for (let k = 1; k < route.length; k++) { const l = S.distKm(route[k - 1], route[k]) / 1.852; longs.push(l); total += l; }
    const out = [];
    for (let i = 0; i < n; i++) {
      let d = total * i / (n - 1), k = 0; while (k < longs.length - 1 && d > longs[k]) { d -= longs[k]; k++; }
      const t = longs[k] ? Math.min(1, d / longs[k]) : 0, lon = route[k][0] + t * (route[k + 1][0] - route[k][0]), lat = route[k][1] + t * (route[k + 1][1] - route[k][1]);
      const ix = S.indice(g, lon, lat); out.push({ d: total * i / (n - 1), p: ix < 0 ? NaN : g.z[ix], lon, lat, troncon: k + 1 });
    }
    return { points: out, total, maille: (g.x1 - g.x0) / g.w * Math.cos((s + nn) / 2 * RAD) };
  }

  // ---------- Tuiles teintées ----------
  // fondsmarins://z/x/y/seuil : seuil en décimètres ; les fonds de moins que ce seuil sont peints en orangé (0 : aucun).
  function brancher() {
    if (brancher.fait) return; brancher.fait = true;
    maplibregl.addProtocol('fondsmarins', async (params) => {
      const [z, x, y, seuil] = params.url.replace('fondsmarins://', '').split('/').map(Number), t = 2 * R / (1 << z), x0 = -R + x * t, y1 = R - y * t;
      const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'), im = ctx.createImageData(256, 256), d = im.data;
      let p = null; try { p = await lire(x0, y1 - t, x0 + t, y1, 256, 256); } catch (e) { p = null; }
      if (p) for (let k = 0; k < 65536; k++) {
        const v = p[k]; if (v !== v) continue;
        if (seuil && v < seuil / 10) { d[4 * k] = 228; d[4 * k + 1] = 87; d[4 * k + 2] = 46; d[4 * k + 3] = 235; continue; }
        const q = teinte(v); d[4 * k] = q[1]; d[4 * k + 1] = q[2]; d[4 * k + 2] = q[3]; d[4 * k + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      return { data: await (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer() };
    });
  }

  // ---------- Isobathes ----------
  // Lisse la grille (moyenne 3 × 3 qui ignore les absences) : la relecture des teintes fait de petites marches.
  function lisser(g) {
    const { z, w, h } = g, out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (z[k] !== z[k]) { out[k] = NaN; continue; }
      let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; const v = z[jj * w + ii]; if (v === v) { s += v; n++; } }
      out[k] = s / n;
    }
    return out;
  }
  /* Lignes d'égale profondeur de la grille g, par carrés (« marching squares »), recousues en longues lignes pour porter
     leur cote. Renvoie des entités GeoJSON { p : profondeur }. */
  function isobathes(g, niveaux) {
    const { w, h } = g, z = lisser(g), feats = [];
    const geo = (fi, fj) => S.versGeo(g.x0 + (fi + 0.5) / w * (g.x1 - g.x0), g.y1 - (fj + 0.5) / h * (g.y1 - g.y0));
    for (const niv of niveaux) {
      const segs = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = z[j * w + i], b = z[j * w + i + 1], c = z[(j + 1) * w + i + 1], d = z[(j + 1) * w + i];
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const cas = (a > niv ? 1 : 0) | (b > niv ? 2 : 0) | (c > niv ? 4 : 0) | (d > niv ? 8 : 0); if (cas === 0 || cas === 15) continue;
        const haut = [i + (niv - a) / (b - a), j], droite = [i + 1, j + (niv - b) / (c - b)], bas = [i + (niv - d) / (c - d), j + 1], gauche = [i, j + (niv - a) / (d - a)];
        const paires = { 1: [[gauche, haut]], 2: [[haut, droite]], 3: [[gauche, droite]], 4: [[droite, bas]], 5: [[gauche, haut], [droite, bas]], 6: [[haut, bas]], 7: [[gauche, bas]], 8: [[bas, gauche]], 9: [[bas, haut]], 10: [[haut, droite], [bas, gauche]], 11: [[bas, droite]], 12: [[droite, gauche]], 13: [[droite, haut]], 14: [[haut, gauche]] }[cas];
        for (const q of paires) segs.push(q);
      }
      // Couture : chaque extrémité est rangée par sa position arrondie ; on suit les segments de proche en proche.
      const cle = q => Math.round(q[0] * 50) + ',' + Math.round(q[1] * 50), bouts = new Map(), pris = new Uint8Array(segs.length);
      segs.forEach((sg, n) => { for (const q of sg) { const k = cle(q); if (!bouts.has(k)) bouts.set(k, []); bouts.get(k).push(n); } });
      const suivre = (ligne) => { for (;;) { const k = cle(ligne[ligne.length - 1]), n = (bouts.get(k) || []).find(m => !pris[m]); if (n === undefined) return; pris[n] = 1; const sg = segs[n]; ligne.push(cle(sg[0]) === k ? sg[1] : sg[0]); } };
      const lignes = [];
      for (let n = 0; n < segs.length; n++) { if (pris[n]) continue; pris[n] = 1; const l = [segs[n][0], segs[n][1]]; suivre(l); l.reverse(); suivre(l); if (l.length > 4) lignes.push(adoucir(adoucir(l)).map(q => geo(q[0], q[1]))); }
      if (lignes.length) feats.push({ type: 'Feature', properties: { p: niv, t: niv + ' m', fort: niv === 5 || niv === 10 || niv === 20 ? 1 : 0 }, geometry: { type: 'MultiLineString', coordinates: lignes } });
    }
    return feats;
  }
  // Adoucit une ligne brisée en coupant ses angles (Chaikin) : les mailles ne dessinent plus de marches.
  function adoucir(l) {
    if (l.length < 3) return l; const ferme = Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 0.05, out = ferme ? [] : [l[0]];
    for (let k = 0; k < l.length - 1; k++) { const a = l[k], b = l[k + 1]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    if (ferme) out.push(out[0]); else out.push(l[l.length - 1]);
    return out;
  }
  const niveauxPour = zoom => zoom < 9 ? [50, 200, 1000] : zoom < 11 ? [20, 50, 100, 200, 500, 1000] : zoom < 12.5 ? [10, 20, 50, 100, 200, 500] : [5, 10, 20, 50, 100, 200];

  // ---------- Thème « Fonds » ----------
  function theme(opts) {
    opts = opts || {};
    let tirant = 0, tour = 0;
    try { tirant = +(localStorage.getItem('cartes.fonds.tirant') || 0) || 0; } catch (e) { tirant = 0; }
    const marge = 1;   // un mètre d'eau sous la quille
    const seuil = () => tirant ? Math.round((tirant + marge) * 10) : 0;
    const tuiles = () => [`fondsmarins://{z}/{x}/{y}/${seuil()}`];
    const fr = v => String(v).replace('.', ',');
    const dire = p => p < 10 ? fr(p.toFixed(1)) + ' m' : Math.round(p) + ' m';
    function poser(app) {
      brancher();
      if (!app.map.getSource('fondsmarins')) {
        app.map.addSource('fondsmarins', { type: 'raster', tiles: tuiles(), tileSize: 256, minzoom: 5, maxzoom: 12, attribution: 'Fonds marins : MNT HOMONIM © Shom' });
        app.map.addLayer({ id: 'fondsmarins', type: 'raster', source: 'fondsmarins', paint: { 'raster-opacity': 0.94, 'raster-fade-duration': 150 } }, 'analyses');
        app.map.addSource('isobathes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        app.map.addLayer({ id: 'isobathes', type: 'line', source: 'isobathes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'fort'], 1], '#12324f', '#2a5a80'], 'line-width': ['case', ['==', ['get', 'fort'], 1], 1.5, 0.8], 'line-opacity': ['case', ['==', ['get', 'fort'], 1], 0.9, 0.6] } }, 'analyses');
        app.map.addLayer({ id: 'isobathes-cote', type: 'symbol', source: 'isobathes', layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['get', 't'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 11, 'text-max-angle': 35 }, paint: { 'text-color': '#12324f', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 } });
      } else app.map.getSource('fondsmarins').setTiles(tuiles());
    }
    async function tracer(app) {
      const moi = ++tour, c = q._c;
      try {
        const g = await grille(app.emprise(0.1), 260); if (moi !== tour || app.active !== q) return;
        const src = app.map.getSource('isobathes'); if (src) src.setData({ type: 'FeatureCollection', features: isobathes(g, niveauxPour(app.map.getZoom())) });
        let n = 0, min = Infinity, max = 0; for (const v of g.z) if (v === v) { n++; if (v < min) min = v; if (v > max) max = v; }
        c.querySelector('.etat').innerHTML = n ? `Dans la vue : ${min < 1 ? 'du bord' : 'de <span class="fort">' + dire(min) + '</span>'} à <span class="fort">${dire(max)}</span> de fond. Touche la mer pour la profondeur d'un point.` : 'Pas de fonds connus dans cette vue : le modèle couvre la Méditerranée française et la Corse.';
      } catch (e) { if (moi === tour && app.active === q) c.querySelector('.etat').textContent = 'Les fonds n\'ont pas pu être lus (le service du Shom ne répond pas). Réessaie dans un moment.'; }
    }
    const q = {
      theme: opts.theme || 'Fonds', libelle: opts.libelle || 'Quelle profondeur ?', famille: opts.famille,
      aide: 'Profondeurs du modèle bathymétrique de façade du Shom (HOMONIM), à la maille de 100 m, rapportées aux plus basses mers astronomiques, proches du zéro des cartes marines. Le Shom diffuse ce modèle en image colorée : la carte en relit les teintes pour retrouver les profondeurs, à un demi-mètre près jusqu\'à 150 m de fond, bien moins finement au-delà. Les lignes d\'égale profondeur sont retracées pour la vue affichée ; les sondes de 5, 10 et 20 m sont renforcées. Une maille de 100 m lisse le fond : une roche isolée, une tête de roche ou une épave n\'y figurent pas, et un haut-fond étroit peut être plus haut que ce que la carte annonce. La zone orangée (moins que le tirant d\'eau plus un mètre) est une aide à la lecture, pas une limite de sécurité : seule la carte marine fait foi.',
      async ouvrir(app) {
        const c = q._c = app.repondre(q.libelle, `<p class="etat">Lecture des fonds…</p>
          <div class="legende">${[2, 5, 10, 20, 50, 100, 200, 500, 1000].map(p => `<span><i style="background:${css(teinte(p))}"></i>${p} m</span>`).join('')}<span><i style="background:#e4572e"></i>trop peu d'eau</span></div>
          <div class="ligne"><label style="min-width:84px">Tirant d'eau</label><input type="range" class="te" min="0" max="3" step="0.1" value="${tirant}" style="flex:1;min-width:110px"><span class="fort v-te" style="min-width:78px;text-align:right"></span></div>
          <p class="petit2 n-te"></p>`);
        const maj = () => { c.querySelector('.v-te').textContent = tirant ? fr(tirant.toFixed(1)) + ' m' : 'non réglé'; c.querySelector('.n-te').textContent = tirant ? `En orangé : moins de ${fr((tirant + marge).toFixed(1))} m d'eau (tirant d'eau plus un mètre).` : 'Règle le tirant d\'eau du bateau pour faire ressortir les fonds trop faibles.'; };
        c.querySelector('.te').oninput = e => { tirant = +e.target.value; maj(); };
        c.querySelector('.te').onchange = () => { try { localStorage.setItem('cartes.fonds.tirant', tirant); } catch (e) { } poser(app); };
        maj(); poser(app); app.suivre(q, () => tracer(app)); await tracer(app);
      },
      async toucher(app, ll) {
        const moi = q.pt = (q.pt || 0) + 1; app.bulle(ll, 'Lecture du fond…');
        const p = await profondeur(ll.lng, ll.lat, true); if (moi !== q.pt || app.active !== q) return;
        app.bulle(ll, p === p ? `<span class="fort">${dire(p)}</span> de fond<small>modèle du Shom à 100 m, sous les plus basses mers${tirant && p < tirant + marge ? ' · trop peu d\'eau pour ' + fr(tirant.toFixed(1)) + ' m de tirant' : ''}</small>` : 'Pas de fond connu ici<small>à terre, ou hors du modèle</small>');
      },
      fermer(app) { tour++; app.retirer('isobathes-cote', 'isobathes', 'fondsmarins'); }
    };
    return q;
  }

  /* Trait de côte fin pour le Plan IGN (voir tuilePlan dans le socle) : 1 là où le modèle du Shom donne de l'eau,
     0 là où il donne de la terre, 2 là où il ne dit rien. Les tuiles sans donnée ne sont demandées qu'une fois. */
  const cacheCote = new Map();
  function coteTuile(z, x, y) {
    const cle = z + '/' + x + '/' + y;
    if (!cacheCote.has(cle)) {
      cacheCote.set(cle, (async () => {
        const t = 2 * R / (1 << z), x0 = -R + x * t, y1 = R - y * t, [o, s] = S.versGeo(x0, y1 - t), [e, n] = S.versGeo(x0 + t, y1), m = new Uint8Array(65536).fill(2);
        const utiles = COUCHES.filter(c => o < c[1][2] && e > c[1][0] && s < c[1][3] && n > c[1][1]); if (!utiles.length) return null;
        for (const c of utiles) {
          const r = await fetch(`${WMS}&LAYERS=${c[0]}&BBOX=${x0},${y1 - t},${x0 + t},${y1}&WIDTH=256&HEIGHT=256`); if (!r.ok) continue;
          const cv = document.createElement('canvas'); cv.width = cv.height = 256; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(await createImageBitmap(await r.blob()), 0, 0);
          const d = ctx.getImageData(0, 0, 256, 256).data;
          for (let k = 0; k < 65536; k++) if (m[k] === 2 && d[4 * k + 3] > 200) m[k] = lireTeinte(d[4 * k], d[4 * k + 1], d[4 * k + 2]) < 0 ? 1 : 0;
        }
        return m;
      })().catch(() => null));
      if (cacheCote.size > 200) cacheCote.delete(cacheCote.keys().next().value);
    }
    return cacheCote.get(cle);
  }
  // Le modèle a une maille de 100 m : le demander au-delà du zoom 11 n'apporte rien. De plus près, le masque d'une tuile
  // est découpé dans celui de sa tuile parente du zoom 11, demandée une seule fois pour toutes ses tuiles filles.
  window.Socle.planMer.fin = async (z, x, y) => {
    const zz = Math.min(z, 11), f = 1 << (z - zz), parent = await coteTuile(zz, Math.floor(x / f), Math.floor(y / f));
    if (!parent || f === 1) return parent;
    const m = new Uint8Array(65536), ox = (x % f) * 256 / f, oy = (y % f) * 256 / f;
    for (let j = 0; j < 256; j++) { const sj = Math.min(255, Math.floor(oy + j / f)) * 256; for (let i = 0; i < 256; i++) m[j * 256 + i] = parent[sj + Math.min(255, Math.floor(ox + i / f))]; }
    return m;
  };

  window.Socle.fonds = { lire, grille, profondeur, profil, isobathes, niveauxPour, teinte, css, theme, brancher, get tirant() { try { return +(localStorage.getItem('cartes.fonds.tirant') || 0) || 0; } catch (e) { return 0; } } };
})();
