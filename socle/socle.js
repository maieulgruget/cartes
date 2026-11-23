/* Socle commun des cartes.
   - Carte MapLibre plein écran : fond gris (Plan IGN vectoriel), Plan IGN HD et photo aérienne en bascule ; bâtiments en volume en vue 3D rapprochée.
   - Relief : MNT LiDAR HD de l'IGN, lu à la volée (WMS raster, flottants 32 bits) et converti en tuiles de relief ;
     repli sur les tuiles Terrarium là où l'IGN n'a pas de valeur (hors de France).
   - Interface : une rangée de questions, une réponse à la fois ; signets (des vues), recherche de lieux, 2D/3D.
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
  async function tuileRelief(z, x, y) {
    const t = 2 * R / (1 << z), x0 = -R + x * t, y1 = R - y * t;
    let alt = null;
    try { alt = await lireBil(MNT, x0, y1 - t, x0 + t, y1, 256, 256); } catch (e) { alt = null; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'), im = ctx.createImageData(256, 256), d = im.data;
    let manque = !alt;
    if (alt) for (let k = 0; k < 65536; k++) if (absent(alt[k])) { manque = true; break; }
    let repli = null;
    if (manque) { try { repli = await tuileTerrarium(z, x, y); } catch (e) { repli = null; } }
    for (let k = 0; k < 65536; k++) {
      if (alt && !absent(alt[k])) {
        const v = alt[k] + 32768; d[4 * k] = Math.floor(v / 256); d[4 * k + 1] = Math.floor(v) % 256; d[4 * k + 2] = Math.floor((v - Math.floor(v)) * 256);
      } else if (repli) { d[4 * k] = repli[4 * k]; d[4 * k + 1] = repli[4 * k + 1]; d[4 * k + 2] = repli[4 * k + 2]; }
      else { d[4 * k] = 128; d[4 * k + 1] = 0; d[4 * k + 2] = 0; }
      d[4 * k + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return blob.arrayBuffer();
  }
  /* Plan IGN HD avec repli : le Plan HD ne couvre pas encore tout le territoire (centre de la Bretagne, mer).
     Là où il n'a rien, sa tuile manque, ou revient blanche en tout ou partie. On regarde donc la tuile par carrés de
     16 pixels : les carrés entièrement blancs sont repris du Plan IGN classique, et à défaut peints en bleu mer. */
  const MER_PLAN = '#aadaf5';
  async function imageDe(url) { try { const r = await fetch(url); return r.ok ? await createImageBitmap(await r.blob()) : null; } catch (e) { return null; } }
  async function tuilePlan(z, x, y) {
    let brut = null, hd = null;
    try { const r = await fetch(`${GEOPF}/tms/1.0.0/IGNF_PLAN-IGN-HD/${z}/${x}/${y}.jpeg`); if (r.ok) { brut = await r.arrayBuffer(); if (brut.byteLength > 2500) hd = await createImageBitmap(new Blob([brut], { type: 'image/jpeg' })); } } catch (e) { hd = null; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d', { willReadFrequently: true }), vides = [];
    if (hd) {
      ctx.drawImage(hd, 0, 0, 256, 256);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) {
        let blanc = true;
        for (let yy = by * 16; yy < by * 16 + 16 && blanc; yy += 3) for (let xx = bx * 16; xx < bx * 16 + 16; xx += 3) { const k = 4 * (yy * 256 + xx); if (d[k] < 250 || d[k + 1] < 250 || d[k + 2] < 250) { blanc = false; break; } }
        if (blanc) vides.push([bx * 16, by * 16]);
      }
      if (!vides.length) return brut;
    }
    const v2 = await imageDe(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png').replace('{z}', z).replace('{y}', y).replace('{x}', x));
    if (!hd) { if (v2) ctx.drawImage(v2, 0, 0, 256, 256); else { ctx.fillStyle = MER_PLAN; ctx.fillRect(0, 0, 256, 256); } }
    else {
      // Fond de repli sur toute la tuile, puis le Plan HD par-dessus, sauf ses blancs : carrés vides en entier,
      // et pixel par pixel dans les carrés voisins d'un vide (la lisière de la couverture).
      const hdPx = ctx.getImageData(0, 0, 256, 256), d = hdPx.data, vide = new Uint8Array(256);
      for (const [bx, by] of vides) vide[(by / 16) * 16 + bx / 16] = 1;
      if (v2) ctx.drawImage(v2, 0, 0, 256, 256); else { ctx.fillStyle = MER_PLAN; ctx.fillRect(0, 0, 256, 256); }
      const fond = ctx.getImageData(0, 0, 256, 256).data;
      for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) {
        let lisiere = false;
        for (let dy = -1; dy <= 1 && !lisiere; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = by + dy, xx = bx + dx; if (yy >= 0 && xx >= 0 && yy < 16 && xx < 16 && vide[yy * 16 + xx]) { lisiere = true; break; } }
        if (!vide[by * 16 + bx] && !lisiere) continue;
        for (let yy = by * 16; yy < by * 16 + 16; yy++) for (let xx = bx * 16; xx < bx * 16 + 16; xx++) {
          const k = 4 * (yy * 256 + xx);
          if (vide[by * 16 + bx] || (d[k] >= 244 && d[k + 1] >= 244 && d[k + 2] >= 244)) { d[k] = fond[k]; d[k + 1] = fond[k + 1]; d[k + 2] = fond[k + 2]; }
        }
      }
      ctx.putImageData(hdPx, 0, 0);
    }
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
    return blob.arrayBuffer();
  }
  function brancherRelief() {
    if (brancherRelief.fait) return; brancherRelief.fait = true;
    maplibregl.addProtocol('ignplan', async (params) => {
      const [z, x, y] = params.url.replace('ignplan://', '').split('/').map(Number);
      return { data: await tuilePlan(z, x, y) };
    });
    maplibregl.addProtocol('ignalti', async (params) => {
      const cle = params.url;
      if (!cacheTuiles.has(cle)) {
        const [z, x, y] = cle.replace('ignalti://', '').split('/').map(Number);
        cacheTuiles.set(cle, tuileRelief(z, x, y));
        if (cacheTuiles.size > 400) cacheTuiles.delete(cacheTuiles.keys().next().value);
      }
      const data = await cacheTuiles.get(cle);
      return { data: data.slice(0) };
    });
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
    // Les étiquettes passent toutes au-dessus : les analyses se glissent entre les surfaces et les noms.
    style.layers = [...style.layers.filter(l => l.type !== 'symbol'), ...style.layers.filter(l => l.type === 'symbol')];
    const premierTexte = style.layers.findIndex(l => l.type === 'symbol');
    Object.assign(style.sources, {
      ortho: { type: 'raster', tiles: [wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')], tileSize: 256, maxzoom: 19, attribution: '© IGN' },
      plan: { type: 'raster', tiles: ['ignplan://{z}/{x}/{y}'], tileSize: 256, minzoom: 6, maxzoom: 18, attribution: 'Plan IGN © IGN' },
      ombrage: { type: 'raster', tiles: [wmts('IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png')], tileSize: 256, maxzoom: 18, attribution: 'LiDAR HD © IGN' },
      bdtopo: { type: 'vector', tiles: [`${GEOPF}/tms/1.0.0/BDTOPO/{z}/{x}/{y}.pbf`], minzoom: 15, maxzoom: 18, attribution: 'BD TOPO © IGN' },
      relief: { type: 'raster-dem', tiles: ['ignalti://{z}/{x}/{y}'], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Relief : LiDAR HD © IGN' },
      estompe: { type: 'raster-dem', tiles: ['ignalti://{z}/{x}/{y}'], tileSize: 256, maxzoom: 15, encoding: 'terrarium' }
    });
    style.layers.splice(premierTexte, 0,
      { id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: 'none' } },
      { id: 'plan', type: 'raster', source: 'plan', layout: { visibility: 'none' } },
      { id: 'ombrage', type: 'raster', source: 'ombrage', layout: { visibility: 'none' } },
      { id: 'estompe', type: 'hillshade', source: 'estompe', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#2b3545', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#55617a' } },
      { id: 'analyses', type: 'background', paint: { 'background-opacity': 0 } });   // repère : les analyses se glissent sous les étiquettes
    const textes = style.layers.filter(l => l.type === 'symbol').map(l => l.id);
    style.layers.splice(style.layers.findIndex(l => l.id === 'analyses') + 1, 0,
      { id: 'batiments3d', type: 'fill-extrusion', source: 'bdtopo', 'source-layer': 'batiment', minzoom: 15, layout: { visibility: 'none' },
        paint: { 'fill-extrusion-height': ['coalesce', ['get', 'hauteur'], 4], 'fill-extrusion-opacity': 0.8, 'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-color': ['match', ['get', 'usage_1'], 'Résidentiel', '#e8dcc2', 'Agricole', '#c9b458', 'Commercial et services', '#7aa6c2', 'Industriel', '#9a8fb5', 'Religieux', '#c97b63', 'Sportif', '#7fb069', 'Annexe', '#cfcfcf', '#dcdcdc'] } });

    document.body.append(el('div', { id: 'carte' }));
    const map = new maplibregl.Map({
      container: 'carte', style, center: cfg.centre, zoom: cfg.zoom, pitch: cfg.pitch || 0, bearing: cfg.bearing || 0,
      maxPitch: 78, maxBounds: cfg.limites || undefined, attributionControl: false, hash: true
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.touchZoomRotate.enableRotation(); map.touchPitch.enable();
    await new Promise(res => map.once('load', res));
    const exag = cfg.exageration || 1;
    let relief3d = false;
    // Les bâtiments en volume ne s'affichent que sur le fond gris, en vue 3D : ailleurs ils cachent plus qu'ils n'aident.
    const majBatiments = () => map.setLayoutProperty('batiments3d', 'visibility', relief3d && fond === 'gris' ? 'visible' : 'none');
    const mettre3d = oui => { relief3d = oui; map.setTerrain(oui ? { source: 'relief', exaggeration: exag } : null); majBatiments(); map.easeTo({ pitch: oui ? (cfg.pitch3d || 60) : 0, duration: 700 }); b3d.setAttribute('aria-pressed', oui); };

    // --- Interface ---
    const bTitre = el('button', { class: 'titre', 'aria-label': 'Lieux, recherche et sources' }, `<b>${propre(cfg.titre)}</b><span>${propre(cfg.sousTitre || '')} · lieux ▾</span>`);
    const outils = el('div', { class: 'outils' });
    const bFond = el('button', {}, 'Gris'), b3d = el('button', { 'aria-pressed': 'false' }, '3D'), bRech = el('button', { 'aria-label': 'Chercher un lieu' }, 'Chercher'),
      bIci = el('button', { 'aria-label': 'Aller à ma position' }, 'Ici'), bRetour = el('button', { 'aria-label': 'Revenir à la vue précédente', hidden: '' }, '↩ Retour'), bNord = el('button', { 'aria-label': 'Remettre le nord en haut' }, 'Nord ↑'),
      bMaison = el('button', { 'aria-label': 'Aller à la maison' }, 'Maison');
    outils.append(bFond, b3d, bNord, bRech, bIci, bMaison, bRetour); bMaison.hidden = !cfg.maison;
    const bas = el('div', { class: 'bas' }), reponse = el('div', { class: 'reponse', hidden: '' }), rang = el('div', { class: 'questions' });
    bas.append(reponse, rang);
    const attente = el('div', { class: 'attente', hidden: '' }, 'Calcul…');
    const menu = el('div', { class: 'menu', hidden: '' });
    document.body.append(bTitre, outils, bas, attente, menu);

    const fonds = ['plan', 'gris', 'ortho', 'ombrage'], noms = { gris: 'Gris', plan: 'Plan HD', ortho: 'Photo', ombrage: 'Relief' };
    let fond = 'gris';
    function mettreFond(f) {
      fond = f; bFond.textContent = noms[f];
      map.setLayoutProperty('ortho', 'visibility', f === 'ortho' ? 'visible' : 'none');
      map.setLayoutProperty('plan', 'visibility', f === 'plan' ? 'visible' : 'none');
      map.setLayoutProperty('ombrage', 'visibility', f === 'ombrage' ? 'visible' : 'none');
      map.setPaintProperty('estompe', 'hillshade-exaggeration', f === 'gris' ? 0.4 : f === 'ortho' ? 0.12 : 0);
      majBatiments();
    }
    bFond.onclick = () => { mettreFond(fonds[(fonds.indexOf(fond) + 1) % fonds.length]); garde.ecrire('cartes.fond', fond); };
    b3d.onclick = () => mettre3d(!relief3d);
    bNord.onclick = () => map.easeTo({ bearing: 0, duration: 600 });

    const app = {
      map, cfg, grille, indice, pentes, soleil, eclaire, ombres, peindre, meteo, propre, versGeo, versMerc, distKm,
      get fond() { return fond; }, mettreFond, mettre3d,
      occupe(oui, texte) { attente.textContent = texte || 'Calcul…'; attente.hidden = !oui; },
      // Emprise de la vue courante, élargie d'une marge (fraction), bornée pour rester raisonnable en vue inclinée.
      emprise(marge) {
        const b = map.getBounds(), c = map.getCenter(); let o = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
        const max = 360 / Math.pow(2, map.getZoom()) * 1.6;   // largeur maximale en degrés
        o = Math.max(o, c.lng - max); e = Math.min(e, c.lng + max); s = Math.max(s, c.lat - max * 0.8); n = Math.min(n, c.lat + max * 0.8);
        const m = marge || 0, dx = (e - o) * m, dy = (n - s) * m;
        return [o - dx, s - dy, e + dx, n + dy];
      },
      // Pose (ou remplace) une image géoréférencée sur la grille g, sous les étiquettes.
      poser(id, g, url, opacite) {
        const [o, s] = versGeo(g.x0, g.y0), [e, n] = versGeo(g.x1, g.y1), coins = [[o, n], [e, n], [e, s], [o, s]];
        if (map.getSource(id)) map.getSource(id).updateImage({ url, coordinates: coins });
        else { map.addSource(id, { type: 'image', url, coordinates: coins }); map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacite == null ? 1 : opacite, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'analyses'); }
      },
      retirer(...ids) { for (const id of ids) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); } },
      repondre(titre, html) {
        reponse.hidden = false; reponse.classList.remove('replie'); masque = false;
        reponse.innerHTML = `<h2><span>${propre(titre)}</span><button class="oeil" aria-pressed="false">Masquer</button><button class="x" aria-label="Fermer">×</button></h2><div class="corps">${html}</div>`;
        reponse.querySelector('h2 .x').onclick = () => app.choisir(null);
        // Masquer : retire un instant ce que le thème a posé sur la carte, pour voir le fond et le relief dessous.
        reponse.querySelector('h2 .oeil').onclick = e => { masque = !masque; e.target.textContent = masque ? 'Montrer' : 'Masquer'; e.target.setAttribute('aria-pressed', masque); appliquerMasque(); };
        // Les explications (ce qui est calculé, comment, avec quelle fiabilité) se rangent sous un seul intitulé.
        const corps = reponse.querySelector('.corps'), notes = [...corps.querySelectorAll(':scope > p.petit')], q = app.active;
        if (notes.length || (q && q.aide)) {
          const det = el('details', { class: 'aide' }, '<summary>Ce que montre la carte</summary>' + (q && q.aide ? `<p>${q.aide}</p>` : ''));
          notes.forEach(p => det.append(p)); corps.append(det);
        }
        reponse.querySelector('h2 span').onclick = () => reponse.classList.toggle('replie');
        return reponse.querySelector('.corps');
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
      question(q) {
        const b = el('button', { 'aria-pressed': 'false', title: q.libelle }, propre(q.theme || q.libelle));   // la puce porte le thème, la réponse porte la question
        q.bouton = b; rang.append(b); app.questions.push(q);
        b.onclick = () => app.choisir(app.active === q ? null : q);
      },
      async choisir(q) {
        if (app.active) { const a = app.active; a.bouton.setAttribute('aria-pressed', 'false'); app.active = null; try { a.fermer && a.fermer(app); } catch (e) { console.error(e); } }
        reponse.hidden = true; reponse.innerHTML = ''; app.occupe(false); app.sansBulle(); if (masque) { masque = false; appliquerMasque(); }
        if (!q) return;
        app.active = q; q.bouton.setAttribute('aria-pressed', 'true'); q.bouton.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
    let masque = false, bulleCarte = null;
    function appliquerMasque() { for (const l of map.getStyle().layers) if (!couchesFond.has(l.id)) map.setLayoutProperty(l.id, 'visibility', masque ? 'none' : 'visible'); }
    map.on('sourcedata', () => { if (masque) appliquerMasque(); });
    map.on('click', e => { if (app.active && app.active.toucher) app.active.toucher(app, e.lngLat); });

    // --- Menu : signets (des vues), recherche de lieux, sources ---
    const AUTRES = [['tarentaise', 'Tarentaise', 'ski de randonnée aux Chapelles'], ['marees', 'Marées', 'de Bréhat au cap Fréhel'], ['reunion', 'La Réunion', 'la lumière sur le relief'], ['semnoz', 'Champignons', 'autour d\'Annecy']];
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
      menu.innerHTML = `<div><h3>Lieux</h3><ul class="lieux"></ul>
        <h3>Garder la vue actuelle</h3><div class="rech"><input type="text" class="nomvue" placeholder="Nom de la vue" maxlength="40"><button class="garder">Garder</button></div>
        <h3>Chercher un sommet, un col, un hameau</h3><div class="rech"><input type="text" class="q" placeholder="Nom du lieu" enterkeyhint="search"><button class="go">Chercher</button></div><ul class="res"></ul>
        <h3>Comprendre la carte</h3><p style="margin:0"><button class="methode">Ce que calcule chaque thème, et avec quelle fiabilité</button></p>
        <h3>Autres cartes</h3><ul class="autres">${AUTRES.filter(a => a[0] !== cfg.id).map(a => `<li><button data-u="${cfg.racine}${a[0]}/">${a[1]}<small>${a[2]}</small></button></li>`).join('')}<li><button data-u="${cfg.racine}">Les quatre cartes<small>page d'accueil</small></button></li></ul>
        <h3>Sources et limites</h3><p class="sources">${cfg.sources || ''}</p>
        <p style="text-align:right;margin:10px 0 0"><button class="fermer">Fermer</button></p></div>`;
      const ul = menu.querySelector('.lieux');
      [...cfg.signets.map(s => [s, false]), ...persos.map(s => [s, true])].forEach(([s, perso], i) => {
        const li = el('li'), b = el('button', {}, propre(s.nom) + (s.note ? `<small>${propre(s.note)}</small>` : '') + (perso ? '<small>vue gardée · toucher longuement pour l\'effacer</small>' : ''));
        b.onclick = () => aller(s);
        if (perso) { let t; const eff = () => { garde.ecrire(cleSignets, garde.lire(cleSignets, []).filter(x => x.nom !== s.nom)); dessinerMenu(); }; b.oncontextmenu = ev => { ev.preventDefault(); eff(); }; b.ontouchstart = () => { t = setTimeout(eff, 900); }; b.ontouchend = b.ontouchmove = () => clearTimeout(t); }
        li.append(b); ul.append(li);
      });
      menu.querySelector('.fermer').onclick = () => { menu.hidden = true; };
      menu.querySelector('.autres').onclick = e => { const b = e.target.closest('button[data-u]'); if (b) location.href = b.dataset.u; };
      // Page « méthode » : tous les thèmes de la carte, ce qu'ils calculent, leurs limites ; puis les sources.
      menu.querySelector('.methode').onclick = () => {
        menu.innerHTML = `<div><h3>Comprendre la carte</h3>${app.questions.map(q => `<h4>${propre(q.theme || q.libelle)} — ${propre(q.libelle)}</h4><p class="sources">${q.aide || 'Ouvre ce thème : son panneau décrit ce qu\'il montre.'}</p>`).join('')}
          <h3>Sources et limites</h3><p class="sources">${cfg.sources || ''}</p><p style="text-align:right;margin:10px 0 0"><button class="retour">Retour</button> <button class="fermer">Fermer</button></p></div>`;
        menu.querySelector('.retour').onclick = dessinerMenu; menu.querySelector('.fermer').onclick = () => { menu.hidden = true; };
      };
      menu.querySelector('.garder').onclick = () => {
        const nom = menu.querySelector('.nomvue').value.trim(); if (!nom) return;
        const c = map.getCenter(), l = garde.lire(cleSignets, []).filter(x => x.nom !== nom);
        l.push({ nom, centre: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()) });
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
    bRech.onclick = () => { dessinerMenu(); menu.hidden = false; const q = menu.querySelector('.q'); q.scrollIntoView({ block: 'center' }); q.focus(); };
    menu.onclick = e => { if (e.target === menu) menu.hidden = true; };
    if (cfg.pitch > 5) { relief3d = true; map.setTerrain({ source: 'relief', exaggeration: exag }); majBatiments(); b3d.setAttribute('aria-pressed', 'true'); }
    // Fond d'ouverture : le dernier choisi sur cet appareil, sinon celui de la carte, sinon le Plan IGN HD.
    const fondDepart = garde.lire('cartes.fond', null) || cfg.fond || 'plan';
    if (fonds.includes(fondDepart) && fondDepart !== 'gris') mettreFond(fondDepart);
    window.carteApp = app;
    return app;
  }

  window.Socle = { RGEALTI, creer, grille, indice, pentes, soleil, eclaire, ombres, peindre, meteo, versMerc, versGeo, distKm, wmts, GEOPF };
})();
