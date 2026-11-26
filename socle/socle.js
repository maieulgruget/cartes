/* Socle commun des cartes.
   - Carte MapLibre plein écran : fond gris (Plan IGN vectoriel), Plan IGN HD et photo aérienne en bascule ; bâtiments en volume en vue 3D rapprochée.
   - Relief : MNT LiDAR HD de l'IGN, lu à la volée (WMS raster, flottants 32 bits) et converti en tuiles de relief ;
     repli sur les tuiles Terrarium là où l'IGN n'a pas de valeur (hors de France).
   - Interface : une rangée de thèmes (regroupés en familles), une réponse à la fois ; signets (des vues), recherche de lieux, 2D/3D.
   - Analyses : grille d'altitudes de la vue courante, pentes et expositions, soleil, ombres portées. */
(function () {
  'use strict';
  const GEOPF = 'https://data.geopf.fr';
  const MNT = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G';
  const MNS = 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G';
  const RGEALTI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';   // comprend les fonds proches de la côte (Litto3D)
  const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const R = 20037508.342789244, RAD = Math.PI / 180;

  // ---------- Géométrie ----------
  const versMerc = (lon, lat) => [lon * R / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R / Math.PI];
  const versGeo = (x, y) => [x * 180 / R, Math.atan(Math.exp(y * Math.PI / R)) * 360 / Math.PI - 90];
  const distKm = (a, b) => { const dx = (a[0] - b[0]) * Math.cos((a[1] + b[1]) / 2 * RAD), dy = a[1] - b[1]; return Math.hypot(dx, dy) * 111.2; };
  const wmts = (couche, fmt, style) => `${GEOPF}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${couche}&STYLE=${style || 'normal'}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;

  // ---------- Altitudes : lecture d'une grille auprès de l'IGN ----------
  /* Lit une grille d'altitudes sur une emprise en Mercator (x0, y0, x1, y1), en w × h mailles.
     Le service de l'IGN rééchantillonne au plus proche voisin : demandé directement en Mercator, il répète une ligne
     sur cinq ou six (son relief est rangé en degrés), ce qui crée de fausses marches. On le demande donc dans sa
     géométrie d'origine (mailles carrées en degrés), puis on recale les lignes en Mercator par interpolation. */
  async function lireBil(couche, x0, y0, x1, y1, w, h, signal) {
    const [lon0, lat0] = versGeo(x0, y0), [lon1, lat1] = versGeo(x1, y1);
    const hs = Math.max(2, Math.round(w * (lat1 - lat0) / (lon1 - lon0)));
    const u = `${GEOPF}/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${couche}&STYLES=&FORMAT=image/x-bil;bits=32&CRS=EPSG:4326&BBOX=${lat0},${lon0},${lat1},${lon1}&WIDTH=${w}&HEIGHT=${hs}`;
    let r = await fetch(u, { signal });
    if (!r.ok) { await new Promise(res => setTimeout(res, 600)); r = await fetch(u, { signal }); }   // un second essai : le service refuse parfois une requête qu'il accepte l'instant d'après
    if (!r.ok) throw new Error('Altitudes IGN : ' + r.status);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < w * hs * 4) throw new Error('Altitudes IGN : réponse incomplète');
    const src = new Float32Array(buf, 0, w * hs), out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const lat = versGeo(0, y1 - (j + 0.5) * (y1 - y0) / h)[1];
      const f = Math.min(hs - 1, Math.max(0, (lat1 - lat) / (lat1 - lat0) * hs - 0.5)), ja = Math.floor(f), jb = Math.min(hs - 1, ja + 1), u2 = f - ja;
      for (let i = 0; i < w; i++) {
        const a = src[ja * w + i], b = src[jb * w + i];
        out[j * w + i] = absent(a) ? b : absent(b) ? a : a + (b - a) * u2;
      }
    }
    return out;
  }
  const absent = v => !(v > -500 && v < 9000);   // valeurs « sans donnée » de l'IGN (-9999, -99999 et leurs interpolations)

  /* Grille d'altitudes sur une emprise géographique. bornes = [ouest, sud, est, nord]. largeur en pixels.
     surface = true : modèle de surface (arbres et bâtiments compris). Les absences valent NaN. */
  async function grille(bornes, largeur, opts) {
    opts = opts || {};
    const [x0, y0] = versMerc(bornes[0], bornes[1]), [x1, y1] = versMerc(bornes[2], bornes[3]);
    const w = Math.max(16, Math.round(largeur)), h = Math.max(16, Math.min(900, Math.round(w * (y1 - y0) / (x1 - x0))));
    const z = await lireBil(opts.couche || (opts.surface ? MNS : MNT), x0, y0, x1, y1, w, h, opts.signal);
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < z.length; i++) { if (absent(z[i])) z[i] = NaN; else { if (z[i] < zmin) zmin = z[i]; if (z[i] > zmax) zmax = z[i]; } }
    const latMil = (bornes[1] + bornes[3]) / 2;
    return { z, w, h, x0, y0, x1, y1, bornes, zmin, zmax, pas: (x1 - x0) / w * Math.cos(latMil * RAD), surface: !!opts.surface };
  }
  function indice(g, lon, lat) {
    const [x, y] = versMerc(lon, lat);
    const i = Math.floor((x - g.x0) / (g.x1 - g.x0) * g.w), j = Math.floor((g.y1 - y) / (g.y1 - g.y0) * g.h);
    return (i < 0 || j < 0 || i >= g.w || j >= g.h) ? -1 : j * g.w + i;
  }

  // Pente (degrés) et exposition (azimut vers lequel le versant regarde, 0 = nord) par différences centrées.
  function pentes(g) {
    const { z, w, h, pas } = g, p = new Float32Array(w * h), e = new Float32Array(w * h);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      const dzx = (z[k + 1] - z[k - 1]) / (2 * pas), dzy = (z[k - w] - z[k + w]) / (2 * pas);   // x vers l'est, y vers le nord
      if (dzx !== dzx || dzy !== dzy) { p[k] = NaN; e[k] = NaN; continue; }
      p[k] = Math.atan(Math.hypot(dzx, dzy)) / RAD;
      e[k] = (Math.atan2(-dzx, -dzy) / RAD + 360) % 360;
    }
    return { pente: p, expo: e };
  }

  // Position du soleil (formules de l'almanach, précision de l'ordre du demi-degré). azimut depuis le nord, hauteur en degrés.
  function soleil(date, lat, lon) {
    const d = date.getTime() / 864e5 - 0.5 + 2440588 - 2451545;
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI, eps = RAD * 23.4397;
    const dec = Math.asin(Math.sin(L) * Math.sin(eps)), ad = Math.atan2(Math.sin(L) * Math.cos(eps), Math.cos(L));
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ad, phi = RAD * lat;
    const haut = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { azimut: (az / RAD + 180 + 360) % 360, hauteur: haut / RAD };
  }

  // Le point k de la grille reçoit-il le soleil ? On remonte le rayon vers le soleil jusqu'à sortir de la grille ou dépasser le plus haut relief.
  // Le relief est lu par interpolation entre mailles : au plus proche voisin, un rayon rasant qui longe un versant
  // accroche une maille plus haute une fois sur deux et dessine de fausses bandes d'ombre.
  function eclaire(g, k, azimut, hauteur) {
    if (hauteur <= 0) return false;
    const { z, w, h, pas, zmax } = g, z0 = z[k];
    if (z0 !== z0) return true;
    const dx = Math.sin(azimut * RAD), dy = -Math.cos(azimut * RAD), tan = Math.tan(hauteur * RAD) * pas;
    const i0 = k % w, j0 = (k - i0) / w, marge = (g.surface ? 1.5 : 0.3) + 0.04 * pas;
    for (let t = 1; ; t += (t < 16 ? 1 : t * 0.06)) {
      const x = i0 + dx * t, y = j0 + dy * t;
      if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return true;
      const rayon = z0 + marge + t * tan;
      if (rayon > zmax) return true;
      const i = x | 0, jj = y | 0, fx = x - i, fy = y - jj, a = jj * w + i, i1 = i < w - 1 ? 1 : 0, j1 = jj < h - 1 ? w : 0;
      const zi = (z[a] * (1 - fx) + z[a + i1] * fx) * (1 - fy) + (z[a + j1] * (1 - fx) + z[a + j1 + i1] * fx) * fy;
      if (zi > rayon) return false;
    }
  }
  function ombres(g, azimut, hauteur) {
    const n = g.w * g.h, o = new Uint8Array(n);
    for (let k = 0; k < n; k++) o[k] = eclaire(g, k, azimut, hauteur) ? 0 : 1;
    return o;
  }

  // Dessine une grille : couleur(k) renvoie [r, v, b, a] (0-255) ou rien. Renvoie une image prête à poser sur la carte.
  function peindre(g, couleur) {
    const c = document.createElement('canvas'); c.width = g.w; c.height = g.h;
    const ctx = c.getContext('2d'), im = ctx.createImageData(g.w, g.h), d = im.data;
    for (let k = 0, n = g.w * g.h; k < n; k++) { const q = couleur(k); if (q) { d[4 * k] = q[0]; d[4 * k + 1] = q[1]; d[4 * k + 2] = q[2]; d[4 * k + 3] = q[3]; } }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL('image/png');
  }

  // ---------- Relief pour la carte : protocole « ignalti » ----------
  const cacheTuiles = new Map();
  async function tuileTerrarium(z, x, y) {
    const zz = Math.min(z, 14), f = 1 << (z - zz);
    const r = await fetch(TERRARIUM.replace('{z}', zz).replace('{x}', Math.floor(x / f)).replace('{y}', Math.floor(y / f)));
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, (x % f) * 256 / f, (y % f) * 256 / f, 256 / f, 256 / f, 0, 0, 256, 256);
    return ctx.getImageData(0, 0, 256, 256).data;
  }
  let tuilePlate = null;
  // surface = true : modèle de surface (arbres et bâtiments compris), complété par le sol nu là où il manque.
  async function tuileRelief(z, x, y, surface) {
    const t = 2 * R / (1 << z), x0 = -R + x * t, y1 = R - y * t;
    // En pleine mer (le relief mondial est partout sous -3 m), il n'y a ni LiDAR à demander ni relief à montrer :
    // une tuile plate, faite une fois, évite deux requêtes par tuile.
    const lim = await bornesAlti(z, x, y);
    if (lim && lim.max < -3) {
      if (!tuilePlate) { const c0 = document.createElement('canvas'); c0.width = c0.height = 256; const g = c0.getContext('2d'); g.fillStyle = 'rgb(128,0,0)'; g.fillRect(0, 0, 256, 256); tuilePlate = new Promise(res => c0.toBlob(res, 'image/png')).then(b => b.arrayBuffer()); }
      return (await tuilePlate).slice(0);
    }
    let alt = null;
    try { alt = await lireBil(MNT, x0, y1 - t, x0 + t, y1, 256, 256); } catch (e) { alt = null; }
    /* Arbres : le modèle de surface brut, point par point, donne un hérisson (chaque cime est un pic, et le maillage de
       la carte n'en garde qu'un point sur deux). On ne garde donc que la hauteur du couvert au-dessus du sol (surface
       moins sol nu), sans ce qui fait moins de 2 m (herbes, bruit : routes et prés restent lisses), puis on l'adoucit
       avant de la reposer sur le sol : la forêt devient un volume aux formes rondes, les lisières restent nettes. */
    if (surface && alt) {
      try {
        const s = await lireBil(MNS, x0, y1 - t, x0 + t, y1, 256, 256), h = new Float32Array(65536), tmp = new Float32Array(65536);
        for (let k = 0; k < 65536; k++) { const d = absent(s[k]) || absent(alt[k]) ? 0 : s[k] - alt[k]; h[k] = d < 2 ? 0 : Math.min(d, 60); }
        const r = z >= 16 ? 3 : z >= 15 ? 2 : 1;   // rayon de l'adoucissement, en points : 5 m environ à tous les zooms
        for (let passe = 0; passe < 2; passe++) {   // deux passes de moyenne glissante, en ligne puis en colonne : proche d'un flou de Gauss
          for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < 256) { a += h[j * 256 + ii]; n++; } } tmp[j * 256 + i] = a / n; }
          for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < 256) { a += tmp[jj * 256 + i]; n++; } } h[j * 256 + i] = a / n; }
        }
        for (let k = 0; k < 65536; k++) if (!absent(alt[k])) alt[k] += h[k];
      } catch (e) { /* on garde le sol nu */ }
    }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'), im = ctx.createImageData(256, 256), d = im.data;
    let manque = !alt;
    if (alt) for (let k = 0; k < 65536; k++) if (absent(alt[k])) { manque = true; break; }
    let repli = null;
    if (manque) { try { repli = await tuileTerrarium(z, x, y); } catch (e) { repli = null; } }
    for (let k = 0; k < 65536; k++) {
      if (alt && !absent(alt[k])) {
        const v = alt[k] + 32768; d[4 * k] = Math.floor(v / 256); d[4 * k + 1] = Math.floor(v) % 256; d[4 * k + 2] = Math.floor((v - Math.floor(v)) * 256);
      } else if (repli && repli[4 * k] >= 128) { d[4 * k] = repli[4 * k]; d[4 * k + 1] = repli[4 * k + 1]; d[4 * k + 2] = repli[4 * k + 2]; }
      else if (repli) { d[4 * k] = 128; d[4 * k + 1] = 0; d[4 * k + 2] = 0; }   // le relief mondial porte les fonds marins aux petits zooms : la mer reste plate, au niveau zéro
      else { d[4 * k] = 128; d[4 * k + 1] = 0; d[4 * k + 2] = 0; }
      d[4 * k + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return blob.arrayBuffer();
  }
  /* Plan IGN HD seul. Il ne couvre pas tout : à terre (centre de la Bretagne) il laisse du blanc, que l'on garde tel quel ;
     en mer il ne dessine le bleu que près des côtes et laisse le large en blanc. Ce blanc-là est repeint en bleu, mais
     seulement là où le relief mondial donne franchement de la mer (altitude sous -2 m) : un blanc de terre reste blanc. */
  const MER_PLAN = [64, 130, 156];
  const planMer = { fin: null };
  const cacheMer = new Map();
  // Altitudes (mètres) d'une tuile du relief mondial, zoom 10 au plus : c'est à ces zooms qu'il porte les fonds marins.
  function altiMonde(z, x, y) {
    const cle = z + '/' + x + '/' + y;
    if (!cacheMer.has(cle)) {
      cacheMer.set(cle, (async () => {
        const r = await fetch(TERRARIUM.replace('{z}', z).replace('{x}', x).replace('{y}', y)); if (!r.ok) throw new Error('relief mondial ' + r.status);
        const bmp = await createImageBitmap(await r.blob()), c = document.createElement('canvas'); c.width = c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data, a = new Float32Array(65536);
        for (let k = 0; k < 65536; k++) a[k] = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768;
        return a;
      })().catch(() => null));
      if (cacheMer.size > 60) cacheMer.delete(cacheMer.keys().next().value);
    }
    return cacheMer.get(cle);
  }
  // Altitude du relief mondial en un point (interpolée) ; négative en mer. Sert aussi de profondeur de repli au large.
  async function altitudeMonde(lon, lat) {
    const n = 1024, fx = (lon + 180) / 360 * n, fy = (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * n;
    const a = await altiMonde(10, Math.floor(fx), Math.floor(fy)); if (!a) return NaN;
    return a[Math.min(255, Math.floor((fy % 1) * 256)) * 256 + Math.min(255, Math.floor((fx % 1) * 256))];
  }
  // Altitudes extrêmes du relief mondial sur une tuile (z, x, y), d'après sa tuile parente : un tri rapide entre la
  // pleine mer, l'intérieur des terres et la côte, sans rien demander de plus que cette tuile parente, gardée en mémoire.
  async function bornesAlti(z, x, y) {
    const zz = Math.min(z, 10), f = 1 << (z - zz), a = await altiMonde(zz, Math.floor(x / f), Math.floor(y / f)); if (!a) return null;
    const i0 = Math.max(0, Math.floor((x % f) * 256 / f) - 1), i1 = Math.min(255, Math.ceil(((x % f) + 1) * 256 / f)), j0 = Math.max(0, Math.floor((y % f) * 256 / f) - 1), j1 = Math.min(255, Math.ceil(((y % f) + 1) * 256 / f));
    let min = Infinity, max = -Infinity;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = a[j * 256 + i]; if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }
  // Masque de mer d'une tuile (z, x, y) : 1 là où le relief mondial est sous -2 m, interpolé depuis sa tuile parente.
  async function masqueMer(z, x, y) {
    const zz = Math.min(z, 10), f = 1 << (z - zz), a = await altiMonde(zz, Math.floor(x / f), Math.floor(y / f));
    if (!a) return null;
    const m = new Uint8Array(65536), ox = (x % f) * 256 / f, oy = (y % f) * 256 / f; let mer = 0;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const sx = Math.min(254.999, Math.max(0, ox + (i + 0.5) / f - 0.5)), sy = Math.min(254.999, Math.max(0, oy + (j + 0.5) / f - 0.5));
      const i0 = sx | 0, j0 = sy | 0, u = sx - i0, v = sy - j0, k = j0 * 256 + i0;
      const alt = (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + 256] * (1 - u) + a[k + 257] * u) * v;
      if (alt < -0.5) { m[j * 256 + i] = 1; mer++; }
    }
    return mer ? m : null;
  }
  async function tuilePlan(z, x, y) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
    let brut = null;
    try { const r = await fetch(`${GEOPF}/tms/1.0.0/IGNF_PLAN-IGN-HD/${z}/${x}/${y}.jpeg`); if (r.ok) brut = await r.arrayBuffer(); } catch (e) { /* tuile absente : blanc */ }
    // Loin de la mer (tout est au-dessus de 4 m), il n'y a rien à repeindre : la tuile part sans être décodée.
    const lim = await bornesAlti(z, x, y);
    if (brut && lim && lim.min > 4) return brut;
    if (brut) { try { ctx.drawImage(await createImageBitmap(new Blob([brut], { type: 'image/jpeg' })), 0, 0); } catch (e) { return brut; } }
    const im = ctx.getImageData(0, 0, 256, 256), d = im.data;
    // Le plan a deux bleus de mer (un clair par endroits près des côtes) : le clair est ramené au bleu courant, sinon la mer
    // se lit en rectangles. Une tuile sans blanc ni bleu clair (moins de 1 %) est rendue telle quelle.
    const clair = k => { const r = d[4 * k], g = d[4 * k + 1], b = d[4 * k + 2]; return r > 48 && r < 104 && g > 137 && g < 178 && b > 160 && b < 208 && b - r > 80; };   // du bleu clair du plan (76, 158, 188) à ses mélanges avec le bleu courant
    let blancs = 0, clairs = 0; for (let k = 0; k < 65536; k += 7) { if (d[4 * k] > 243 && d[4 * k + 1] > 243 && d[4 * k + 2] > 243) blancs++; else if (clair(k)) clairs++; }
    if (blancs < 90 && clairs < 90 && brut) return brut;
    let m = await masqueMer(z, x, y);
    // Un module (les fonds marins) peut donner un trait de côte bien plus fin que le relief mondial : 1 mer, 0 terre, 2 inconnu.
    if (planMer.fin && !(lim && lim.max < -20)) { try { const f = await planMer.fin(z, x, y); if (f) { const g = new Uint8Array(65536); for (let k = 0; k < 65536; k++) g[k] = f[k] === 2 ? (m ? m[k] : 0) : f[k]; m = g; } } catch (e) { /* on garde le masque grossier */ } }
    if (!m) return brut || (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer();
    /* Seules les grandes plages blanches sont repeintes : un nom écrit en blanc sur la mer doit rester lisible. Un point
       est au cœur d'une plage si tout son voisinage (5 × 5) est blanc ; la plage est ensuite élargie de cinq
       points, pour reprendre sa lisière pâle jusqu'au bleu du plan. */
    const somme = (src) => { const I = new Int32Array(257 * 257); for (let j = 0; j < 256; j++) { let l = 0; for (let i = 0; i < 256; i++) { l += src[j * 256 + i]; I[(j + 1) * 257 + i + 1] = I[j * 257 + i + 1] + l; } } return I; };
    const compte = (I, i, j, r) => { const a = Math.max(0, i - r), b = Math.min(255, i + r), e = Math.max(0, j - r), f = Math.min(255, j + r); return [I[(f + 1) * 257 + b + 1] - I[e * 257 + b + 1] - I[(f + 1) * 257 + a] + I[e * 257 + a], (b - a + 1) * (f - e + 1)]; };
    const blanc = new Uint8Array(65536); for (let k = 0; k < 65536; k++) blanc[k] = d[4 * k] > 236 && d[4 * k + 1] > 236 && d[4 * k + 2] > 236 ? 1 : 0;
    const Ib = somme(blanc), coeur = new Uint8Array(65536);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const q = compte(Ib, i, j, 2); coeur[j * 256 + i] = q[0] >= q[1] ? 1 : 0; }
    const Ic = somme(coeur); let change = false;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = j * 256 + i; if (!m[k] || d[4 * k] + d[4 * k + 1] + d[4 * k + 2] < 395 || !compte(Ic, i, j, 5)[0]) continue;   // plus clair que la mer du plan, au bord d'une plage blanche
      d[4 * k] = MER_PLAN[0]; d[4 * k + 1] = MER_PLAN[1]; d[4 * k + 2] = MER_PLAN[2]; change = true;
    }
    if (clairs >= 90) for (let k = 0; k < 65536; k++) if (m[k] && clair(k)) { d[4 * k] = MER_PLAN[0]; d[4 * k + 1] = MER_PLAN[1]; d[4 * k + 2] = MER_PLAN[2]; change = true; }
    if (!change && brut) return brut;
    ctx.putImageData(im, 0, 0);
    return (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer();
  }
  /* Photos posées par-dessus la photo courante : une prise de vue plus récente (ortho-express) ou plus fine (très haute
     résolution), qui ne couvrent qu'une partie du pays. Hors de leur emprise, leurs tuiles manquent, ou sont blanches
     (le JPEG n'a pas de transparence) : on rend ici ce blanc transparent, pour laisser voir la photo du dessous.
     Seules les grandes plages blanches sont percées (cœur : tout un voisinage de 5 × 5 blanc ; puis leur lisière claire) :
     un toit blanc, un névé restent en place. */
  let tuileVide = null;
  const vide = () => tuileVide || (tuileVide = (async () => { const c = document.createElement('canvas'); c.width = c.height = 256; return (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer(); })());
  async function tuileSur(couche, z, x, y) {
    let brut = null;
    try { const r = await fetch(wmts(couche, 'image/jpeg').replace('{z}', z).replace('{x}', x).replace('{y}', y)); if (r.ok) brut = await r.arrayBuffer(); } catch (e) { brut = null; }
    if (!brut) return (await vide()).slice(0);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    try { ctx.drawImage(await createImageBitmap(new Blob([brut], { type: 'image/jpeg' })), 0, 0); } catch (e) { return brut; }
    const im = ctx.getImageData(0, 0, 256, 256), d = im.data;
    let blancs = 0; for (let k = 0; k < 65536; k += 5) if (d[4 * k] > 250 && d[4 * k + 1] > 250 && d[4 * k + 2] > 250) blancs++;
    if (blancs < 40) return brut;
    const blanc = new Uint8Array(65536); for (let k = 0; k < 65536; k++) blanc[k] = d[4 * k] > 250 && d[4 * k + 1] > 250 && d[4 * k + 2] > 250 ? 1 : 0;
    const somme = src => { const I = new Int32Array(257 * 257); for (let j = 0; j < 256; j++) { let l = 0; for (let i = 0; i < 256; i++) { l += src[j * 256 + i]; I[(j + 1) * 257 + i + 1] = I[j * 257 + i + 1] + l; } } return I; };
    const compte = (I, i, j, r) => { const a = Math.max(0, i - r), b = Math.min(255, i + r), e = Math.max(0, j - r), f = Math.min(255, j + r); return [I[(f + 1) * 257 + b + 1] - I[e * 257 + b + 1] - I[(f + 1) * 257 + a] + I[e * 257 + a], (b - a + 1) * (f - e + 1)]; };
    const Ib = somme(blanc), coeur = new Uint8Array(65536); let coeurs = 0;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const q = compte(Ib, i, j, 2); if (q[0] >= q[1]) { coeur[j * 256 + i] = 1; coeurs++; } }
    if (!coeurs) return brut;
    if (coeurs > 65000) return (await vide()).slice(0);
    const Ic = somme(coeur);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const k = j * 256 + i; if (d[4 * k] > 205 && d[4 * k + 1] > 205 && d[4 * k + 2] > 205 && compte(Ic, i, j, 4)[0]) d[4 * k + 3] = 0; }
    ctx.putImageData(im, 0, 0);
    return (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer();
  }
  function brancherRelief() {
    if (brancherRelief.fait) return; brancherRelief.fait = true;
    maplibregl.addProtocol('ignsur', async (params) => {
      const [couche, z, x, y] = params.url.replace('ignsur://', '').split('/');
      return { data: await tuileSur(couche, +z, +x, +y) };
    });
    maplibregl.addProtocol('ignplan', async (params) => {
      const [z, x, y] = params.url.replace('ignplan://', '').split('/').map(Number);
      return { data: await tuilePlan(z, x, y) };
    });
    const relief = (nom, surface) => maplibregl.addProtocol(nom, async (params) => {
      const cle = params.url;
      if (!cacheTuiles.has(cle)) {
        const [z, x, y] = cle.replace(nom + '://', '').split('/').map(Number);
        cacheTuiles.set(cle, tuileRelief(z, x, y, surface));
        if (cacheTuiles.size > 400) cacheTuiles.delete(cacheTuiles.keys().next().value);
      }
      const data = await cacheTuiles.get(cle);
      return { data: data.slice(0) };
    });
    relief('ignalti', false); relief('ignsurf', true);
  }

  // ---------- Météo (Open-Meteo, sans clé) ----------
  async function meteo(url) {
    try { const r = await fetch(url); const j = await r.json(); return (!r.ok || j.error) ? null : j; } catch (e) { return null; }
  }

  // ---------- Petits outils d'interface ----------
  const el = (balise, attrs, html) => { const n = document.createElement(balise); if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]); if (html != null) n.innerHTML = html; return n; };
  const propre = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const garde = { lire(c, d) { try { return JSON.parse(localStorage.getItem(c)) || d; } catch (e) { return d; } }, ecrire(c, v) { try { localStorage.setItem(c, JSON.stringify(v)); } catch (e) { } } };

  // ---------- Création d'une carte ----------
  async function creer(cfg) {
    brancherRelief();
    const style = await (await fetch(cfg.racine + 'socle/style-gris.json')).json();
    /* Sous un fond en image (Plan IGN, photo, relief, géologie), le dessin du fond gris ne se voit pas : ses centaines
       de calques de surfaces et de lignes sont éteints, pour ne garder que ses noms. Ils sont rallumés sur le fond gris.
       C'est le premier poste d'économie : le téléphone ne prépare plus un dessin que personne ne voit. */
    const fondInitial = cfg.fond || 'plan';
    const dessinGris = style.layers.filter(l => l.type !== 'symbol' && l.type !== 'background' && !(l.layout && l.layout.visibility === 'none')).map(l => l.id);
    if (fondInitial !== 'gris') for (const l of style.layers) if (dessinGris.includes(l.id)) l.layout = Object.assign({}, l.layout, { visibility: 'none' });
    let grisAllume = fondInitial === 'gris';
    // Les étiquettes passent toutes au-dessus : les analyses se glissent entre les surfaces et les noms.
    style.layers = [...style.layers.filter(l => l.type !== 'symbol'), ...style.layers.filter(l => l.type === 'symbol')];
    const premierTexte = style.layers.findIndex(l => l.type === 'symbol');
    Object.assign(style.sources, {
      ortho: { type: 'raster', tiles: [wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')], tileSize: 256, maxzoom: 19, attribution: '© IGN' },
      /* Par-dessus la photo courante (la dernière BD ORTHO de chaque département, à 20 cm) : la photo à très haute
         résolution (5 à 10 cm), là où elle existe. Le fond « Photo 2025 » y glisse en plus l'ortho-express de l'année, là
         où elle existe : plus récente, mais produite vite (teintes et ombres moins soignées, parfois prise en hiver), d'où
         un fond à part plutôt qu'un remplacement. À revoir chaque année : l'ortho-express change de nom avec son millésime. */
      orthorecent: { type: 'raster', tiles: ['ignsur://ORTHOIMAGERY.ORTHOPHOTOS.ORTHO-EXPRESS.2025/{z}/{x}/{y}'], tileSize: 256, minzoom: 10, maxzoom: 19, attribution: 'Ortho-express 2025 © IGN' },
      orthothr: { type: 'raster', tiles: ['ignsur://THR.ORTHOIMAGERY.ORTHOPHOTOS/{z}/{x}/{y}'], tileSize: 256, minzoom: 13, maxzoom: 21, attribution: 'Ortho THR © IGN et partenaires' },
      plan: { type: 'raster', tiles: ['ignplan://{z}/{x}/{y}'], tileSize: 256, minzoom: 6, maxzoom: 18, attribution: 'Plan IGN © IGN' },
      // Carte au 1/25 000 (SCAN 25) : accès par la clé grand public de l'IGN, réservée à un usage personnel et non commercial.
      scan25: { type: 'raster', tiles: [`${GEOPF}/private/tms/1.0.0/GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR/{z}/{x}/{y}.jpeg?apikey=ign_scan_ws`], tileSize: 256, minzoom: 6, maxzoom: 16, attribution: 'SCAN 25® © IGN' },
      ombrage: { type: 'raster', tiles: [wmts('IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png')], tileSize: 256, maxzoom: 18, attribution: 'LiDAR HD © IGN' },
      geologie: { type: 'raster', tiles: [wmts('BRGM_SCAN_D_GEOL50', 'image/jpeg')], tileSize: 256, maxzoom: 15, attribution: 'Carte géologique © BRGM' },
      geol250: { type: 'raster', tiles: [wmts('BRGM_SCAN_F_GEOL250', 'image/jpeg')], tileSize: 256, maxzoom: 14, attribution: 'Carte géologique © BRGM' },
      geol1m: { type: 'raster', tiles: [wmts('BRGM_SCAN_F_GEOL1M', 'image/jpeg')], tileSize: 256, maxzoom: 11, attribution: 'Carte géologique © BRGM' },
      etatmajor: { type: 'raster', tiles: [wmts('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'image/jpeg')], tileSize: 256, minzoom: 6, maxzoom: 15, attribution: 'Carte de l\'état-major © IGN' },
      cassini: { type: 'raster', tiles: [wmts('BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 'image/png')], tileSize: 256, minzoom: 6, maxzoom: 14, attribution: 'Carte de Cassini © BnF, IGN' },
      carte1950: { type: 'raster', tiles: [wmts('GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950', 'image/jpeg')], tileSize: 256, minzoom: 3, maxzoom: 15, attribution: 'Carte de 1950 © IGN' },
      bdtopo: { type: 'vector', tiles: [`${GEOPF}/tms/1.0.0/BDTOPO/{z}/{x}/{y}.pbf`], minzoom: 15, maxzoom: 18, attribution: 'BD TOPO © IGN' },
      // Relief en tuiles de 512 points à l'écran : quatre fois moins de tuiles à demander qu'en 256, pour un maillage 3D qui n'y perd rien de visible.
      relief: { type: 'raster-dem', tiles: ['ignalti://{z}/{x}/{y}'], tileSize: 512, maxzoom: 14, encoding: 'terrarium', attribution: 'Relief : LiDAR HD © IGN' },
      // Relief « avec les arbres » : le modèle de surface du LiDAR HD, lu jusqu'au zoom 16 (un point tous les 2 m environ). Il ne sert que de près.
      surface: { type: 'raster-dem', tiles: ['ignsurf://{z}/{x}/{y}'], tileSize: 512, minzoom: 12, maxzoom: 16, encoding: 'terrarium', attribution: 'Surface : LiDAR HD © IGN' },
      estompe: { type: 'raster-dem', tiles: ['ignalti://{z}/{x}/{y}'], tileSize: 512, maxzoom: 14, encoding: 'terrarium' }
    });
    style.layers.splice(premierTexte, 0,
      { id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: 'none' } },
      { id: 'orthorecent', type: 'raster', source: 'orthorecent', minzoom: 10, layout: { visibility: 'none' } },
      { id: 'orthothr', type: 'raster', source: 'orthothr', minzoom: 13, layout: { visibility: 'none' } },
      { id: 'plan', type: 'raster', source: 'plan', layout: { visibility: 'none' } },
      { id: 'scan25', type: 'raster', source: 'scan25', layout: { visibility: 'none' } },
      { id: 'ombrage', type: 'raster', source: 'ombrage', layout: { visibility: 'none' } },
      // Géologie à trois échelles, enchaînées selon le zoom : le million de loin, le 1/250 000, puis le 1/50 000.
      { id: 'geol1m', type: 'raster', source: 'geol1m', maxzoom: 7.5, layout: { visibility: 'none' } },
      { id: 'geol250', type: 'raster', source: 'geol250', minzoom: 7.5, maxzoom: 10.5, layout: { visibility: 'none' } },
      { id: 'geologie', type: 'raster', source: 'geologie', minzoom: 10.5, layout: { visibility: 'none' } },
      { id: 'etatmajor', type: 'raster', source: 'etatmajor', layout: { visibility: 'none' } },
      { id: 'cassini', type: 'raster', source: 'cassini', layout: { visibility: 'none' } },
      { id: 'carte1950', type: 'raster', source: 'carte1950', layout: { visibility: 'none' } },
      { id: 'estompe', type: 'hillshade', source: 'estompe', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#2b3545', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#55617a' } },
      { id: 'analyses', type: 'background', paint: { 'background-opacity': 0 } });   // repère : les analyses se glissent sous les étiquettes
    /* Noms en double. Le fond porte les noms de l'eau sous deux formes : posés en un point, et couchés le long d'une ligne.
       Pour une même classe de nom (une passe, une anse), les deux existent souvent à la fois : on lisait deux fois
       « Passe de l'Ouest », l'un net, l'autre couché sur la mer. Les classes déjà servies par un calque ponctuel sont
       retirées des calques linéaires ; les noms qui n'existent qu'en ligne (rivières, canaux) restent. */
    const classes = l => Array.isArray(l.filter) && (l.filter[0] === 'in' || l.filter[0] === '==') && l.filter[1] === 'txt_typo' ? l.filter.slice(2) : [];
    const ponctuelles = new Set(style.layers.filter(l => l['source-layer'] === 'toponyme_hydro_ponc').flatMap(classes));
    for (const l of style.layers) if (l['source-layer'] === 'toponyme_hydro_lin') { const c = classes(l); if (c.length) l.filter = ['in', 'txt_typo', ...c.filter(v => !ponctuelles.has(v))]; }
    // Une carte qui apporte ses propres noms (ports, caps, anses) écarte les familles de noms du fond qui feraient doublon.
    if (cfg.sansNoms) style.layers = style.layers.filter(l => !(l.type === 'symbol' && cfg.sansNoms.includes(l['source-layer'])));
    const textes = style.layers.filter(l => l.type === 'symbol').map(l => l.id);
    style.layers.splice(style.layers.findIndex(l => l.id === 'analyses') + 1, 0,
      { id: 'batiments3d', type: 'fill-extrusion', source: 'bdtopo', 'source-layer': 'batiment', minzoom: 15, layout: { visibility: 'none' },
        paint: { 'fill-extrusion-height': ['coalesce', ['get', 'hauteur'], 4], 'fill-extrusion-opacity': 0.8, 'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-color': ['match', ['get', 'usage_1'], 'Résidentiel', '#e8dcc2', 'Agricole', '#c9b458', 'Commercial et services', '#7aa6c2', 'Industriel', '#9a8fb5', 'Religieux', '#c97b63', 'Sportif', '#7fb069', 'Annexe', '#cfcfcf', '#dcdcdc'] } });

    document.body.append(el('div', { id: 'carte' }));
    const map = new maplibregl.Map({
      container: 'carte', style, center: cfg.centre, zoom: cfg.zoom, pitch: cfg.pitch || 0, bearing: cfg.bearing || 0,
      maxPitch: 78, maxBounds: cfg.limites || undefined, attributionControl: false, hash: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2)   // un téléphone à trois points par pixel dessinerait plus du double de points pour un gain peu visible
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.touchZoomRotate.enableRotation(); map.touchPitch.enable();
    await new Promise(res => map.once('load', res));
    const exag0 = cfg.exageration || 1;
    const surPhoto = () => fond === 'ortho' || fond === 'recent';
    let exag = exag0, relief3d = false, arbres = true, solNu = false, sourceRelief = 'relief';
    /* « Arbres » : en vue 3D rapprochée (zoom 14,5 et plus), le relief passe du sol nu au modèle de surface du LiDAR HD :
       la forêt, les haies et les bâtiments prennent du volume sous l'image du fond. De plus loin, le sol nu revient :
       le modèle de surface coûte quatre fois plus de lectures, pour un grain qui ne se verrait pas.
       Les arbres ne vont qu'avec la photo aérienne : sur une carte dessinée, le couvert gonflé tord les routes, les
       courbes et les noms. Sur la photo ils sont là d'office, et le bouton « Couvert » (qui n'apparaît que sur ce fond) les retire.
       Un thème qui dresse ses propres volumes (les cimes, arbre par arbre) demande le sol nu : app.forcerSolNu. */
    const ZARBRES = 14.5;
    const poserRelief = () => { const s = arbres && !solNu && surPhoto() && map.getZoom() >= ZARBRES ? 'surface' : 'relief'; if (relief3d && (s !== sourceRelief || !map.getTerrain())) map.setTerrain({ source: s, exaggeration: exag }); sourceRelief = s; };
    // Les bâtiments en volume ne s'affichent que sur le fond gris, en vue 3D : ailleurs ils cachent plus qu'ils n'aident. Avec les arbres, le relief les porte déjà.
    const majBatiments = () => map.setLayoutProperty('batiments3d', 'visibility', relief3d && fond === 'gris' && sourceRelief !== 'surface' ? 'visible' : 'none');
    const mettre3d = oui => { relief3d = oui; if (oui) { map.setTerrain(null); poserRelief(); } else map.setTerrain(null); majBatiments(); map.easeTo({ pitch: oui ? (cfg.pitch3d || 60) : 0, duration: 700 }); b3d.setAttribute('aria-pressed', oui); };
    const mettreArbres = oui => { arbres = oui; majArbres(); if (oui && !relief3d) mettre3d(true); else poserRelief(); majBatiments(); };
    map.on('zoomend', () => { if (arbres && relief3d) { poserRelief(); majBatiments(); } });

    // --- Interface ---
    const bTitre = el('button', { class: 'titre', 'aria-label': 'Menu : recherche, vues gardées, réglages, sources' }, `<b>${propre(cfg.titre)}</b><span>${propre(cfg.sousTitre || '')}<i class="m"> · menu ▾</i></span>`);
    const outils = el('div', { class: 'outils' });
    // Pictogrammes des outils (trait de 1,8, couleur du texte) : la colonne reste étroite et se lit sans mots.
    const picto = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const PICTO = {
      ici: picto('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>'),
      maison: picto('<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.8 9.6V20h12.4V9.6"/><path d="M10 20v-5.4h4V20"/>'),
      loupe: picto('<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/>'),
      fond: picto('<path d="m12 3.5 9 4.8-9 4.8-9-4.8z"/><path d="m3.6 12.4 8.4 4.5 8.4-4.5"/><path d="m3.6 16.2 8.4 4.5 8.4-4.5"/>'),
      arbre: picto('<path d="M12 2.8 7.6 9h2.2L6 14.6h4.6"/><path d="M12 2.8 16.4 9h-2.2L18 14.6h-4.6"/><path d="M12 12.5V21"/><path d="M9 21h6"/>'),
      couvert: picto('<path d="M6.6 14.6a4.1 4.1 0 0 1-.5-8 5 5 0 0 1 9.3-1.3 4.4 4.4 0 0 1 2.2 8.5 3.6 3.6 0 0 1-3 1H8.4a3.6 3.6 0 0 1-1.8-.2z"/><path d="M12 11v10"/><path d="m12 15.5 2.6-2.2"/>'),
      survol: picto('<path d="M4 19c2.5-6 5-2 7.5-7S16 5 20 5"/><path d="m16.8 3.6 3.6 1.3-1.3 3.6"/><circle cx="4" cy="19" r="1.3"/>'),
      ecran: picto('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
      retour: picto('<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H14a5.5 5.5 0 0 1 0 11h-2" transform="translate(0 -3.2)"/>')
    };
    const bFond = el('button', { class: 'rond fond', 'aria-label': 'Choisir le fond de carte', title: 'Fond de carte' }, PICTO.fond), b3d = el('button', { class: 'rond', 'aria-pressed': 'false', 'aria-label': 'Relief en 3D', title: 'Relief en 3D' }, '3D'), bArbres = el('button', { class: 'rond', 'aria-pressed': 'true', hidden: '', 'aria-label': 'Couvert des arbres et bâtiments en volume sur la photo aérienne, en vue 3D rapprochée', title: 'Couvert en volume' }, PICTO.couvert), bSurvol = el('button', { class: 'rond', 'aria-pressed': 'false', hidden: '', 'aria-label': 'Survoler le tracé affiché', title: 'Survol du tracé' }, PICTO.survol), bSem = el('button', { class: 'rond', 'aria-pressed': 'false', 'aria-label': 'Arbres dressés un par un autour du centre de la vue, d\'après le LiDAR', title: 'Arbres' }, PICTO.arbre), bIci = el('button', { class: 'rond ici', 'aria-label': 'Aller à ma position', title: 'Ma position' }, PICTO.ici), bRetour = el('button', { class: 'rond', 'aria-label': 'Revenir à la vue précédente', hidden: '', title: 'Vue précédente' }, PICTO.retour), bNord = el('button', { class: 'boussole', 'aria-label': 'Boussole : la pointe rouge montre le nord. Toucher pour remettre le nord en haut' }, '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M16 3 L21 16 L16 14 L11 16 Z" fill="#e4572e"/><path d="M16 29 L11 16 L16 18 L21 16 Z" fill="#c9d2de"/><circle cx="16" cy="16" r="1.6" fill="#10192a"/></svg><span>N</span>'),
      bMaison = el('button', { class: 'rond', 'aria-label': 'Aller à la maison', title: 'Maison' }, PICTO.maison),
      bEcran = el('button', { class: 'rond ecran', 'aria-label': 'Affichage grand écran : la carte, son titre et la réponse du thème, rien d\'autre', title: 'Grand écran (touche F)' }, PICTO.ecran);
    outils.append(bFond, b3d, bArbres, bSem, bSurvol, bNord, bIci, bMaison, bRetour, bEcran); bNord.title = 'Nord en haut'; bMaison.hidden = !cfg.maison;
    const bas = el('div', { class: 'bas' }), reponse = el('div', { class: 'reponse', hidden: '' }), rang = el('div', { class: 'questions' }),
      sous = el('div', { class: 'sousthemes', hidden: '' }), familles = new Map();
    bas.append(reponse, sous, rang);
    const attente = el('div', { class: 'attente', hidden: '' }, 'Calcul…');
    const menu = el('div', { class: 'menu', hidden: '' });
    const bCartes = el('button', { class: 'cartes', 'aria-label': 'Revenir à toutes les cartes', title: 'Toutes les cartes' }, '‹');
    bCartes.onclick = () => { location.href = cfg.racine; };
    // Repère de la carte libre : le seul bouton qui reste, avec celui des fonds, quand tout le reste est rangé.
    const bRepere = el('button', { class: 'repere', 'aria-label': 'Faire revenir les boutons et le panneau', hidden: '' }, '☰');
    document.body.append(bCartes, bTitre, outils, bas, attente, menu, bRepere);

    /* Ordinateur (et tablette couchée) : dès que la fenêtre est assez grande, les thèmes et la réponse quittent le bas
       de l'écran pour une colonne à gauche, de la largeur d'un téléphone : chaque panneau s'y lit comme il a été dessiné.
       La carte reçoit une marge du même côté : son centre reste au milieu de la partie visible, et un lieu recherché
       n'arrive pas sous la colonne. La marge tombe quand la colonne est rangée (carte seule, grand écran). */
    const mqBureau = window.matchMedia('(min-width: 900px) and (min-height: 560px)');
    const bureau = () => mqBureau.matches;
    const COLONNE = 410;
    function caler(anime) {
      document.body.classList.toggle('bureau', bureau());
      const cl = document.body.classList, g = bureau() && !cl.contains('libre') && !cl.contains('ecran') ? COLONNE : 0;
      if (((map.getPadding() || {}).left || 0) !== g) map.easeTo({ padding: { left: g, top: 0, right: 0, bottom: 0 }, duration: anime ? 350 : 0 });
    }
    mqBureau.addEventListener('change', () => caler(true));
    const clePanneau = () => bureau() ? 'cartes.panneau.bureau' : 'cartes.panneau';   // sur ordinateur, le panneau s'ouvre en grand tant qu'on ne l'a pas réduit
    const params = new URLSearchParams(location.search);   // lien partagé : ?theme=…&fond=…, et ?ecran pour l'affichage grand écran
    let themeVoulu = params.get('theme');

    /* Fonds de carte. Chacun allume un ou plusieurs calques en image ; « estompe » est la force de l'ombrage du relief posé
       dessus (0 : aucun). La carte géologique et les cartes anciennes ne couvrent que la métropole : une carte peut en
       écarter (cfg.geologie = false, cfg.fondsExclus = ['etatmajor', …]). */
    const FONDS = {
      plan: { nom: 'Plan HD', note: 'Plan IGN HD, drapé sur le relief', calques: ['plan'], estompe: 0 },
      scan25: { nom: 'Carte 25', note: 'carte de randonnée au 1/25 000 (SCAN 25)', calques: ['scan25'], estompe: 0, sansNoms: true },
      gris: { nom: 'Gris', note: 'fond sobre, bâtiments en volume de près', calques: [], estompe: 0.4 },
      ortho: { nom: 'Photo', note: 'photographie aérienne, la plus fine disponible de près', calques: ['ortho', 'orthothr'], estompe: 0.12 },
      recent: { nom: 'Photo 2025', note: 'ortho-express 2025 là où elle existe : plus récente, moins soignée', calques: ['ortho', 'orthorecent', 'orthothr'], estompe: 0.12, photo: true },
      ombrage: { nom: 'Relief', note: 'ombrage du LiDAR HD', calques: ['ombrage'], estompe: 0 },
      geologie: { nom: 'Géologie', note: 'cartes géologiques du BRGM, trois échelles', calques: ['geol1m', 'geol250', 'geologie'], estompe: 0.25 },
      carte1950: { nom: 'Carte 1950', note: 'carte topographique des années 1950', calques: ['carte1950'], estompe: 0.12, ancien: true },
      etatmajor: { nom: 'État-major', note: 'carte de l\'état-major, 1820-1866', calques: ['etatmajor'], estompe: 0.12, ancien: true },
      cassini: { nom: 'Cassini', note: 'carte de Cassini, XVIIIe siècle', calques: ['cassini'], estompe: 0, ancien: true }
    };
    const exclus = (cfg.fondsExclus || []).concat(cfg.geologie === false ? ['geologie'] : []);
    const fonds = Object.keys(FONDS).filter(f => !exclus.includes(f)), IMAGES = [...new Set(Object.values(FONDS).flatMap(f => f.calques))];
    let fond = 'gris', nomsEteints = false;
    const surFond = [];   // fonctions prévenues à chaque changement de fond
    function mettreFond(f) {
      if (!FONDS[f]) f = 'plan';
      fond = f; bFond.setAttribute('aria-label', 'Fond de carte : ' + FONDS[f].nom); bFond.title = 'Fond : ' + FONDS[f].nom;
      if ((f === 'gris') !== grisAllume) { grisAllume = f === 'gris'; for (const id of dessinGris) map.setLayoutProperty(id, 'visibility', grisAllume ? 'visible' : 'none'); }
      for (const id of IMAGES) map.setLayoutProperty(id, 'visibility', FONDS[f].calques.includes(id) ? 'visible' : 'none');
      // L'ombrage du relief est retiré pour de bon là où il n'a rien à faire : réglé à zéro, il laissait encore un voile
      // clair par tuiles entières (bandes pâles à bords droits sur le Plan et le Relief).
      // Une carte déjà écrite (le 1/25 000) éteint les noms du fond, qui s'y liraient deux fois.
      if (!!FONDS[f].sansNoms !== nomsEteints) { nomsEteints = !!FONDS[f].sansNoms; for (const id of textes) map.setLayoutProperty(id, 'visibility', nomsEteints ? 'none' : 'visible'); }
      map.setLayoutProperty('estompe', 'visibility', FONDS[f].estompe ? 'visible' : 'none');
      if (FONDS[f].estompe) map.setPaintProperty('estompe', 'hillshade-exaggeration', FONDS[f].estompe);
      for (const fn of surFond) { try { fn(f); } catch (e) { console.error(e); } }
      majArbres(); poserRelief(); majBatiments();
    }
    // Le bouton des fonds ouvre une courte liste : un toucher choisit, un toucher ailleurs referme.
    const listeFonds = el('div', { class: 'listefonds', hidden: '' });
    document.body.append(listeFonds);
    function ouvrirFonds() {
      const ligne = f => `<button data-f="${f}" aria-pressed="${f === fond}">${FONDS[f].nom}<small>${FONDS[f].note}</small></button>`;
      const anciens = fonds.filter(f => FONDS[f].ancien);
      listeFonds.innerHTML = fonds.filter(f => !FONDS[f].ancien).map(ligne).join('') + (anciens.length ? '<p>Cartes anciennes</p>' + anciens.map(ligne).join('') : '');
      listeFonds.hidden = false;
    }
    listeFonds.onclick = e => { const b = e.target.closest('button[data-f]'); if (b) { mettreFond(b.dataset.f); listeFonds.hidden = true; } };
    bFond.onclick = e => { e.stopPropagation(); if (listeFonds.hidden) ouvrirFonds(); else listeFonds.hidden = true; };
    document.addEventListener('click', e => { if (!listeFonds.hidden && !listeFonds.contains(e.target)) listeFonds.hidden = true; });
    b3d.onclick = () => mettre3d(!relief3d);
    /* Deux boutons. « Couvert », sur la photo seulement : le couvert en volume, allumé d'office. « Arbres », sur tous les
       fonds : les arbres dressés un par un d'après le LiDAR (socle/arbres.js, chargé à la demande), éteints au départ,
       qui suivent la carte. Arbres dressés, le relief revient au sol nu : ils remplacent le couvert en volume. */
    let coucheArbres = null;
    const chargerArbres = () => window.Socle.arbres ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = cfg.racine + 'socle/arbres.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
    const semantique = () => !!(app._arbres && app._arbres.actif);
    const majArbres = () => { bArbres.hidden = !surPhoto(); bArbres.setAttribute('aria-pressed', arbres && !semantique()); bSem.setAttribute('aria-pressed', semantique()); };
    bArbres.onclick = () => mettreArbres(!arbres);
    /* « Survol » : un mode de lecture de la carte, pas un réglage d'un thème. Le bouton apparaît dès qu'un thème propose
       un tracé à suivre (une rando choisie, un itinéraire dessiné) : app.survol.proposer(cle, () => ({ pts, suivre, fin }) ou null).
       Le dernier tracé proposé l'emporte. socle/survol.js est chargé à la demande. */
    const tracesVol = new Map(); let volEnCours = null;
    const traceVol = () => { let t = null; for (const f of tracesVol.values()) { try { const v = f(); if (v && v.pts && v.pts.length > 1) t = v; } catch (e) { /* tracé indisponible */ } } return t; };
    const survol = {
      proposer(cle, f) { tracesVol.delete(cle); tracesVol.set(cle, f); survol.maj(); },
      retirer(cle) { tracesVol.delete(cle); survol.maj(); },
      maj() { bSurvol.hidden = !volEnCours && !traceVol(); },
      arreter() { if (volEnCours) volEnCours.arreter(); },
      get enCours() { return !!volEnCours; }
    };
    bSurvol.onclick = async () => {
      if (volEnCours) { volEnCours.arreter(); return; }
      const t = traceVol(); if (!t) return;
      if (!window.Socle.survol) { try { await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = cfg.racine + 'socle/survol.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc); }); } catch (e) { app.occupe(true, 'Le survol ne se charge pas pour l\'instant'); setTimeout(() => app.occupe(false), 2500); return; } }
      bSurvol.setAttribute('aria-pressed', 'true');
      volEnCours = window.Socle.survol.lancer(app, t.pts, { suivre: t.suivre, fin(alafin) { volEnCours = null; bSurvol.setAttribute('aria-pressed', 'false'); survol.maj(); if (t.fin) t.fin(alafin); } });
    };
    bSem.onclick = async () => {
      try { await chargerArbres(); } catch (e) { app.occupe(true, 'Les arbres ne se chargent pas pour l\'instant'); setTimeout(() => app.occupe(false), 2500); return; }
      if (!coucheArbres) coucheArbres = window.Socle.arbres.couche(app);
      if (!coucheArbres.surChange.includes(majArbres)) coucheArbres.surChange.push(majArbres);
      const allumer = !coucheArbres.actif; await coucheArbres.activer(allumer);
      if (allumer && coucheArbres.message) { app.occupe(true, coucheArbres.message); setTimeout(() => app.occupe(false), 3200); }
      majArbres();
    };
    bNord.onclick = () => map.easeTo({ bearing: 0, duration: 600 });
    // La boussole tourne avec la carte : sa pointe rouge reste tournée vers le nord.
    const tournerBoussole = () => { const b = map.getBearing(); bNord.querySelector('svg').style.transform = `rotate(${-b}deg)`; bNord.classList.toggle('tournee', Math.abs(b) > 1); };
    map.on('rotate', tournerBoussole); tournerBoussole();

    const app = {
      map, cfg, grille, indice, pentes, soleil, eclaire, ombres, peindre, meteo, propre, versGeo, versMerc, distKm,
      get fond() { return fond; }, mettreFond, mettre3d, surFond, altitudeMonde,
      // Marges d'un cadrage (fitBounds) : celles du téléphone, où le panneau occupe le bas ; sur ordinateur la colonne est déjà comptée par la marge de la carte.
      marges(telephone) { return bureau() ? { top: 80, bottom: 50, left: 50, right: 90 } : telephone; }, get bureau() { return bureau(); }, ecran,
      get relief3d() { return relief3d; }, libre, survol, mettreArbres, get arbres() { return arbres; }, forcerSolNu(oui) { solNu = !!oui; poserRelief(); majBatiments(); majArbres(); },
      occupe(oui, texte) { attente.textContent = texte || 'Calcul…'; attente.hidden = !oui; },
      // Emprise de la vue courante, élargie d'une marge (fraction), bornée pour rester raisonnable en vue inclinée.
      emprise(marge) {
        const b = map.getBounds(), c = map.getCenter(); let o = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
        const max = 360 / Math.pow(2, map.getZoom()) * 1.6;   // largeur maximale en degrés
        o = Math.max(o, c.lng - max); e = Math.min(e, c.lng + max); s = Math.max(s, c.lat - max * 0.8); n = Math.min(n, c.lat + max * 0.8);
        const m = marge || 0, dx = (e - o) * m, dy = (n - s) * m;
        return [o - dx, s - dy, e + dx, n + dy];
      },
      // Pose (ou remplace) une image géoréférencée sur la grille g, sous les étiquettes. Les mailles sont fondues entre
      // elles (pas de carrés nets) ; net = true garde la maille brute.
      poser(id, g, url, opacite, net) {
        const [o, s] = versGeo(g.x0, g.y0), [e, n] = versGeo(g.x1, g.y1), coins = [[o, n], [e, n], [e, s], [o, s]];
        if (map.getSource(id)) map.getSource(id).updateImage({ url, coordinates: coins });
        else { map.addSource(id, { type: 'image', url, coordinates: coins }); map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacite == null ? 1 : opacite, 'raster-fade-duration': 0, 'raster-resampling': net ? 'nearest' : 'linear' } }, 'analyses'); }
      },
      retirer(...ids) { for (const id of ids) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); } },
      /* Le panneau d'un thème a deux tailles. Ouvert : la réponse, ses réglages, sa légende. Réduit : son titre et sa
         phrase de réponse, sur deux lignes au plus, pour laisser la carte grande ; la légende s'y affiche à la demande.
         On passe de l'une à l'autre en touchant le titre ou le chevron ; la taille choisie est gardée d'un thème à l'autre.
         « Calque » retire un instant de la carte ce que le thème y a posé ; la croix ferme le thème. */
      repondre(titre, html) {
        reponse.hidden = false; masque = false;
        reponse.classList.toggle('replie', garde.lire(clePanneau(), '') === 'reduit'); reponse.classList.remove('aveclegende');
        reponse.innerHTML = `<h2><span>${propre(titre)}</span><button class="pli" aria-label="Réduire ou ouvrir le panneau"></button><button class="leg" aria-pressed="false">Légende</button>${app.active && (app.active.plein !== false || app.active.pleinPropre) ? '<button class="grand">⤢ Plein écran</button>' : ''}<button class="oeil" aria-pressed="true">Calque</button><button class="x" aria-label="Fermer le thème">×</button></h2><div class="corps">${html}</div>`;
        reponse.querySelector('h2 .x').onclick = () => app.choisir(null);
        if (reponse.querySelector('h2 .grand')) {
          // Un thème peut avoir son propre plein écran (q.pleinPropre : le drone, dont les commandes s'accrochent au point).
          const a = app.active, ouvrirPlein = () => a.pleinPropre ? a.pleinPropre(app) : app.plein(typeof a.plein === 'function' ? a.plein(app) : {});
          reponse.querySelector('h2 .grand').onclick = () => { if (app.active === a) { auPanneau = null; ouvrirPlein(); } };
          // Sur téléphone, choisir un thème l'ouvre toujours en plein écran ; « ☰ » rend le panneau, et le thème y reste
          // jusqu'à ce qu'on en choisisse un autre. On attend la fin du tour : le thème finit d'abord de brancher son
          // panneau, que le plein écran recopie. Un thème qui refait son panneau en cours de route (une prévision arrivée,
          // un autre point touché) retrouve son plein écran, refait sur le nouveau panneau.
          const deja = !!pleinCourant;
          if (deja || (!bureau() && auPanneau !== a)) setTimeout(() => { if (app.active === a && auPanneau !== a && (a.pleinPropre || (deja ? !!pleinCourant : !pleinCourant))) ouvrirPlein(); }, 0);
        }
        reponse.querySelector('h2 .oeil').onclick = e => { masque = !masque; e.target.setAttribute('aria-pressed', !masque); appliquerMasque(); };
        // Les explications (ce qui est calculé, comment, avec quelle fiabilité) se rangent sous un seul intitulé.
        const corps = reponse.querySelector('.corps'), notes = [...corps.querySelectorAll(':scope > p.petit')], q = app.active;
        if (notes.length || (q && q.aide)) {
          const det = el('details', { class: 'aide' }, '<summary>Ce que montre la carte</summary>' + (q && q.aide ? `<p>${q.aide}</p>` : ''));
          notes.forEach(p => det.append(p)); corps.append(det);
        }
        const plier = () => { const r = reponse.classList.toggle('replie'); garde.ecrire(clePanneau(), r ? 'reduit' : 'ouvert'); if (!r) { reponse.classList.remove('aveclegende'); reponse.querySelector('h2 .leg').setAttribute('aria-pressed', 'false'); } };
        reponse.querySelector('h2 span').onclick = plier; reponse.querySelector('h2 .pli').onclick = plier;
        reponse.querySelector('h2 .leg').onclick = e => { e.target.setAttribute('aria-pressed', reponse.classList.toggle('aveclegende')); };
        reponse.classList.toggle('sanslegende', !corps.querySelector('.legende'));
        return reponse.querySelector('.corps');
      },
      /* Plein écran d'un thème : le panneau est rangé, la carte prend tout l'écran, et le thème s'y règle du pouce.
         Le plein écran ne refait rien : il RECOPIE le panneau, et relaie au panneau chaque toucher (chaque élément recopié
         garde un numéro, data-pi, qui retrouve l'original). Un thème n'a donc rien à écrire pour y figurer :
           en haut   « ☰ nom du thème » (rend le panneau complet), la phrase de réponse (.etat, ou le premier paragraphe)
                     et la légende, qui se touche comme l'originale ;
           en bas    le premier curseur du panneau, devenu un ruban qu'on fait défiler sous un repère fixe ; la date ;
                     les boutons du panneau, rangée par rangée (trois au plus).
         Ce qu'un thème peut préciser, dans q.plein = app => ({ ... }), tout étant facultatif :
           bloc      sélecteur(s) de morceaux du panneau à montrer au-dessus des commandes (une frise, un profil, une liste) ;
           lecture   sélecteur de ce qui dit la valeur du curseur, quand elle n'est pas sur sa ligne ;
           curseur   sélecteur d'un autre curseur que le premier ; false pour n'en montrer aucun ;
           boutons   liste choisie à la place des rangées : sélecteurs de boutons du panneau, ou { texte, action } ;
           ruban, date  réglages faits main ({ min, max, pas, echelle, lire, ecrire, texte, graduations, plages } ; { lire, ecrire }) ;
           consigne  phrase quand le panneau n'en a pas encore.
           rangees   sélecteurs des seules rangées de boutons à reprendre (sinon : les trois premières) ;
         q.pleinPropre(app) : le thème ouvre lui-même son plein écran (drone) ; q.plein = false : il n'en veut pas.
         La phrase est réduite à sa première phrase : le reste se lit dans le panneau.
         Sur téléphone, choisir un thème l'ouvre toujours ainsi. */
      // Un thème à plein écran propre signale ainsi que l'on a demandé son panneau.
      resterAuPanneau() { auPanneau = app.active; },
      plein(o) {
        o = Object.assign({}, o || {});
        if (pleinCourant) pleinCourant.fermer(true); else pleinEtaitLibre = document.body.classList.contains('libre');
        const racine = el('div', { class: 'pilote plein' }), C = () => reponse.querySelector('.corps'), corps = C();
        const un = sel => { const c = C(); return !c || !sel ? null : typeof sel === 'string' ? c.querySelector(sel) : sel; };
        const horsAide = e => e && !e.closest('details');
        // Chaque élément du panneau reçoit un numéro : sa copie le porte aussi, et un toucher sur la copie va à l'original.
        const numeroter = () => { const c = C(); if (c) c.querySelectorAll('*:not([data-pi])').forEach(e => { e.dataset.pi = ++numeroPi; }); };
        numeroter();
        // Le curseur : celui que le thème désigne, sinon le premier du panneau. Il devient un ruban.
        const range = o.ruban || o.curseur === false ? null : (un(o.curseur) || [...(corps ? corps.querySelectorAll('input[type=range]') : [])].find(horsAide) || null);
        const dateEl = o.date ? null : [...(corps ? corps.querySelectorAll('input[type=date]') : [])].find(horsAide) || null;
        if (dateEl) o.date = { lire: () => dateEl.value, ecrire: v => { dateEl.value = v; dateEl.dispatchEvent(new Event('change', { bubbles: true })); } };
        let lectureDe = null;
        if (range) {
          const min = +range.min || 0, max = range.max === '' ? 100 : +range.max, pas = +range.step || 1, k = Math.max(0.4, Math.min(60, 900 / Math.max(1e-9, max - min)));
          const g = pas * Math.max(1, Math.ceil(50 / (k * pas))), grads = []; for (let v = Math.ceil(min / g) * g; v <= max + 1e-9 && grads.length < 400; v += g) grads.push({ v });
          o.ruban = { min, max, pas, echelle: k, graduations: grads, lire: () => +range.value, ecrire: v => { range.value = v; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); } };
          // Où se lit la valeur : ce que le thème désigne, sinon la valeur en gras de la ligne du curseur ou de celle du dessus.
          lectureDe = () => {
            const ligne = range.closest('.ligne'), avant = (ligne || range).previousElementSibling;
            const e = un(o.lecture) || (ligne && ligne.querySelector('.fort')) || (avant && avant.querySelector && avant.querySelector('.fort')) || un('.heure');
            if (!e || !e.textContent.trim()) return '';
            const lab = e.closest('label') || (ligne && !ligne.contains(e) ? null : ligne && ligne.querySelector('label'));
            return (lab && !lab.contains(e) ? lab.textContent.trim() + ' ' : '') + (lab && lab.contains(e) ? lab.textContent : e.textContent).trim();
          };
        }
        const bts = o.boutons || null, blocs = [].concat(o.bloc || []);
        racine.innerHTML = `<div class="p-tete"><button class="p-theme" aria-label="Ouvrir le panneau du thème"><span>☰</span> ${propre(app.active ? app.active.theme : 'Thème')}</button><p class="p-etat"></p><div class="p-legende legende"></div></div>
          <div class="p-bas"><div class="p-bloc"></div>${o.ruban ? '<div class="p-lecture"></div><div class="p-ruban"><div class="p-bande"></div><i></i></div>' : ''}<div class="p-rangs"></div><div class="p-rang p-fixe">${o.date ? '<input type="date" class="p-date" aria-label="Jour">' : ''}${(bts || []).map((x, i) => `<button data-b="${i}"></button>`).join('')}</div></div>`;
        document.body.append(racine); document.body.classList.add('pleintheme'); libre(true);
        const etatEl = racine.querySelector('.p-etat'), legEl = racine.querySelector('.p-legende'), blocEl = racine.querySelector('.p-bloc'), rangsEl = racine.querySelector('.p-rangs');
        const r = o.ruban, k = r ? (r.echelle || 1) : 1, bande = racine.querySelector('.p-bande'), lecture = racine.querySelector('.p-lecture'), ruban = racine.querySelector('.p-ruban');
        const poser = (e, html) => { if (e.innerHTML !== html) e.innerHTML = html; e.hidden = !html.trim(); };
        // La première phrase seulement (un point suivi d'une majuscule : « jeu. 26 » ne coupe pas).
        const courte = e => {
          const cl = e.cloneNode(true), w = document.createTreeWalker(cl, NodeFilter.SHOW_TEXT), trop = []; let n, coupe = false;
          while ((n = w.nextNode())) { if (coupe) { trop.push(n); continue; } const m = /\.\s+(?=[A-ZÀ-Ý«])/.exec(n.nodeValue); if (m) { n.nodeValue = n.nodeValue.slice(0, m.index + 1); coupe = true; } }
          trop.forEach(x => x.remove()); cl.querySelectorAll('*').forEach(x => { if (!x.textContent.trim() && !x.querySelector('img, svg, i')) x.remove(); });
          return cl.innerHTML;
        };
        // Tout ce qui vient du panneau est recopié d'un coup, à chaque fois que le panneau change.
        const copier = () => {
          const c = C(); if (!c) return; numeroter();
          const e = [...c.querySelectorAll('.etat')].find(x => horsAide(x) && x.textContent.trim()) || [...c.querySelectorAll(':scope > p:not(.petit):not(.petit2)')].find(x => x.textContent.trim());
          poser(etatEl, e ? courte(e) : (o.consigne || ''));
          const l = [...c.querySelectorAll('.legende')].find(horsAide); poser(legEl, l ? l.innerHTML : ''); legEl.classList.toggle('active', !!l && l.classList.contains('active'));
          const bs = blocs.map(un).filter(x => x && x.innerHTML.trim()); poser(blocEl, bs.map(x => x.outerHTML).join(''));
          if (!bts) {
            // Les boutons du panneau, rangée par rangée : chaque conteneur de boutons donne une rangée, vidée de ce qui n'est pas bouton.
            const conteneurs = o.rangees ? o.rangees.map(un).filter(Boolean) : []; if (!o.rangees) c.querySelectorAll('button').forEach(b => { const par = b.parentElement; if (!horsAide(b) || par === c || conteneurs.includes(par) || !par.matches('.puces, .vignettes, .ligne') || (l && l.contains(b)) || bs.some(x => x.contains(b))) return; conteneurs.push(par); });
            poser(rangsEl, conteneurs.slice(0, 3).map(par => { const cl = par.cloneNode(true); [...cl.children].forEach(x => { if (x.tagName !== 'BUTTON' && !x.querySelector('button')) x.remove(); }); cl.removeAttribute('style'); cl.classList.remove('ligne'); cl.classList.add('p-rang'); return cl.outerHTML; }).join(''));
          } else racine.querySelectorAll('[data-b]').forEach(b => { const d = bts[+b.dataset.b];
            if (typeof d === 'string') { const sb = un(d); b.hidden = !sb; if (sb) { if (b.textContent !== sb.textContent) b.textContent = sb.textContent; const pr = sb.getAttribute('aria-pressed'); pr == null ? b.removeAttribute('aria-pressed') : b.setAttribute('aria-pressed', pr); b.disabled = sb.disabled; } }
            else { const tx = typeof d.texte === 'function' ? d.texte() : d.texte; if (b.textContent !== tx) b.textContent = tx; if (d.actif) b.setAttribute('aria-pressed', String(!!d.actif())); } });
          if (r) { const v = r.lire(), t = r.texte ? r.texte(v) : lectureDe ? lectureDe() : String(v); lecture.textContent = t; lecture.hidden = !t; bande.style.transform = `translateX(${-(v - r.min) * k}px)`; }
        };
        let prevu = false; const veille = new MutationObserver(() => { if (prevu) return; prevu = true; requestAnimationFrame(() => { prevu = false; if (pleinCourant === api) copier(); }); });
        if (corps) veille.observe(corps, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'class', 'hidden', 'disabled', 'style'] });
        // Un toucher sur une copie (légende, bloc, rangée de boutons) est rejoué sur l'original.
        racine.addEventListener('click', e => { const t = e.target.closest('[data-pi]'); if (!t || !racine.contains(t)) return; const c = C(), src = c && c.querySelector(`[data-pi="${t.dataset.pi}"]`); if (src) { e.preventDefault(); src.click(); } });
        if (r) {
          bande.style.width = (r.max - r.min) * k + 'px';
          bande.innerHTML = '<div class="p-plages"></div>' + (r.graduations || []).map(g => `<span style="left:${(g.v - r.min) * k}px"${g.texte ? '' : ' class="fin"'}>${g.texte || ''}</span>`).join('');
          let dep = null; const fin = () => { dep = null; ruban.classList.remove('tenu'); };
          ruban.addEventListener('pointerdown', e => { e.preventDefault(); try { ruban.setPointerCapture(e.pointerId); } catch (x) { } dep = { x: e.clientX, v: r.lire() }; ruban.classList.add('tenu'); });
          ruban.addEventListener('pointermove', e => { if (!dep) return; const v = Math.max(r.min, Math.min(r.max, +(Math.round((dep.v - (e.clientX - dep.x) / k) / r.pas) * r.pas).toFixed(4))); if (v !== r.lire()) { r.ecrire(v); api.maj(); } });
          ruban.addEventListener('pointerup', fin); ruban.addEventListener('pointercancel', fin);
        }
        const date = racine.querySelector('.p-date'); if (date) date.onchange = () => { if (date.value) { o.date.ecrire(date.value); api.maj(); } };
        racine.querySelectorAll('[data-b]').forEach(b => { b.onclick = () => { const d = bts[+b.dataset.b]; if (typeof d === 'string') { const sb = un(d); if (sb) sb.click(); } else d.action(); api.maj(); }; });
        const touche = e => { if (e.key === 'Escape') { e.stopPropagation(); api.fermer(); } };
        window.addEventListener('keydown', touche, true);
        const api = {
          maj() {
            if (r && r.plages) bande.querySelector('.p-plages').innerHTML = r.plages().map(pl => `<i style="left:${(pl[0] - r.min) * k}px;width:${(pl[1] - pl[0]) * k}px"></i>`).join('');
            if (date) date.value = o.date.lire();
            copier();
          },
          // suite = true : un autre plein écran prend la place aussitôt (le thème a refait son panneau), l'interface reste rangée.
          fermer(suite) {
            if (pleinCourant !== api) return; pleinCourant = null;
            veille.disconnect(); window.removeEventListener('keydown', touche, true); racine.remove();
            if (suite === true) return;
            document.body.classList.remove('pleintheme'); if (!pleinEtaitLibre) libre(false);
          }
        };
        // ☰ rend le panneau complet : le thème y reste jusqu'à ce qu'on en choisisse un autre (ou « Plein écran »).
        racine.querySelector('.p-theme').onclick = () => { auPanneau = app.active; api.fermer(); };
        pleinCourant = api; api.maj();
        return api;
      },
      /* Légende interactive : chaque niveau se masque ou se rétablit d'un toucher. items = [{ cle, couleur, texte }].
         Renvoie l'ensemble des clés masquées ; surChange est appelé à chaque bascule. */
      legende(c, items, surChange, masques) {
        masques = masques || new Set(); const div = c.querySelector('.legende');
        div.classList.add('active');
        div.innerHTML = items.map(it => `<span data-c="${propre(it.cle)}" role="button" class="${masques.has(String(it.cle)) ? 'off' : ''}"><i style="background:${it.couleur}"></i>${propre(it.texte)}</span>`).join('');
        div.onclick = e => { const s = e.target.closest('span[data-c]'); if (!s) return; const k = s.dataset.c; masques.has(k) ? masques.delete(k) : masques.add(k); s.classList.toggle('off', masques.has(k)); surChange(masques); };
        return masques;
      },
      /* Bulle au point touché : un repère sur la carte et une courte réponse, là où l'on a posé le doigt. */
      bulle(ll, html) {
        if (bulleCarte) bulleCarte.remove();
        bulleCarte = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'bulle', maxWidth: '230px', offset: 10 }).setLngLat(ll).setHTML(html).addTo(map);
        const d = { type: 'Feature', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } };
        if (map.getSource('pointbulle')) map.getSource('pointbulle').setData(d);
        else { map.addSource('pointbulle', { type: 'geojson', data: d }); map.addLayer({ id: 'pointbulle', type: 'circle', source: 'pointbulle', paint: { 'circle-radius': 6, 'circle-color': '#b8963e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }); }
      },
      sansBulle() { if (bulleCarte) { bulleCarte.remove(); bulleCarte = null; } if (map.getLayer('pointbulle')) { map.removeLayer('pointbulle'); map.removeSource('pointbulle'); } },
      questions: [], active: null,
      masquer() { appliquerMasque(); },
      /* Un thème seul a sa puce. Les thèmes d'une même famille (q.famille) partagent une puce : elle ouvre le dernier
         thème consulté de la famille, et une rangée de sous-thèmes permet de passer de l'un à l'autre. */
      question(q) {
        app.questions.push(q);
        if (themeVoulu && (q.theme || q.libelle) === themeVoulu) { themeVoulu = null; setTimeout(() => { if (!app.active) { if (!document.body.classList.contains('ecran')) libre(false); app.choisir(q); } }, 900); }
        if (!q.famille) {
          const b = el('button', { 'aria-pressed': 'false', title: q.libelle }, propre(q.theme || q.libelle));   // la puce porte le thème, la réponse porte la question
          q.bouton = b; rang.append(b); b.onclick = () => app.choisir(app.active === q ? null : q); return;
        }
        let f = familles.get(q.famille);
        if (!f) {
          f = { membres: [], dernier: null, bouton: el('button', { 'aria-pressed': 'false' }, propre(q.famille)) };
          familles.set(q.famille, f); rang.append(f.bouton);
          f.bouton.onclick = () => app.choisir(app.active && app.active.famille === q.famille ? null : (f.dernier || f.membres[0]));
        }
        f.membres.push(q); q.bouton = f.bouton;
      },
      async choisir(q) {
        if (pleinCourant) pleinCourant.fermer();
        auPanneau = null;
        if (app.active) { const a = app.active; a.bouton.setAttribute('aria-pressed', 'false'); app.active = null; try { a.fermer && a.fermer(app); } catch (e) { console.error(e); } }
        reponse.hidden = true; reponse.innerHTML = ''; app.occupe(false); app.sansBulle(); if (masque) { masque = false; appliquerMasque(); }
        sous.hidden = true; sous.innerHTML = '';
        if (!q) return;
        app.active = q; q.bouton.setAttribute('aria-pressed', 'true'); q.bouton.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        const f = q.famille && familles.get(q.famille);
        if (f) {
          f.dernier = q;
          if (f.membres.length > 1) {
            sous.hidden = false;
            f.membres.forEach(m => { const b = el('button', { 'aria-pressed': String(m === q), title: m.libelle }, propre(m.theme || m.libelle)); b.onclick = () => { if (app.active !== m) app.choisir(m); }; sous.append(b); });
          }
        }
        try { await q.ouvrir(app); } catch (e) { console.error(e); app.occupe(false); app.repondre(q.libelle, `<p>Impossible de répondre pour l'instant : ${propre(e.message || e)}.</p><p class="petit">Vérifie la connexion, puis touche de nouveau la question.</p>`); }
      },
      // Relance fn (après un court délai) à chaque fin de déplacement tant que la question q est active.
      suivre(q, fn) {
        let t = null; const h = () => { clearTimeout(t); t = setTimeout(() => { if (app.active === q) fn(); }, 350); };
        map.on('moveend', h); q._suivi = h; const f0 = q.fermer;
        if (!q._enveloppe) { q._enveloppe = true; q.fermer = a => { map.off('moveend', q._suivi); clearTimeout(t); f0 && f0(a); }; }
      }
    };
    // Couches du fond de carte, relevées une fois : tout ce qui s'y ajoute ensuite appartient à un thème.
    const couchesFond = new Set(map.getStyle().layers.map(l => l.id).concat(['maposition']));
    let masque = false, bulleCarte = null, pleinCourant = null, pleinEtaitLibre = false, numeroPi = 0, auPanneau = null;
    function appliquerMasque() { for (const l of map.getStyle().layers) if (!couchesFond.has(l.id)) map.setLayoutProperty(l.id, 'visibility', masque ? 'none' : 'visible'); }
    map.on('sourcedata', () => { if (masque) appliquerMasque(); });
    let avale = 0;   // un appui long ne compte pas comme un toucher de la carte
    map.on('click', e => { if (Date.now() < avale) return; if (app.active && app.active.toucher) app.active.toucher(app, e.lngLat); });

    /* Carte libre : un appui long sur la carte range le titre, les boutons et le panneau, pour ne garder que la carte,
       le bouton des fonds et un petit repère ; un nouvel appui long, ou un toucher du repère, fait tout revenir. */
    function libre(oui) {
      document.body.classList.toggle('libre', oui); bRepere.hidden = !oui; listeFonds.hidden = true; caler(true);
      if (oui && !garde.lire('cartes.librevu', false)) { garde.ecrire('cartes.librevu', true); app.occupe(true, (bureau() ? 'Carte seule : touche Échap, ou ☰, pour retrouver les boutons' : 'Carte libre : appui long, ou ☰, pour retrouver les boutons')); setTimeout(() => app.occupe(false), 3200); }
    }
    bRepere.onclick = () => libre(false);
    {
      const zone = map.getCanvasContainer(); let minuterie = null, depart = null;
      const annuler = () => { clearTimeout(minuterie); minuterie = null; };
      const debut = (x, y, doigts) => { annuler(); if (doigts > 1) return; depart = [x, y]; minuterie = setTimeout(() => { minuterie = null; avale = Date.now() + 900; libre(!document.body.classList.contains('libre')); }, 650); };
      const bouge = (x, y) => { if (minuterie && Math.hypot(x - depart[0], y - depart[1]) > 9) annuler(); };
      zone.addEventListener('touchstart', e => debut(e.touches[0].clientX, e.touches[0].clientY, e.touches.length), { passive: true });
      zone.addEventListener('touchmove', e => bouge(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      zone.addEventListener('touchend', annuler); zone.addEventListener('touchcancel', annuler);
      zone.addEventListener('mousedown', e => { if (e.button === 0 && !bureau()) debut(e.clientX, e.clientY, 1); });   // à la souris, sur ordinateur : la touche L ou le menu
      zone.addEventListener('mousemove', e => bouge(e.clientX, e.clientY)); zone.addEventListener('mouseup', annuler);
      zone.addEventListener('contextmenu', e => e.preventDefault());
      map.on('movestart', annuler);
    }

    /* Grand écran : la carte pour elle-même, sur un écran qu'on regarde de loin (salon, réunion, second écran). Il reste
       le titre, et pour le thème ouvert sa question, sa phrase de réponse et sa légende, en grand ; ni boutons ni réglages.
       Bouger la souris fait paraître trois commandes (thème suivant, rotation lente, quitter). Touche F, bouton des
       outils ou menu ; l'adresse suivie de ?ecran ouvre directement ainsi (sans le plein écran, que le navigateur
       n'accorde qu'à un geste). */
    const barreEcran = el('div', { class: 'barreecran', hidden: '' }, '<button class="th">Thème suivant</button><button class="rot" aria-pressed="false">Tourner</button><button class="fin">Quitter</button>');
    document.body.append(barreEcran);
    let tourne = false, pleinDemande = false, tBarre = null;
    const enEcran = () => document.body.classList.contains('ecran');
    const reveler = () => { document.body.classList.add('ecranactif'); clearTimeout(tBarre); tBarre = setTimeout(() => document.body.classList.remove('ecranactif'), 3000); };
    // Rotation lente autour du centre : un tiers de tour en deux minutes, enchaîné ; le moindre geste sur la carte l'arrête.
    const pas = () => { if (tourne) map.easeTo({ bearing: map.getBearing() + 120, duration: 120000, easing: t => t }, { tour: true }); };
    function tourner(oui) { tourne = oui; barreEcran.querySelector('.rot').setAttribute('aria-pressed', oui); if (oui) pas(); else map.stop(); }
    // À chaque fin de mouvement (un tiers de tour achevé, ou un cadrage demandé par un thème), la rotation reprend.
    map.on('moveend', () => { if (tourne) setTimeout(() => { if (tourne && !map.isMoving()) pas(); }, 60); });
    for (const ev of ['mousedown', 'touchstart', 'wheel']) map.getCanvasContainer().addEventListener(ev, () => { if (tourne) tourner(false); }, { passive: true });
    const themeSuivant = () => { const l = app.questions; if (l.length) app.choisir(l[(l.indexOf(app.active) + 1) % l.length]); };
    function ecran(oui, plein) {
      if (oui === enEcran()) return;
      document.body.classList.toggle('ecran', oui); barreEcran.hidden = !oui; menu.hidden = true; listeFonds.hidden = true;
      if (oui) {
        document.body.classList.remove('libre'); bRepere.hidden = true; reveler();
        const racine = document.documentElement;
        if (plein !== false && racine.requestFullscreen && !document.fullscreenElement) { pleinDemande = true; racine.requestFullscreen().catch(() => { pleinDemande = false; }); }
      } else {
        if (tourne) tourner(false); document.body.classList.remove('ecranactif');
        if (document.fullscreenElement && pleinDemande) document.exitFullscreen().catch(() => { });
        pleinDemande = false;
      }
      caler(true);
    }
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && enEcran() && pleinDemande) ecran(false); });
    document.addEventListener('mousemove', () => { if (enEcran()) reveler(); });
    document.addEventListener('touchstart', () => { if (enEcran()) reveler(); }, { passive: true });
    barreEcran.querySelector('.th').onclick = themeSuivant;
    barreEcran.querySelector('.rot').onclick = () => tourner(!tourne);
    barreEcran.querySelector('.fin').onclick = () => ecran(false);
    bEcran.onclick = () => ecran(true);
    /* Clavier : Échap referme ce qui est ouvert (menu, liste des fonds, grand écran, carte seule) ; F grand écran ;
       L carte seule ; / recherche ; en grand écran, T thème suivant et R rotation. Les flèches, + et − restent à la carte. */
    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (!menu.hidden) menu.hidden = true; else if (!listeFonds.hidden) listeFonds.hidden = true; else if (enEcran()) ecran(false); else if (document.body.classList.contains('libre')) libre(false); }
      else if (k === 'f') ecran(!enEcran());
      else if (enEcran()) { if (k === 't') themeSuivant(); else if (k === 'r') tourner(!tourne); }
      else if (k === 'l') libre(!document.body.classList.contains('libre'));
      else if (k === '/') { e.preventDefault(); libre(false); dessinerMenu(); menu.hidden = false; menu.querySelector('.q').focus(); }
    });
    /* D'un appareil à l'autre : l'adresse d'une vue porte le cadrage (centre, zoom, inclinaison, cap), le fond et le thème
       ouvert. Sur ordinateur, un code à scanner l'envoie au téléphone ; sur téléphone, la feuille de partage l'envoie où l'on veut. */
    const lienVue = () => { const u = new URL(location.href); u.search = ''; if (app.active) u.searchParams.set('theme', app.active.theme || app.active.libelle); u.searchParams.set('fond', fond); return u.toString(); };
    async function partager() {
      const url = lienVue();
      if (!bureau() && navigator.share) { try { await navigator.share({ title: cfg.titre, url }); } catch (e) { /* partage annulé */ } return; }
      menu.hidden = false;
      menu.innerHTML = `<div><h3>Cette vue sur le téléphone</h3><p class="sources">Vise ce code avec l'appareil photo du téléphone : la carte s'y ouvre au même endroit, sur le même fond${app.active ? ' et le même thème' : ''}.</p>
        <div class="qr"></div><div class="rech"><input type="text" class="lien" readonly value="${propre(url)}"><button class="copier">Copier</button></div>
        <p style="text-align:right;margin:10px 0 0"><button class="retour">Retour</button> <button class="fermer">Fermer</button></p></div>`;
      menu.querySelector('.retour').onclick = dessinerMenu; menu.querySelector('.fermer').onclick = () => { menu.hidden = true; };
      menu.querySelector('.copier').onclick = async e => { try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copié'; } catch (err) { menu.querySelector('.lien').select(); } };
      try {
        if (!window.qrcode) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
        const q = window.qrcode(0, 'M'); q.addData(url); q.make();
        const boite = menu.querySelector('.qr'); if (boite) boite.innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
      } catch (e) { const boite = menu.querySelector('.qr'); if (boite) boite.innerHTML = '<p class="sources">Le code ne se dessine pas pour l\'instant : copie le lien.</p>'; }
    }

    // --- Menu : signets (des vues), recherche de lieux, sources ---
    const AUTRES = [['tarentaise', 'Tarentaise', 'ski de randonnée aux Chapelles'], ['marees', 'Marées', 'de Bréhat au cap Fréhel'], ['reunion', 'La Réunion', 'la lumière sur le relief'], ['semnoz', 'Champignons', 'autour d\'Annecy'], ['voile', 'Voile', 'de Cerbère à Menton, et la Corse'], ['corse', 'Randos', 'Corse et France, sur le relief']];
    const cleSignets = 'cartes.signets.' + cfg.id;
    // Chaque saut (lieu, recherche, position) garde la vue quittée : le bouton Retour y ramène, un saut à la fois.
    const vues = [];
    const retenir = () => { const c = map.getCenter(); vues.push({ center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }); if (vues.length > 12) vues.shift(); bRetour.hidden = false; };
    bRetour.onclick = () => { const v = vues.pop(); if (v) map.flyTo(Object.assign({ duration: 1200 }, v)); bRetour.hidden = !vues.length; };
    bIci.onclick = () => {
      if (!navigator.geolocation) { app.occupe(true, 'Position indisponible sur cet appareil'); setTimeout(() => app.occupe(false), 2500); return; }
      app.occupe(true, 'Recherche de ta position…');
      navigator.geolocation.getCurrentPosition(p => {
        app.occupe(false); const xy = [p.coords.longitude, p.coords.latitude], d = { type: 'Feature', geometry: { type: 'Point', coordinates: xy } };
        if (map.getSource('maposition')) map.getSource('maposition').setData(d);
        else { map.addSource('maposition', { type: 'geojson', data: d }); map.addLayer({ id: 'maposition', type: 'circle', source: 'maposition', paint: { 'circle-radius': 8, 'circle-color': '#2b7fff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } }); }
        retenir(); map.flyTo({ center: xy, zoom: Math.max(map.getZoom(), 14), duration: 1500 });
      }, () => { app.occupe(true, 'Position refusée ou introuvable'); setTimeout(() => app.occupe(false), 2500); }, { enableHighAccuracy: true, timeout: 12000 });
    };
    // Point « maison » de la carte (un hameau ou un quartier, pas une adresse) : un repère fixe et un bouton pour y revenir.
    if (cfg.maison) {
      map.addSource('maison', { type: 'geojson', data: { type: 'Feature', properties: { nom: cfg.maison.nom }, geometry: { type: 'Point', coordinates: cfg.maison.centre } } });
      map.addLayer({ id: 'maison', type: 'circle', source: 'maison', paint: { 'circle-radius': 7, 'circle-color': '#b8963e', 'circle-stroke-color': '#1a2e4a', 'circle-stroke-width': 2.5 } });
      map.addLayer({ id: 'maison-nom', type: 'symbol', source: 'maison', layout: { 'text-field': ['get', 'nom'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 13, 'text-offset': [0, 1.1], 'text-anchor': 'top' }, paint: { 'text-color': '#1a2e4a', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      bMaison.onclick = () => aller({ centre: cfg.maison.centre, zoom: cfg.maison.zoom || 14.5, pitch: relief3d ? (cfg.pitch3d || 60) : 0, bearing: map.getBearing() });
    }
    function aller(v) { retenir(); if (v.pitch > 5 && !relief3d) mettre3d(true); map.flyTo({ center: v.centre, zoom: v.zoom, pitch: v.pitch || 0, bearing: v.bearing || 0, duration: 1800 }); menu.hidden = true; }
    function dessinerMenu() {
      const persos = garde.lire(cleSignets, []);
      /* Le menu, du plus utile au plus rare : chercher un lieu ; ses propres vues (des géosignets : un cadrage, son fond
         de carte, un nom), que l'on garde et que l'on retrouve ; les vues proposées par la carte, repliées ; deux réglages ;
         comprendre la carte (méthode et sources) ; les autres cartes. */
      menu.innerHTML = `<div><h3>Chercher un sommet, un col, un hameau</h3><div class="rech"><input type="text" class="q" placeholder="Nom du lieu" enterkeyhint="search"><button class="go" aria-label="Chercher">${PICTO.loupe}</button></div><ul class="res"></ul>
        <h3>Mes vues</h3><ul class="lieux miennes"></ul>
        <div class="rech"><input type="text" class="nomvue" placeholder="Nom de la vue affichée" maxlength="40" enterkeyhint="done"><button class="garder">Garder</button></div>
        ${cfg.signets.length ? '<details class="pli"><summary>Vues proposées par la carte</summary><ul class="lieux proposees"></ul></details>' : ''}
        <h3>Affichage</h3><div class="puces"><button class="libre">Carte seule</button><button class="ecran">Grand écran</button><button class="exag" aria-pressed="${exag > exag0}">Relief accentué × 1,8</button></div>
        ${bureau() ? '<details class="pli"><summary>À la souris et au clavier</summary><p class="sources">Glisser déplace la carte, la molette zoome. Clic droit (ou Ctrl) en glissant : incliner et tourner. Flèches, + et − : déplacer et zoomer. <b>/</b> chercher un lieu · <b>L</b> carte seule · <b>F</b> grand écran (puis <b>T</b> thème suivant, <b>R</b> rotation lente) · <b>Échap</b> referme.</p></details>' : ''}
        <h3>Sur un autre appareil</h3><p style="margin:0"><button class="partager">${bureau() ? 'Envoyer cette vue au téléphone' : 'Partager cette vue'}</button></p>
        <h3>Comprendre la carte</h3><p style="margin:0"><button class="methode">Ce que calcule chaque thème, ses limites, les sources</button></p>
        <h3>Autres cartes</h3><ul class="autres">${AUTRES.filter(a => a[0] !== cfg.id).map(a => `<li><button data-u="${cfg.racine}${a[0]}/">${a[1]}<small>${a[2]}</small></button></li>`).join('')}<li><button data-u="${cfg.racine}">Toutes les cartes<small>page d'accueil</small></button></li></ul>
        <p style="text-align:right;margin:10px 0 0"><button class="fermer">Fermer</button></p></div>`;
      const miennes = menu.querySelector('.miennes'), proposees = menu.querySelector('.proposees');
      if (!persos.length) miennes.innerHTML = '<li class="sources">Aucune vue gardée. Cadre la carte comme tu veux la retrouver, donne-lui un nom, puis « Garder ».</li>';
      persos.forEach(s => {
        const li = el('li', { class: 'vue' }), b = el('button', {}, propre(s.nom) + (s.fond && FONDS[s.fond] ? `<small>fond ${propre(FONDS[s.fond].nom)}</small>` : '')), x = el('button', { class: 'oter', 'aria-label': 'Effacer la vue ' + s.nom }, '✕');
        b.onclick = () => { if (s.fond && fonds.includes(s.fond) && s.fond !== fond) mettreFond(s.fond); aller(s); };
        x.onclick = () => { garde.ecrire(cleSignets, garde.lire(cleSignets, []).filter(v => v.nom !== s.nom)); dessinerMenu(); };
        li.append(b, x); miennes.append(li);
      });
      if (proposees) cfg.signets.forEach(s => { const li = el('li'), b = el('button', {}, propre(s.nom) + (s.note ? `<small>${propre(s.note)}</small>` : '')); b.onclick = () => aller(s); li.append(b); proposees.append(li); });
      menu.querySelector('.fermer').onclick = () => { menu.hidden = true; };
      menu.querySelector('.libre').onclick = () => { menu.hidden = true; libre(true); };
      menu.querySelector('.ecran').onclick = () => ecran(true);
      menu.querySelector('.partager').onclick = partager;
      menu.querySelector('.exag').onclick = e => {
        exag = exag > exag0 ? exag0 : exag0 * 1.8; e.target.setAttribute('aria-pressed', exag > exag0);
        if (!relief3d) mettre3d(true); else map.setTerrain({ source: sourceRelief, exaggeration: exag });
      };
      menu.querySelector('.autres').onclick = e => { const b = e.target.closest('button[data-u]'); if (b) location.href = b.dataset.u; };
      // Page « méthode » : tous les thèmes de la carte, ce qu'ils calculent, leurs limites ; puis les sources.
      menu.querySelector('.methode').onclick = () => {
        menu.innerHTML = `<div><h3>Comprendre la carte</h3>${app.questions.map(q => `<h4>${propre(q.theme || q.libelle)} — ${propre(q.libelle)}</h4><p class="sources">${q.aide || 'Ouvre ce thème : son panneau décrit ce qu\'il montre.'}</p>`).join('')}
          <h3>Sources et limites</h3><p class="sources">${cfg.sources || ''}</p><p style="text-align:right;margin:10px 0 0"><button class="retour">Retour</button> <button class="fermer">Fermer</button></p></div>`;
        menu.querySelector('.retour').onclick = dessinerMenu; menu.querySelector('.fermer').onclick = () => { menu.hidden = true; };
      };
      menu.querySelector('.garder').onclick = () => {
        const nom = menu.querySelector('.nomvue').value.trim(); if (!nom) return;
        const c = map.getCenter(), l = garde.lire(cleSignets, []).filter(x => x.nom !== nom), fondVue = fond;
        l.push({ nom, centre: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()), fond: fondVue });
        garde.ecrire(cleSignets, l); dessinerMenu();
      };
      const chercher = async () => {
        const q = menu.querySelector('.q').value.trim(), res = menu.querySelector('.res'); if (q.length < 2) return;
        res.innerHTML = '<li class="sources">Recherche…</li>';
        try {
          const c = cfg.recherche || { centre: cfg.centre, rayonKm: 60 };
          const r = await fetch(`${GEOPF}/geocodage/search?index=poi&limit=15&q=${encodeURIComponent(q)}&lon=${c.centre[0]}&lat=${c.centre[1]}`);
          const j = await r.json(); res.innerHTML = '';
          const vus = new Set();
          for (const f of j.features || []) {
            const p = f.properties, xy = f.geometry.coordinates, km = distKm(xy, c.centre);
            const cle = (p.toponym || p.name) + '|' + xy.map(v => v.toFixed(3)); if (km > c.rayonKm || vus.has(cle)) continue; vus.add(cle);
            const li = el('li'), b = el('button', {}, `${propre(p.toponym || p.name)}<small>${propre((p.category || [])[0] || '')} · ${propre((p.city || [])[0] || '')} · ${km.toFixed(0)} km</small>`);
            b.onclick = () => aller({ centre: xy, zoom: 14, pitch: relief3d ? 60 : 0, bearing: map.getBearing() });
            li.append(b); res.append(li);
          }
          if (!res.children.length) res.innerHTML = `<li class="sources">Rien trouvé à moins de ${c.rayonKm} km.</li>`;
        } catch (e) { res.innerHTML = '<li class="sources">Recherche indisponible.</li>'; }
      };
      menu.querySelector('.go').onclick = chercher;
      menu.querySelector('.q').onkeydown = e => { if (e.key === 'Enter') chercher(); };
    }
    bTitre.onclick = () => { dessinerMenu(); menu.hidden = false; };
    menu.onclick = e => { if (e.target === menu) menu.hidden = true; };
    if (cfg.pitch > 5) { relief3d = true; map.setTerrain({ source: 'relief', exaggeration: exag }); majBatiments(); b3d.setAttribute('aria-pressed', 'true'); }
    /* À l'ouverture, la carte d'abord : carte libre (le bouton des fonds, et ☰ pour tout retrouver), sauf si la carte demande
       l'inverse (cfg.ouverture = 'complete'). Les thèmes restent à un toucher. */
    if (cfg.ouverture !== 'complete' && !bureau()) libre(true);   // sur ordinateur la place ne manque pas : tout est là dès l'ouverture
    caler(false);
    // Fond d'ouverture : celui de la carte, sinon le Plan IGN HD. Le dernier fond choisi n'est pas repris.
    mettreFond(fonds.includes(params.get('fond')) ? params.get('fond') : fonds.includes(cfg.fond) ? cfg.fond : 'plan');
    if (params.has('ecran')) ecran(true, false);
    window.carteApp = app;
    return app;
  }

  /* Mise à jour. L'appli posée sur l'écran d'accueil garde la page et ses scripts en mémoire : une nouveauté pouvait
     mettre longtemps à y arriver. À l'ouverture et à chaque retour au premier plan, on compare l'empreinte des fichiers
     de la page (celle de la copie en mémoire, celle du serveur) ; s'ils diffèrent, un bouton propose de recharger, après
     avoir rafraîchi la mémoire du navigateur. Rien ne se recharge tout seul : un tracé en cours n'est pas perdu. */
  (function () {
    const fichiers = () => [location.pathname, ...[...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(n => n.src || n.href).filter(u => u.startsWith(location.origin))];
    const empreinte = r => r.headers.get('etag') || r.headers.get('last-modified') || '';
    const vues = {};   // empreintes des copies en cours d'usage, relevées une fois
    let bouton = null, enCours = false;
    async function verifier() {
      if (enCours || bouton) return; enCours = true;
      try {
        for (const u of fichiers()) {
          if (!(u in vues)) { try { vues[u] = empreinte(await fetch(u, { method: 'HEAD', cache: 'force-cache' })); } catch (e) { vues[u] = ''; } }
          const r = await fetch(u, { method: 'HEAD', cache: 'no-store' }); if (!r.ok) continue;
          const e = empreinte(r); if (e && vues[u] && e !== vues[u]) { proposer(); break; }
        }
      } catch (e) { /* hors ligne : on garde la page */ }
      enCours = false;
    }
    function proposer() {
      bouton = el('button', { class: 'maj' }, 'Nouvelle version · recharger');
      bouton.onclick = async () => {
        bouton.textContent = 'Mise à jour…';
        try { await Promise.all(fichiers().map(u => fetch(u, { cache: 'reload' }))); } catch (e) { /* on recharge quand même */ }
        location.reload();
      };
      document.body.append(bouton);
    }
    setTimeout(verifier, 2500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifier(); });
  })();

  window.Socle = { RGEALTI, altitudeMonde, planMer, creer, grille, indice, pentes, soleil, eclaire, ombres, peindre, meteo, versMerc, versGeo, distKm, wmts, GEOPF };
})();
