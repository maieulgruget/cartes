/* Plongée : un secteur de côte vu par-dessous. Le relief terre-mer préparé par relais/plongee_fonds.py (Litto3D au
   mètre, HOMONIM au large, RGE ALTI à terre) devient le relief 3D de la carte ; le fond « vidé » (sédiment, ombrage)
   est posé dessus, et l'eau est une teinte calculée par la carte graphique selon l'épaisseur d'eau : baisser la mer ne
   recharge rien, on change seulement la règle de couleur.
   Le module est transposable : il ne connaît que le dossier de données qu'on lui donne (relief/, fond/, fonds.json,
   habitats.json, herbiers.json facultatif), produit pour n'importe quelle emprise par le même script.

   Socle.plongee.installer(app, { donnees: '../plongee/', fuseau, centreMeteo: [lon, lat] }) → { themes… } */
(function () {
  'use strict';
  const S = window.Socle, RAD = Math.PI / 180;
  const fr = (v, n) => (n == null ? String(v) : v.toFixed(n)).replace('.', ',');
  const m = p => p < 10 ? fr(Math.round(p * 10) / 10) + ' m' : Math.round(p) + ' m';
  const el = (balise, attrs, html) => { const n = document.createElement(balise); if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]); if (html != null) n.innerHTML = html; return n; };
  const propre = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const garde = { lire(c, d) { try { const v = JSON.parse(localStorage.getItem(c)); return v == null ? d : v; } catch (e) { return d; } }, ecrire(c, v) { try { localStorage.setItem(c, JSON.stringify(v)); } catch (e) { } } };
  const R = 20037508.342789244;
  const tuileDe = (lon, lat, z) => { const n = 1 << z; return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * n]; };
  const casse = s => String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m0, a, b) => a + b.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, x => x.toUpperCase());
  const distM = (a, b) => { const dx = (a[0] - b[0]) * Math.cos((a[1] + b[1]) / 2 * RAD), dy = a[1] - b[1]; return Math.hypot(dx, dy) * 111200; };

  // ---------- Relief : tuiles du secteur, relief mondial autour ----------
  let D = null;   // données du secteur
  const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
  function dansIndex(z, x, y) { const t = D.index.tuiles[z]; return !!t && x >= t[0] && x <= t[1] && y >= t[2] && y <= t[3]; }
  /* Hors du secteur : le relief mondial (tuiles « terrarium » de 256 points). Une seule tuile mondiale, au zoom 12 au
     plus, sert toutes les tuiles de la carte qu'elle recouvre : elle est décodée une fois, puis relue en douceur pour
     chaque tuile de 512 points demandée. Loin du secteur le détail n'apporte rien, et l'horizon d'une vue inclinée ne
     coûte plus qu'une poignée de requêtes. */
  const cacheMonde = new Map();
  function mondeDecode(z, x, y) {
    const cle = z + '/' + x + '/' + y;
    if (!cacheMonde.has(cle)) {
      cacheMonde.set(cle, (async () => {
        const r = await fetch(`${TERRARIUM}${z}/${x}/${y}.png`); if (!r.ok) return null;
        const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(await createImageBitmap(await r.blob()), 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data, a = new Float32Array(65536);
        for (let k = 0; k < 65536; k++) a[k] = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768;
        return a;
      })().catch(() => null));
      if (cacheMonde.size > 24) cacheMonde.delete(cacheMonde.keys().next().value);
    }
    return cacheMonde.get(cle);
  }
  async function monde512(z, x, y) {
    const zz = Math.min(z, 12), f = 1 << (z - zz), a = await mondeDecode(zz, Math.floor(x / f), Math.floor(y / f));
    const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d'), im = ctx.createImageData(512, 512), d = im.data;
    const ox = (x % f) * 256 / f, oy = (y % f) * 256 / f, pas = 256 / f / 512;
    for (let j = 0; j < 512; j++) {
      const sy = Math.min(254.999, Math.max(0, oy + (j + 0.5) * pas - 0.5)), j0 = sy | 0, v = sy - j0;
      for (let i = 0; i < 512; i++) {
        const sx = Math.min(254.999, Math.max(0, ox + (i + 0.5) * pas - 0.5)), i0 = sx | 0, u = sx - i0, k = j0 * 256 + i0;
        const alt = a ? (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + 256] * (1 - u) + a[k + 257] * u) * v : 0;
        const t = alt + 32768, q = 4 * (j * 512 + i); d[q] = Math.floor(t / 256); d[q + 1] = Math.floor(t) % 256; d[q + 2] = Math.floor((t - Math.floor(t)) * 256); d[q + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer();
  }
  // Le relief 3D et la teinte de l'eau demandent les mêmes tuiles : chacune n'est préparée qu'une fois.
  const cacheRelief = new Map();
  function brancher() {
    if (brancher.fait) return; brancher.fait = true;
    maplibregl.addProtocol('plongee', async (params) => {
      const cle = params.url;
      if (!cacheRelief.has(cle)) {
        const [z, x, y] = cle.replace('plongee://', '').split('/').map(Number);
        cacheRelief.set(cle, (async () => {
          if (dansIndex(z, x, y)) { const r = await fetch(`${D.racine}relief/${z}/${x}/${y}.png`); if (r.ok) return r.arrayBuffer(); }
          return monde512(z, x, y);
        })());
        if (cacheRelief.size > 120) cacheRelief.delete(cacheRelief.keys().next().value);
      }
      return { data: (await cacheRelief.get(cle)).slice(0) };
    });
  }
  // Altitude d'un point (m, négative sous l'eau), lue dans les tuiles du secteur au zoom 14 (3,5 m). NaN hors secteur.
  const cacheAlti = new Map();
  function tuileAlti(x, y) {
    const cle = x + '/' + y;
    if (!cacheAlti.has(cle)) {
      cacheAlti.set(cle, (async () => {
        if (!dansIndex(14, x, y)) return null;
        const r = await fetch(`${D.racine}relief/14/${x}/${y}.png`); if (!r.ok) return null;
        const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(await createImageBitmap(await r.blob()), 0, 0);
        const d = ctx.getImageData(0, 0, 512, 512).data, a = new Float32Array(512 * 512);
        for (let k = 0; k < a.length; k++) a[k] = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768;
        return a;
      })().catch(() => null));
      if (cacheAlti.size > 30) cacheAlti.delete(cacheAlti.keys().next().value);
    }
    return cacheAlti.get(cle);
  }
  async function altitude(lon, lat) {
    const [fx, fy] = tuileDe(lon, lat, 14), x = Math.floor(fx), y = Math.floor(fy), a = await tuileAlti(x, y); if (!a) return NaN;
    const px = Math.min(510.999, Math.max(0, (fx - x) * 512 - 0.5)), py = Math.min(510.999, Math.max(0, (fy - y) * 512 - 0.5)), i = px | 0, j = py | 0, u = px - i, v = py - j, k = j * 512 + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + 512] * (1 - u) + a[k + 513] * u) * v;
  }
  const dansSecteur = (lon, lat) => { const e = D.index.emprise; return lon > e[0] && lon < e[2] && lat > e[1] && lat < e[3]; };
  const dansLidar = (lon, lat) => D.lidar.some(pg => dansPoly(pg, lon, lat));
  function dansAnneau(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function dansPoly(g, x, y) { const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; return ps.some(p => dansAnneau(p[0], x, y) && !p.slice(1).some(t => dansAnneau(t, x, y))); }
  const NOMS_MILIEU = { roche: 'Roche', sable: 'Sable', vase: 'Vase' };
  function natureEn(lon, lat) {
    let res = null;
    for (const f of D.natures) if (dansPoly(f.geometry, lon, lat)) { if (!res || f.properties.m === 'roche') res = f.properties; }
    return res;
  }

  // ---------- L'eau : une règle de couleur sur le relief ----------
  // Teinte de l'eau selon son épaisseur (m) : transparente sur le bord, turquoise, puis bleu de plus en plus dense.
  const EAU = [[0, 124, 220, 216, 0], [1.2, 108, 214, 214, 0.14], [4, 74, 192, 208, 0.32], [10, 46, 150, 194, 0.5], [20, 32, 112, 170, 0.66], [35, 23, 80, 138, 0.78], [60, 15, 54, 104, 0.87], [120, 11, 35, 73, 0.92], [400, 8, 22, 50, 0.95]];
  const rgba = (c, a) => `rgba(${c[1]},${c[2]},${c[3]},${a == null ? c[4] : a})`;
  // Règle de couleur de l'eau pour un niveau de la mer N (0 ou négatif) : écume au bord, puis l'eau sous ce niveau.
  function regleEau(N, clarte) {
    const k = clarte || 1, st = [];
    for (let i = EAU.length - 1; i >= 1; i--) st.push(N - EAU[i][0] * k, rgba(EAU[i]));
    st.push(N - 0.9, rgba(EAU[1], 0.12), N - 0.4, 'rgba(236,248,250,0.62)', N - 0.05, 'rgba(236,248,250,0.62)', N, 'rgba(236,248,250,0)', 9000, 'rgba(236,248,250,0)');
    return ['interpolate', ['linear'], ['elevation'], -12000, rgba(EAU[EAU.length - 1]), ...st];
  }
  // Teinte de l'eau pour une épaisseur h, par interpolation entre les repères.
  function eauA(h) {
    for (let i = 1; i < EAU.length; i++) if (h <= EAU[i][0]) { const a = EAU[i - 1], b = EAU[i], t = (h - a[0]) / (b[0] - a[0]), v = k => a[k] + t * (b[k] - a[k]); return `rgba(${Math.round(v(1))},${Math.round(v(2))},${Math.round(v(3))},${v(4).toFixed(3)})`; }
    return rgba(EAU[EAU.length - 1]);
  }
  // L'eau à son niveau, avec une ligne d'or le long de la profondeur L.
  function regleLigne(L) {
    const st = [[-12000, rgba(EAU[EAU.length - 1])]];
    for (let i = EAU.length - 1; i >= 1; i--) if (EAU[i][0] > L + 1.6) st.push([-EAU[i][0], rgba(EAU[i])]);
    st.push([-L - 1.5, eauA(L + 1.5)], [-L - 1.1, 'rgba(240,200,90,0.95)'], [-L + 0.25, 'rgba(240,200,90,0.95)']);
    if (L > 0.8) st.push([-L + 0.65, eauA(Math.max(0, L - 0.65))]);
    for (let i = EAU.length - 1; i >= 1; i--) if (EAU[i][0] < L - 0.7) st.push([-EAU[i][0], rgba(EAU[i])]);
    st.push([Math.max(st[st.length - 1][0] + 0.01, -0.05), 'rgba(236,248,250,0)'], [9000, 'rgba(236,248,250,0)']);
    return ['interpolate', ['linear'], ['elevation'], ...st.flat()];
  }
  // Profondeurs en teintes franches (thème Profondeurs), à la façon des cartes bathymétriques.
  const BANDES = [[0, '#d7f0ee'], [3, '#b5e3e6'], [5, '#93d3df'], [10, '#6fbdd6'], [15, '#55a7cb'], [20, '#4290bd'], [30, '#3479ab'], [40, '#2a6597'], [60, '#215281'], [100, '#1a416a'], [200, '#133254'], [500, '#0d243f']];
  // Chaque teinte vaut de sa profondeur à la suivante ; deux repères très proches font une limite nette.
  function regleBandes() {
    const st = [-12000, BANDES[BANDES.length - 1][1]];
    for (let i = BANDES.length - 1; i >= 1; i--) st.push(-BANDES[i][0] - 0.02, BANDES[i][1], -BANDES[i][0], BANDES[i - 1][1]);
    st.push(-0.25, BANDES[0][1], -0.05, 'rgba(215,240,238,0)', 9000, 'rgba(215,240,238,0)');
    return ['interpolate', ['linear'], ['elevation'], ...st];
  }
  // Niveau de plongée : l'eau comme d'habitude jusqu'à la limite L, la limite en or, un voile orangé au-delà.
  function regleNiveau(L) {
    const st = [[-12000, 'rgba(190,70,36,0.72)'], [-L - 60, 'rgba(200,76,40,0.66)'], [-L - 1.5, 'rgba(214,96,48,0.5)'], [-L - 1.1, 'rgba(240,200,90,0.95)'], [-L + 0.25, 'rgba(240,200,90,0.95)'], [-L + 0.65, eauA(L - 0.65)]];
    for (let i = EAU.length - 1; i >= 1; i--) if (EAU[i][0] < L - 0.7) st.push([-EAU[i][0], rgba(EAU[i])]);
    st.push([-0.05, 'rgba(236,248,250,0)'], [9000, 'rgba(236,248,250,0)']);
    return ['interpolate', ['linear'], ['elevation'], ...st.flat()];
  }

  // ---------- Motifs animés : lumière qui danse en eau claire, herbiers qui ondulent ----------
  const NIMG = 6;
  function motifCaustiques(k) {
    const T = 192, c = document.createElement('canvas'); c.width = c.height = T; const x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,240,0.5)'; x.lineCap = 'round';
    const ph = k / NIMG * 2 * Math.PI;
    // Réseau de lignes ondulées entrecroisées, périodique sur la tuile : il se raccorde au motif voisin.
    for (let f = 0; f < 3; f++) {
      const ang = f * 2.1 + 0.4, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let l = -4; l <= 4; l++) {
        x.lineWidth = 0.9 + (l & 1) * 0.5; x.beginPath();
        for (let t = -T; t <= T * 2; t += 6) {
          const off = l * T / 4 + Math.sin(t / T * 2 * Math.PI * 2 + ph + f + l) * 9 + Math.sin(t / T * 2 * Math.PI * 5 - ph + l * 2) * 4;
          const px = T / 2 + ca * (t - T / 2) - sa * off, py = T / 2 + sa * (t - T / 2) + ca * off;
          t === -T ? x.moveTo(px, py) : x.lineTo(px, py);
        }
        x.stroke();
      }
    }
    return x.getImageData(0, 0, T, T);
  }
  function motifHerbier(k) {
    const T = 128, c = document.createElement('canvas'); c.width = c.height = T; const x = c.getContext('2d');
    x.fillStyle = 'rgba(40,74,44,0.82)'; x.fillRect(0, 0, T, T);
    const ph = k / NIMG * 2 * Math.PI;
    for (let i = 0; i < 46; i++) {
      const bx = (i * 37) % T, by = (i * 61) % T, h = 14 + (i * 13) % 12, w = Math.sin(ph + i * 0.7) * 4;
      x.strokeStyle = i % 3 ? 'rgba(92,140,70,0.9)' : 'rgba(150,170,80,0.8)'; x.lineWidth = 2.2;
      for (const dx of [0, -T, T]) for (const dy of [0, -T, T]) { x.beginPath(); x.moveTo(bx + dx, by + dy); x.quadraticCurveTo(bx + dx + w * 0.4, by + dy - h * 0.5, bx + dx + w, by + dy - h); x.stroke(); }
    }
    return x.getImageData(0, 0, T, T);
  }
  // Une seule horloge pour toutes les animations, à cinq images par seconde. Elle s'arrête quand la page est cachée,
  // quand rien d'animé n'est à l'écran, et au bout d'une minute sans geste (le téléphone ne chauffe pas pour rien).
  const horloge = { abonnes: new Set(), t: null, geste: Date.now(), map: null,
    lancer() { if (this.t || document.hidden) return; const pas = () => { this.t = null; if (document.hidden || Date.now() - this.geste > 60000) return; let actif = false; for (const f of this.abonnes) { try { if (f()) actif = true; } catch (e) { console.error(e); } } if (actif) this.t = setTimeout(pas, 200); }; this.t = setTimeout(pas, 200); },
    ajouter(f) { this.abonnes.add(f); this.lancer(); }, retirer(f) { this.abonnes.delete(f); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) horloge.lancer(); });

  // ---------- Les poissons ----------
  /* Espèces que l'on croise souvent en plongée sur ces côtes, avec le milieu (1 roche, 2 sable, 3 vase, h herbier) et la
     tranche de profondeur où on les voit le plus. C'est une aide à reconnaître, pas un inventaire : la carte ne sait pas
     où sont les poissons, elle les place là où leur milieu existe. */
  const ESPECES = [
    { id: 'castagnole', nom: 'Castagnole', latin: 'Chromis chromis', mil: [1, 'h'], p: [3, 35], banc: [8, 14], cm: 12, nage: 'banc', forme: 'fuseau', c: ['#3a3f4a', '#4b5260'], f: 'Petit poisson brun-noir à la queue fourchue, en bancs serrés au-dessus des roches. Les jeunes sont d\'un bleu électrique.' },
    { id: 'girelle', nom: 'Girelle', latin: 'Coris julis', mil: [1, 'h'], p: [0, 40], banc: [1, 3], cm: 18, nage: 'vif', forme: 'long', c: ['#4f8a63', '#e3d7a8'], raie: '#e07a2e', f: 'Fine et vive, elle vient voir le plongeur. Le mâle porte une bande orange en zigzag sur le flanc.' },
    { id: 'sar', nom: 'Sar commun', latin: 'Diplodus sargus', mil: [1], p: [1, 40], banc: [3, 7], cm: 30, nage: 'banc', forme: 'haut', c: ['#b9c2c9', '#e6ebee'], bandes: '#4a5560', tache: true, f: 'Argenté, rayé de bandes sombres, avec une tache noire avant la queue. En petits groupes le long des tombants.' },
    { id: 'saupe', nom: 'Saupe', latin: 'Sarpa salpa', mil: [1, 'h'], p: [0, 20], banc: [8, 14], cm: 30, nage: 'banc', forme: 'fuseau', c: ['#a7b0b4', '#dfe4e2'], lignes: '#e2b93b', f: 'Bancs tranquilles sur les roches claires et les herbiers, rayés de lignes dorées. Elle broute les algues.' },
    { id: 'merou', nom: 'Mérou brun', latin: 'Epinephelus marginatus', mil: [1], p: [8, 50], banc: [1, 1], cm: 90, nage: 'lent', forme: 'gros', c: ['#6b4f3a', '#a58a68'], taches: '#d9c7a1', f: 'Le seigneur des failles : massif, brun marbré de clair, il observe depuis son trou. Protégé par un moratoire en Méditerranée française.', statut: 'protégé' },
    { id: 'corb', nom: 'Corb', latin: 'Sciaena umbra', mil: [1], p: [3, 30], banc: [2, 5], cm: 40, nage: 'lent', forme: 'haut', c: ['#5b4630', '#8c6d47'], bord: '#f2efe6', f: 'Brun doré, nageoires bordées de blanc, en petits groupes à l\'entrée des failles. Protégé par un moratoire.', statut: 'protégé' },
    { id: 'rascasse', nom: 'Rascasse', latin: 'Scorpaena porcus', mil: [1], p: [1, 40], banc: [1, 1], cm: 20, nage: 'pose', forme: 'gros', c: ['#8a4b3a', '#c28466'], taches: '#5a2e22', f: 'Immobile et camouflée sur la roche. Ses épines dorsales sont venimeuses : on regarde, on ne touche pas.' },
    { id: 'murene', nom: 'Murène', latin: 'Muraena helena', mil: [1], p: [2, 50], banc: [1, 1], cm: 100, nage: 'pose', forme: 'serpent', c: ['#4a3a2c', '#b89a5e'], taches: '#e6d39a', f: 'Tête sortie d\'un trou, elle ouvre et ferme la bouche pour respirer. Pas agressive si on garde ses distances.' },
    { id: 'poulpe', nom: 'Poulpe', latin: 'Octopus vulgaris', mil: [1, 2], p: [1, 60], banc: [1, 1], cm: 60, nage: 'pose', forme: 'poulpe', c: ['#b4754e', '#e0b48b'], f: 'Maître du camouflage. Un tas de coquilles devant un trou trahit souvent sa tanière.' },
    { id: 'rouget', nom: 'Rouget de roche', latin: 'Mullus surmuletus', mil: [2, 1], p: [1, 60], banc: [2, 5], cm: 25, nage: 'fouille', forme: 'fuseau', c: ['#d27f6b', '#f2d6c4'], lignes: '#e9c449', f: 'Il fouille le sable de ses deux barbillons, souvent suivi d\'autres poissons qui profitent de ce qu\'il soulève.' },
    { id: 'marbre', nom: 'Marbré', latin: 'Lithognathus mormyrus', mil: [2], p: [0, 25], banc: [3, 8], cm: 25, nage: 'banc', forme: 'fuseau', c: ['#c7c9c2', '#eceee8'], bandes: '#6c6f66', fin: true, f: 'Argenté, finement rayé de bandes sombres, il fouille les fonds de sable près du bord.' },
    { id: 'vive', nom: 'Vive', latin: 'Trachinus draco', mil: [2, 3], p: [0, 50], banc: [1, 1], cm: 25, nage: 'pose', forme: 'long', c: ['#b6a374', '#e1d6b4'], f: 'Enfouie dans le sable, seuls les yeux dépassent. Son épine dorsale est venimeuse : attention aux pieds nus.' },
    { id: 'seiche', nom: 'Seiche', latin: 'Sepia officinalis', mil: [2, 3, 'h'], p: [1, 60], banc: [1, 2], cm: 30, nage: 'lent', forme: 'seiche', c: ['#a1896a', '#d8c6a6'], f: 'Elle change de couleur en un instant et ondule de sa nageoire en collerette. Au printemps, elle pond près du bord.' },
    { id: 'rougetv', nom: 'Rouget de vase', latin: 'Mullus barbatus', mil: [3, 2], p: [10, 100], banc: [3, 6], cm: 20, nage: 'fouille', forme: 'fuseau', c: ['#d98a78', '#f4dccc'], f: 'Cousin du rouget de roche, plus pâle, sur les fonds de vase et de sable plus profonds.' },
    { id: 'barracuda', nom: 'Barracuda', latin: 'Sphyraena viridensis', mil: [1, 2, 'h'], p: [5, 30], banc: [6, 12], cm: 70, nage: 'banc', forme: 'fleche', c: ['#7d8b93', '#d8dee0'], bandes: '#4e5a61', f: 'En bancs immobiles en pleine eau, surtout en été et en fin de saison. Impressionnant, sans danger.' },
    { id: 'oblade', nom: 'Oblade', latin: 'Oblada melanura', mil: [1], p: [0, 25], banc: [6, 10], cm: 25, nage: 'banc', forme: 'fuseau', c: ['#9fa9ae', '#e3e8ea'], tache: true, f: 'Argentée, une tache noire cerclée de blanc avant la queue. En bancs près de la surface, le long des roches.' }
  ];
  const espece = id => ESPECES.find(e => e.id === id);
  // Dessin d'une espèce, de profil, tournée vers la droite (d) ou la gauche : un pictogramme, pas un portrait.
  function dessinPoisson(e, gauche, vignette) {
    const W = vignette ? 96 : 72, H = vignette ? 56 : 40, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); if (gauche) { x.translate(W, 0); x.scale(-1, 1); }
    const cx = W * 0.52, cy = H / 2, L = W * 0.4;
    const corps = (hh, nez) => { x.beginPath(); x.moveTo(cx - L, cy); x.bezierCurveTo(cx - L * 0.6, cy - hh, cx + L * 0.4, cy - hh, cx + L * nez, cy); x.bezierCurveTo(cx + L * 0.4, cy + hh * 0.9, cx - L * 0.6, cy + hh * 0.9, cx - L, cy); x.closePath(); };
    const degrade = (hh) => { const g = x.createLinearGradient(0, cy - hh, 0, cy + hh); g.addColorStop(0, e.c[0]); g.addColorStop(0.55, e.c[0]); g.addColorStop(1, e.c[1]); return g; };
    const queue = (hh, fourche) => { x.beginPath(); x.moveTo(cx - L * 0.92, cy); x.lineTo(cx - L * 1.35, cy - hh); x.lineTo(cx - L * (fourche ? 1.18 : 1.3), cy); x.lineTo(cx - L * 1.35, cy + hh); x.closePath(); x.fillStyle = e.c[0]; x.fill(); };
    x.lineJoin = 'round';
    if (e.forme === 'poulpe') {
      x.fillStyle = e.c[0]; x.beginPath(); x.ellipse(cx + L * 0.35, cy - H * 0.08, L * 0.42, H * 0.3, -0.3, 0, 2 * Math.PI); x.fill();
      x.strokeStyle = e.c[0]; x.lineCap = 'round';
      for (let i = 0; i < 5; i++) { x.lineWidth = 3.2 - i * 0.3; x.beginPath(); x.moveTo(cx + L * 0.05, cy + H * 0.05); x.bezierCurveTo(cx - L * 0.4, cy + H * (0.1 + i * 0.06), cx - L * 0.7, cy - H * 0.1 + i * 3, cx - L * (1 - i * 0.05), cy + H * (0.2 - i * 0.08)); x.stroke(); }
      x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + L * 0.25, cy - H * 0.05, 2.6, 0, 7); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(cx + L * 0.26, cy - H * 0.05, 1.3, 0, 7); x.fill();
      return x.getImageData(0, 0, W, H);
    }
    if (e.forme === 'seiche') {
      x.fillStyle = degrade(H * 0.28); x.beginPath(); x.ellipse(cx, cy, L * 0.85, H * 0.28, 0, 0, 2 * Math.PI); x.fill();
      x.strokeStyle = e.c[1]; x.lineWidth = 2; x.beginPath(); x.ellipse(cx, cy, L * 0.9, H * 0.33, 0, 0, 2 * Math.PI); x.stroke();
      x.strokeStyle = e.c[0]; x.lineWidth = 2; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(cx + L * 0.8, cy - 3 + i * 2); x.quadraticCurveTo(cx + L * 1.05, cy - 4 + i * 3, cx + L * 1.15, cy - 2 + i * 2); x.stroke(); }
      for (let i = 0; i < 10; i++) { x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(cx - L * 0.6 + i * L * 0.12, cy - 3 + (i % 2) * 4, 3, 1.5); }
    } else if (e.forme === 'serpent') {
      x.strokeStyle = e.c[0]; x.lineCap = 'round'; x.lineWidth = H * 0.24;
      x.beginPath(); x.moveTo(cx - L * 1.3, cy + H * 0.15); x.bezierCurveTo(cx - L * 0.6, cy - H * 0.35, cx, cy + H * 0.35, cx + L * 0.9, cy - H * 0.05); x.stroke();
      x.strokeStyle = e.taches; x.lineWidth = 1.4; x.setLineDash([2, 4]); x.stroke(); x.setLineDash([]);
    } else {
      const hh = { fuseau: H * 0.24, long: H * 0.17, haut: H * 0.36, gros: H * 0.34, fleche: H * 0.14 }[e.forme] || H * 0.24;
      queue(hh * 0.95, e.forme === 'fuseau' || e.forme === 'fleche' || e.forme === 'haut');
      // nageoire dorsale
      x.fillStyle = e.c[0]; x.beginPath(); x.moveTo(cx - L * 0.45, cy - hh * 0.75); x.quadraticCurveTo(cx - L * 0.05, cy - hh * (e.forme === 'gros' || e.forme === 'haut' ? 1.45 : 1.25), cx + L * 0.3, cy - hh * 0.8); x.fill();
      corps(hh, e.forme === 'fleche' ? 1.25 : 1); x.fillStyle = degrade(hh); x.fill();
      x.save(); corps(hh, e.forme === 'fleche' ? 1.25 : 1); x.clip();
      if (e.bandes) { x.fillStyle = e.bandes; x.globalAlpha = 0.55; const n = e.fin ? 9 : 5; for (let i = 0; i < n; i++) x.fillRect(cx - L * 0.75 + i * L * 1.4 / n, cy - hh, e.fin ? 1.5 : 3.5, hh * 2); x.globalAlpha = 1; }
      if (e.lignes) { x.strokeStyle = e.lignes; x.lineWidth = 1.2; for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(cx - L, cy + i * hh * 0.35); x.lineTo(cx + L, cy + i * hh * 0.35 - 1); x.stroke(); } }
      if (e.raie) { x.strokeStyle = e.raie; x.lineWidth = 2.4; x.beginPath(); for (let i = 0; i <= 8; i++) x.lineTo(cx - L * 0.7 + i * L * 0.18, cy - hh * 0.05 + (i % 2 ? 3 : -3)); x.stroke(); }
      if (e.taches) { x.fillStyle = e.taches; for (let i = 0; i < 14; i++) { x.beginPath(); x.arc(cx - L * 0.7 + (i * 37 % 100) / 100 * L * 1.5, cy - hh * 0.7 + (i * 53 % 100) / 100 * hh * 1.4, 1.6, 0, 7); x.fill(); } }
      if (e.tache) { x.fillStyle = '#16191d'; x.beginPath(); x.ellipse(cx - L * 0.82, cy, 3, hh * 0.45, 0, 0, 7); x.fill(); }
      x.restore();
      if (e.bord) { x.strokeStyle = e.bord; x.lineWidth = 1.3; x.beginPath(); x.moveTo(cx - L * 0.45, cy - hh * 0.8); x.quadraticCurveTo(cx - L * 0.05, cy - hh * 1.45, cx + L * 0.3, cy - hh * 0.85); x.stroke(); }
      // œil
      x.fillStyle = '#f4f1ea'; x.beginPath(); x.arc(cx + L * 0.62, cy - hh * 0.22, Math.max(2.4, hh * 0.2), 0, 7); x.fill();
      x.fillStyle = '#111'; x.beginPath(); x.arc(cx + L * 0.65, cy - hh * 0.22, Math.max(1.3, hh * 0.11), 0, 7); x.fill();
      if (e.nage === 'fouille') { x.strokeStyle = e.c[1]; x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx + L * 0.85, cy + hh * 0.3); x.lineTo(cx + L * 0.95, cy + hh * 0.85); x.stroke(); }
    }
    return x.getImageData(0, 0, W, H);
  }
  const vignette = e => { const c = document.createElement('canvas'), im = dessinPoisson(e, false, true); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(im, 0, 0); return c.toDataURL(); };

  /* Simulation : des groupes posés sur des points d'habitat (préparés tous les 70 m dans la zone du lidar : profondeur,
     milieu, pente), qui tournent lentement autour de leur point. Vitesse et taille pensées pour l'écran, pas pour le réel :
     à l'échelle vraie, un poisson ne ferait pas un point. */
  function simulation(app) {
    const map = app.map; let groupes = [], filtre = null, actif = false, dernier = 0;
    const src = () => map.getSource('pl-poissons');
    function peupler() {
      const b = map.getBounds(), z = map.getZoom(), c = map.getCenter();
      const dans = D.habitats.filter(h => h[0] > b.getWest() && h[0] < b.getEast() && h[1] > b.getSouth() && h[1] < b.getNorth());
      groupes = []; if (z < 14.6 || !dans.length) return;
      // Les points les plus proches du centre d'abord : c'est là qu'on regarde.
      dans.sort((a, b2) => distM(a, [c.lng, c.lat]) - distM(b2, [c.lng, c.lat]));
      const nbMax = z > 16.5 ? 14 : z > 15.5 ? 12 : 9;
      const mpp0 = 156543 * Math.cos(c.lat * RAD) / Math.pow(2, z), ecart = Math.max(60, 95 * mpp0);   // deux groupes à 95 points d'écran au moins
      let graine = Math.round(c.lng * 1e4 + c.lat * 1e4);
      const alea = () => { graine = (graine * 16807) % 2147483647; return (graine % 10000) / 10000; };
      for (const h of dans) {
        if (groupes.length >= nbMax) break;
        const mil = h[3], prof = h[2], pente = h[4];
        const cand = ESPECES.filter(e => (!filtre || filtre === e.id) && e.mil.includes(mil || 2) && prof >= e.p[0] && prof <= e.p[1] && (e.forme !== 'gros' || mil === 1 || pente > 12));
        if (!cand.length) continue;
        if (groupes.some(g => distM(g.h, h) < ecart)) continue;
        const e = cand[Math.floor(alea() * cand.length)], n = e.banc[0] + Math.floor(alea() * (e.banc[1] - e.banc[0] + 1));
        const membres = []; for (let i = 0; i < n; i++) membres.push({ dx: (alea() - 0.5) * 2, dy: (alea() - 0.5) * 2, ph: alea() * 6.28 });
        groupes.push({ e, h, membres, ph: alea() * 6.28, r: 18 + alea() * 30, w: 0.08 + alea() * 0.12 });
      }
    }
    function pas() {
      if (!actif) return false;
      const s = src(); if (!s) return false;
      if (map.getZoom() < 14.6) { s.setData({ type: 'FeatureCollection', features: [] }); return false; }
      const t = performance.now() / 1000, mpp = 156543 * Math.cos(map.getCenter().lat * RAD) / Math.pow(2, map.getZoom()), br = map.getBearing() * RAD, feats = [];
      for (const g of groupes) {
        const e = g.e, lent = e.nage === 'pose' ? 0.04 : e.nage === 'lent' ? 0.35 : e.nage === 'fouille' ? 0.5 : 1;
        // Centre du groupe : une boucle lente autour de son point d'habitat (rayon en points d'écran).
        const a = g.ph + t * g.w * lent, rr = g.r * mpp * (e.nage === 'pose' ? 0.1 : 1);
        const cxm = Math.cos(a) * rr, cym = Math.sin(2 * a) * rr * 0.5, vx = -Math.sin(a), vy = Math.cos(2 * a);
        const ecr = vx * Math.cos(br) - vy * Math.sin(br);   // composante du mouvement vers la droite de l'écran
        for (const p of g.membres) {
          const ec = (e.banc[1] > 4 ? 34 : 16) * mpp, ox = p.dx * ec + Math.sin(t * 1.3 + p.ph) * 2 * mpp, oy = p.dy * ec * 0.6 + Math.cos(t * 1.1 + p.ph) * 2 * mpp;
          const dx = cxm + ox, dy = cym + oy, lon = g.h[0] + dx / (111200 * Math.cos(g.h[1] * RAD)), lat = g.h[1] + dy / 111200;
          feats.push({ type: 'Feature', properties: { i: 'pl-' + e.id + (ecr < 0 ? '-g' : '-d'), e: e.id, t: e.cm }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        }
      }
      s.setData({ type: 'FeatureCollection', features: feats });
      return true;
    }
    const surFin = () => { if (actif) { peupler(); horloge.ajouter(pas); } };
    return {
      allumer(oui, id) {
        filtre = id || null; actif = oui;
        if (oui) { peupler(); map.on('moveend', surFin); horloge.geste = Date.now(); horloge.ajouter(pas); }
        else { map.off('moveend', surFin); horloge.retirer(pas); const s = src(); if (s) s.setData({ type: 'FeatureCollection', features: [] }); }
      },
      filtrer(id) { filtre = id || null; if (actif) { peupler(); pas(); } },
      get nb() { return groupes.length; }
    };
  }

  // ---------- Épaves : des silhouettes couchées sur le fond ----------
  /* La base du Shom dit ce qu'était chaque épave (cargo, voilier, barge, avion…), parfois son orientation, rarement sa
     longueur. La carte en fait une silhouette vue de dessus, posée à plat sur le fond et tournée comme l'épave quand
     l'orientation est connue : rouille, concrétions, coque brisée pour celles que la fiche dit disloquées. La taille est
     une taille type du genre de bateau, grossie deux fois pour rester lisible : un repère, pas un relevé. */
  const GENRES = [
    [/cargo|commerce|transporteur|vapeur/i, 'cargo', 55], [/guerre/i, 'cargo', 40], [/chalutier|p[êe]che/i, 'peche', 20], [/voilier/i, 'voilier', 13],
    [/barge|gabare|ponton/i, 'barge', 26], [/a[ée]ronef|avion/i, 'avion', 11], [/hors-bord|dinghy|embarcation/i, 'canot', 6], [/moteur|plaisance|vedette/i, 'canot', 9]];
  const genreEpave = p => { const t = (p.type || '') + ' ' + (p.note || ''); for (const g of GENRES) if (g[0].test(p.type || '')) return g; for (const g of GENRES) if (g[0].test(t)) return g; return [null, 'canot', 8]; };
  function capEpave(p) {
    const n = p.note || '', a = /orient[ée]e?s?\s*:?\s*(?:au\s*)?(\d{3})\s*\/\s*\d{3}/i.exec(n); if (a) return +a[1];
    if (/orientation\s*:?\s*E\s*\/\s*W/i.test(n) || /est[- ]ouest/i.test(n)) return 90;
    if (/nord[- ]sud/i.test(n)) return 0;
    let h = 0; for (const ch of String(p.id || p.nom || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h;   // inconnue : un cap fixe, propre à l'épave
  }
  function dessinEpave(genre, brisee) {
    const W = 160, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), cy = H / 2;
    const rouille = x.createLinearGradient(0, 0, W, 0); rouille.addColorStop(0, '#6a4630'); rouille.addColorStop(0.5, '#8a5b3a'); rouille.addColorStop(1, '#5c3d2b');
    const ombre = () => { x.shadowColor = 'rgba(4,14,28,0.55)'; x.shadowBlur = 7; x.shadowOffsetX = 3; x.shadowOffsetY = 4; }, sansOmbre = () => { x.shadowColor = 'transparent'; };
    const coque = (x0, x1, l, pointe) => { x.beginPath(); x.moveTo(x0, cy - l * 0.8); x.quadraticCurveTo(x0 - 5, cy, x0, cy + l * 0.8); x.lineTo(x1 - pointe, cy + l); x.quadraticCurveTo(x1 - pointe * 0.3, cy + l * 0.7, x1, cy); x.quadraticCurveTo(x1 - pointe * 0.3, cy - l * 0.7, x1 - pointe, cy - l); x.closePath(); };
    x.lineJoin = 'round';
    if (genre === 'avion') {
      ombre(); x.fillStyle = '#7d8a8c'; x.beginPath(); x.ellipse(W / 2, cy, 44, 6, 0, 0, 7); x.fill();
      x.beginPath(); x.moveTo(W / 2 + 4, cy - 28); x.lineTo(W / 2 + 18, cy - 28); x.lineTo(W / 2 + 12, cy); x.lineTo(W / 2 + 18, cy + 28); x.lineTo(W / 2 + 4, cy + 28); x.lineTo(W / 2 - 2, cy); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(W / 2 - 42, cy - 11); x.lineTo(W / 2 - 34, cy - 11); x.lineTo(W / 2 - 32, cy + 11); x.lineTo(W / 2 - 42, cy + 11); x.closePath(); x.fill(); sansOmbre();
      x.fillStyle = '#394a50'; x.beginPath(); x.ellipse(W / 2 + 22, cy, 7, 3.4, 0, 0, 7); x.fill();
    } else if (genre === 'barge') {
      ombre(); x.fillStyle = rouille; x.beginPath(); x.roundRect(30, cy - 15, 100, 30, 5); x.fill(); sansOmbre();
      x.strokeStyle = 'rgba(30,18,10,0.55)'; x.lineWidth = 2; x.strokeRect(40, cy - 9, 80, 18); for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(40 + i * 20, cy - 9); x.lineTo(40 + i * 20, cy + 9); x.stroke(); }
    } else {
      const d = { cargo: [14, 146, 15, 26], peche: [38, 122, 12, 22], voilier: [44, 116, 8, 30], canot: [54, 106, 7, 16] }[genre] || [54, 106, 7, 16];
      ombre(); x.fillStyle = genre === 'voilier' || genre === 'canot' ? '#8d8676' : rouille;
      if (brisee) { x.save(); x.beginPath(); x.rect(0, 0, (d[0] + d[1]) / 2 - 3, H); x.clip(); coque(d[0], d[1], d[2], d[3]); x.fill(); x.restore(); x.save(); x.translate(5, 4); x.rotate(0.09); x.beginPath(); x.rect((d[0] + d[1]) / 2 + 2, -10, W, H + 20); x.clip(); coque(d[0], d[1], d[2], d[3]); x.fill(); x.restore(); }
      else { coque(d[0], d[1], d[2], d[3]); x.fill(); }
      sansOmbre();
      x.strokeStyle = 'rgba(28,16,8,0.5)'; x.lineWidth = 1.6; x.fillStyle = 'rgba(28,16,8,0.45)';
      if (genre === 'cargo') { x.fillRect(30, cy - 8, 26, 16); x.strokeRect(66, cy - 7, 22, 14); x.strokeRect(96, cy - 6, 20, 12); x.beginPath(); x.arc(44, cy, 3.4, 0, 7); x.fillStyle = '#2a1a10'; x.fill(); }
      if (genre === 'peche') { x.fillRect(52, cy - 6, 18, 12); x.beginPath(); x.moveTo(74, cy); x.lineTo(108, cy); x.stroke(); }
      if (genre === 'voilier') { x.strokeStyle = '#d9d2c0'; x.lineWidth = 2; x.beginPath(); x.moveTo(84, cy); x.lineTo(70, cy - 27); x.stroke(); x.strokeStyle = 'rgba(28,16,8,0.5)'; x.strokeRect(62, cy - 3.5, 20, 7); }
      if (genre === 'canot') { x.strokeRect(62, cy - 3.5, 24, 7); }
    }
    // Concrétions : des points clairs et sombres semés sur la silhouette.
    x.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 70; i++) { x.fillStyle = i % 3 ? 'rgba(214,190,150,0.35)' : 'rgba(20,40,40,0.35)'; x.beginPath(); x.arc((i * 53) % W, (i * 29) % H, 1 + (i % 3) * 0.7, 0, 7); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    return x.getImageData(0, 0, W, H);
  }

  // ---------- Masque terre / mer et abri à la houle ----------
  let masque = null;
  function lireMasque() {
    if (masque) return masque;
    const q = D.fonds.masque, bin = atob(q.bits), bits = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    const terre = new Uint8Array(q.w * q.h); for (let k = 0; k < terre.length; k++) terre[k] = (bits[k >> 3] >> (7 - (k & 7))) & 1;
    return (masque = { w: q.w, h: q.h, b: q.bornes, terre });
  }
  /* Abri : pour chaque maille de mer, la distance d'eau libre dans la direction d'où vient la houle (le « fetch »),
     plafonnée à 12 km ; une sortie du secteur vers le large compte comme de l'eau libre. Ne tient compte ni de la
     diffraction autour des caps, ni du ressac le long des falaises : un ordre de grandeur, pas une prévision. */
  function abri(dirDeg) {
    const M = lireMasque(), { w, h, b, terre } = M;
    const yM = l => Math.log(Math.tan((90 + l) * RAD / 2));
    const mx = (b[2] - b[0]) / w * 111200 * Math.cos((b[1] + b[3]) / 2 * RAD), out = new Float32Array(w * h).fill(NaN);
    const dx = Math.sin(dirDeg * RAD), dy = -Math.cos(dirDeg * RAD), pasM = mx, max = 12000;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (terre[k]) continue;
      let d = 0, x = i + 0.5, y = j + 0.5, libre = true;
      while (d < max) { x += dx; y += dy; d += pasM; const ii = x | 0, jj = y | 0; if (ii < 0 || jj < 0 || ii >= w || jj >= h) { libre = !(jj < 0); break; } if (terre[jj * w + ii]) { libre = false; break; } }
      out[k] = libre ? max : Math.min(max, d);
    }
    return { w, h, b, fetch: out, yM };
  }
  function peindreAbri(r, hauteur) {
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const x = c.getContext('2d'), im = x.createImageData(r.w, r.h), d = im.data;
    for (let k = 0; k < r.w * r.h; k++) {
      const f = r.fetch[k]; if (f !== f) continue;
      const e = Math.min(1, Math.sqrt(f / 12000)) * Math.min(1, hauteur / 1.2);   // exposition de 0 (abri) à 1
      const col = e < 0.2 ? [70, 170, 150] : e < 0.45 ? [190, 200, 110] : e < 0.7 ? [232, 160, 70] : [222, 104, 66];
      d[4 * k] = col[0]; d[4 * k + 1] = col[1]; d[4 * k + 2] = col[2]; d[4 * k + 3] = e < 0.2 ? 165 : e < 0.45 ? 140 : e < 0.7 ? 110 : 80;   // l'abri ressort, le large reste la mer
    }
    x.putImageData(im, 0, 0);
    // Grossi trois fois et adouci : les limites d'abri ne dessinent plus de marches.
    const g = document.createElement('canvas'); g.width = r.w * 3; g.height = r.h * 3; const y = g.getContext('2d');
    y.filter = 'blur(2.5px)'; y.imageSmoothingEnabled = true; y.drawImage(c, 0, 0, g.width, g.height);
    return g.toDataURL();
  }
  const exposition = (f, hauteur) => { const e = Math.min(1, Math.sqrt(f / 12000)) * Math.min(1, hauteur / 1.2); return e < 0.2 ? 'à l\'abri' : e < 0.45 ? 'peu exposé' : e < 0.7 ? 'exposé' : 'très exposé'; };
  const POINTS = ['nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est', 'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest'];
  const cardinal = deg => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  const duCap = deg => { const c = cardinal(deg); return /^[eo]/.test(c) ? 'de l\'' + c : 'du ' + c; };
  const versCap = deg => { const c = cardinal(deg); return /^[eo]/.test(c) ? 'vers l\'' + c : 'vers le ' + c; };

  // ---------- Profil des fonds le long d'un tracé ----------
  async function profil(pts, n) {
    const longs = []; let total = 0; for (let k = 1; k < pts.length; k++) { const l = distM(pts[k - 1], pts[k]); longs.push(l); total += l; }
    const out = [];
    for (let i = 0; i < n; i++) {
      let d = total * i / (n - 1), k = 0; while (k < longs.length - 1 && d > longs[k]) { d -= longs[k]; k++; }
      const t = longs[k] ? Math.min(1, d / longs[k]) : 0, lon = pts[k][0] + t * (pts[k + 1][0] - pts[k][0]), lat = pts[k][1] + t * (pts[k + 1][1] - pts[k][1]);
      out.push({ d: total * i / (n - 1), z: await altitude(lon, lat), lon, lat });
    }
    return { points: out, total };
  }
  function svgProfil(p, niveau) {
    const W = 320, H = 118, mg = 26, pts = p.points.filter(q => q.z === q.z); if (pts.length < 2) return '';
    const zmin = Math.min(-5, ...pts.map(q => q.z)), haut = 2, bas = Math.min(zmin * 1.12, -(niveau || 0) - 3);
    const X = d => mg + d / p.total * (W - mg - 6), Y = z => 6 + (haut - z) / (haut - bas) * (H - 22);
    const fond = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.d).toFixed(1)},${Y(Math.min(q.z, haut)).toFixed(1)}`).join('');
    const pas = -bas > 60 ? 20 : -bas > 25 ? 10 : 5, grad = [];
    for (let v = 0; v >= bas; v -= pas) grad.push(`<line x1="${mg}" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity="0.15"/><text x="${mg - 4}" y="${Y(v) + 3}" font-size="9" fill="currentColor" opacity="0.7" text-anchor="end">${-v}</text>`);
    const lim = niveau ? `<line x1="${mg}" x2="${W - 6}" y1="${Y(-niveau)}" y2="${Y(-niveau)}" stroke="#e8be5a" stroke-width="1.5" stroke-dasharray="5 3"/><text x="${mg + 4}" y="${Y(-niveau) - 3}" font-size="9" fill="#e8be5a">limite ${niveau} m</text>` : '';
    return `<svg class="pl-profil" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profil du fond le long du parcours" style="display:block;margin:6px 0">
      <rect x="${mg}" y="${Y(0)}" width="${W - mg - 6}" height="${H - 16 - Y(0)}" fill="rgba(70,150,190,0.38)"/>${grad.join('')}
      <path d="${fond}L${X(p.total)},${H - 16}L${mg},${H - 16}Z" fill="#d9c79e"/><path d="${fond}" fill="none" stroke="#8c7a5c" stroke-width="1.2"/>${lim}
      <text x="${W - 6}" y="${H - 4}" font-size="9" fill="currentColor" opacity="0.75" text-anchor="end">${p.total < 1000 ? Math.round(p.total) + ' m' : fr(p.total / 1000, 2) + ' km'}</text></svg>`;
  }

  // ---------- Mise en forme propre au module ----------
  function styles() {
    if (document.getElementById('pl-styles')) return;
    document.head.append(el('style', { id: 'pl-styles' }, `
      .pl-nuancier { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0 4px; }
      .pl-nuancier div { text-align: center; font-size: 11.5px; color: var(--muted); }
      .pl-nuancier i { display: block; height: 34px; border-radius: 8px; margin-bottom: 3px; box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset; }
      .pl-nuancier b { display: block; color: var(--ink); font-weight: 600; }
      .pl-fiche { display: flex; gap: 10px; align-items: flex-start; background: rgba(255,255,255,.05); border-radius: 10px; padding: 8px; margin: 6px 0; }
      .pl-fiche img { width: 72px; height: 42px; flex: none; background: linear-gradient(#2a6f96, #143a5e); border-radius: 8px; }
      .pl-fiche b { color: var(--gold); } .pl-fiche i { color: var(--muted); font-size: 12px; }
      .pl-fiche p { margin: 3px 0; font-size: 13px; line-height: 1.35; } .pl-fiche small { color: var(--muted); font-size: 11.5px; display: block; }
      .pl-statut { font-size: 10.5px; border: 1px solid var(--gold); color: var(--gold); border-radius: 999px; padding: 0 6px; margin-left: 4px; white-space: nowrap; }
      .pl-liste { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 6px; scrollbar-width: none; }
      .pl-liste::-webkit-scrollbar { display: none; }
      .pl-liste button { flex: none; border-radius: 12px; padding: 6px 10px; font-size: 12.5px; text-align: left; line-height: 1.2; background: #16233a; }
      .pl-liste button small { display: block; color: var(--muted); font-size: 11px; }
      .pl-h { font: 600 16px var(--titre, Georgia), serif; margin: 8px 0 2px; color: var(--ink); }
      .pl-detail p { margin: 4px 0; font-size: 13.5px; line-height: 1.4; }
      .pl-esp button img { image-rendering: auto; }
      .bulle .pl-ajout { font-size: 12.5px; padding: 4px 10px; }
      .pilote .pl-fiche { background: rgba(14,24,40,.86); } .pilote .pl-detail { max-height: 34vh; overflow-y: auto; }
    `));
  }

  // ---------- Installation ----------
  async function installer(app, opts) {
    styles();
    const map = app.map, racine = opts.donnees;
    const [index, fonds, habitats] = await Promise.all([
      fetch(racine + 'relief/index.json').then(r => r.json()), fetch(racine + 'fonds.json').then(r => r.json()),
      fetch(racine + 'habitats.json').then(r => r.json())]);
    // Les herbiers n'existent que si le script de préparation les a trouvés (fonds.herbiers) : pas de requête perdue sinon.
    const herbiers = fonds.herbiers ? await fetch(racine + 'herbiers.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;
    D = { racine, index, fonds, habitats, herbiers };
    const de = k => fonds.features.filter(f => f.properties.k === k);
    D.natures = de('nature'); D.lidar = de('lidar').map(f => f.geometry);
    brancher();
    // Le relief du socle devient celui du secteur : terre et fonds marins. Le modèle de surface (arbres) n'a pas de sens ici.
    app.forcerSolNu(true);
    map.getSource('relief').setTiles(['plongee://{z}/{x}/{y}']);
    const e = index.emprise;
    map.addSource('pl-fond', { type: 'raster', tiles: [racine + 'fond/{z}/{x}/{y}.webp'], tileSize: 512, minzoom: 10, maxzoom: 14, bounds: e, attribution: 'Fonds : Litto3D® Shom-IGN, HOMONIM Shom, natures de fond Shom' });
    map.addLayer({ id: 'pl-fond', type: 'raster', source: 'pl-fond', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'analyses');
    map.addSource('pl-vect', { type: 'geojson', data: fonds });
    if (herbiers) map.addSource('pl-herbiers', { type: 'geojson', data: herbiers });
    for (let k = 0; k < NIMG; k++) { map.addImage('pl-caust' + k, motifCaustiques(k)); if (herbiers) map.addImage('pl-herb' + k, motifHerbier(k)); }
    if (herbiers) map.addLayer({ id: 'pl-herbiers', type: 'fill', source: 'pl-herbiers', minzoom: 12, paint: { 'fill-pattern': 'pl-herb0', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 15, 0.9] } }, 'analyses');
    map.addLayer({ id: 'pl-nature', type: 'fill', source: 'pl-vect', filter: ['==', ['get', 'k'], 'nature'], layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'm'], 'roche', '#7d6650', 'sable', '#f0d78e', 'vase', '#8f9a6a', '#cccccc'], 'fill-opacity': 0.5, 'fill-outline-color': 'rgba(255,255,255,0.35)' } }, 'analyses');
    map.addLayer({ id: 'pl-clair', type: 'fill', source: 'pl-vect', filter: ['==', ['get', 'k'], 'clair'], minzoom: 13, paint: { 'fill-pattern': 'pl-caust0', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 0.22, 17, 0.32] } }, 'analyses');
    // L'eau lit le relief dans sa propre source (les mêmes tuiles, déjà en mémoire du navigateur) : la carte dessine mieux
    // une teinte et un relief 3D qui ne partagent pas la même source.
    map.addSource('pl-relief', { type: 'raster-dem', tiles: ['plongee://{z}/{x}/{y}'], tileSize: 512, maxzoom: 14, encoding: 'terrarium' });
    map.addLayer({ id: 'pl-eau', type: 'color-relief', source: 'pl-relief', paint: { 'color-relief-color': regleEau(0), 'color-relief-opacity': 1 } }, 'analyses');
    map.addLayer({ id: 'pl-iso', type: 'line', source: 'pl-vect', filter: ['==', ['get', 'k'], 'iso'], layout: { 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': ['case', ['in', ['get', 'p'], ['literal', [10, 20, 40, 60]]], 'rgba(240,250,255,0.75)', 'rgba(230,245,255,0.4)'], 'line-width': ['case', ['in', ['get', 'p'], ['literal', [10, 20, 40, 60]]], 1.3, 0.7] } }, 'analyses');
    map.addLayer({ id: 'pl-lidar', type: 'line', source: 'pl-vect', filter: ['==', ['get', 'k'], 'lidar'], layout: { visibility: 'none' }, paint: { 'line-color': '#e8be5a', 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0.8 } }, 'analyses');
    map.addLayer({ id: 'pl-iso-txt', type: 'symbol', source: 'pl-vect', filter: ['all', ['==', ['get', 'k'], 'iso'], ['<=', ['get', 'p'], 100]], minzoom: 13, layout: { visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 280, 'text-field': ['concat', ['to-string', ['get', 'p']], ' m'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 11, 'text-max-angle': 30 }, paint: { 'text-color': '#0f2a44', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 } });
    // Sites : épaves, obstructions remarquables (les statues), secs, sites gardés.
    const pic = (nom, dessin, w, h) => { const c = document.createElement('canvas'); c.width = w || 40; c.height = h || 40; const x = c.getContext('2d'); dessin(x); map.addImage(nom, x.getImageData(0, 0, c.width, c.height), { pixelRatio: 2 }); };
    pic('pl-epave', x => { x.fillStyle = '#10192a'; x.beginPath(); x.arc(20, 20, 17, 0, 7); x.fill(); x.strokeStyle = '#e8be5a'; x.lineWidth = 2.4; x.lineCap = 'round'; x.beginPath(); x.moveTo(9, 24); x.lineTo(31, 18); x.moveTo(12, 25); x.lineTo(13, 13); x.moveTo(20, 23); x.lineTo(21, 9); x.moveTo(27, 21); x.lineTo(27, 14); x.stroke(); });
    pic('pl-statue', x => { x.fillStyle = '#10192a'; x.beginPath(); x.arc(20, 20, 17, 0, 7); x.fill(); x.fillStyle = '#efe6cf'; x.beginPath(); x.arc(20, 12, 4.2, 0, 7); x.fill(); x.fillRect(16, 17, 8, 13); });
    pic('pl-sec', x => { x.fillStyle = '#10192a'; x.beginPath(); x.arc(20, 20, 15, 0, 7); x.fill(); x.fillStyle = '#9ad0d8'; x.beginPath(); x.moveTo(9, 27); x.lineTo(18, 12); x.lineTo(22, 18); x.lineTo(25, 14); x.lineTo(31, 27); x.closePath(); x.fill(); });
    pic('pl-moi', x => { x.fillStyle = '#b8963e'; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 16, a = i * Math.PI / 5 - Math.PI / 2; x.lineTo(20 + r * Math.cos(a), 20 + r * Math.sin(a)); } x.closePath(); x.fill(); x.strokeStyle = '#10192a'; x.lineWidth = 2; x.stroke(); });
    for (const sp of ESPECES) for (const g of [false, true]) map.addImage(`pl-${sp.id}-${g ? 'g' : 'd'}`, dessinPoisson(sp, g), { pixelRatio: 2 });
    for (const g of ['cargo', 'peche', 'voilier', 'barge', 'avion', 'canot']) { map.addImage('pl-ep-' + g, dessinEpave(g, false), { pixelRatio: 2 }); map.addImage('pl-ep-' + g + '-b', dessinEpave(g, true), { pixelRatio: 2 }); }
    // Les épaves font partie du paysage du fond : leur silhouette est toujours là, couchée sur le relief, à l'échelle de la carte.
    map.addSource('pl-epaves', { type: 'geojson', data: { type: 'FeatureCollection', features: de('epave').map(f => { const p = f.properties, g = genreEpave(p), brisee = /disloqu|dissémin|deux partie|bris[ée]e|détruite|vestiges/i.test(p.note || ''); return { type: 'Feature', properties: { i: 'pl-ep-' + g[1] + (brisee && g[1] !== 'avion' && g[1] !== 'barge' ? '-b' : ''), cap: capEpave(p) - 90, s: Math.max(0.1, g[2] * 2 * 16384 / (80 * 113550)), nom: p.nom ? casse(p.nom) : '' }, geometry: f.geometry }; }) } });
    map.addLayer({ id: 'pl-epaves', type: 'symbol', source: 'pl-epaves', minzoom: 13, layout: { 'icon-image': ['get', 'i'], 'icon-rotate': ['get', 'cap'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['exponential', 2], ['zoom'], 14, ['get', 's'], 19, ['*', 32, ['get', 's']]],
      'text-field': ['step', ['zoom'], '', 14.5, ['get', 'nom']], 'text-font': ['Source Sans Pro Italic'], 'text-size': 11.5, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 14.5, 0.95], 'text-color': '#f4e3b0', 'text-halo-color': 'rgba(10,24,44,0.9)', 'text-halo-width': 1.5 } });
    map.addSource('pl-sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'pl-sites', type: 'symbol', source: 'pl-sites', layout: { visibility: 'none', 'icon-image': ['get', 'i'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1], 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 13.5, ['get', 'nom']], 'text-font': ['Source Sans Pro Regular'], 'text-size': 11.5, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': ['get', 'rang'] }, paint: { 'text-color': '#fff', 'text-halo-color': '#10192a', 'text-halo-width': 1.6 } });
    map.addSource('pl-poissons', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'pl-poissons', type: 'symbol', source: 'pl-poissons', layout: { 'icon-image': ['get', 'i'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
      'icon-size': ['interpolate', ['exponential', 1.6], ['zoom'], 14.6, ['*', 0.5, ['^', ['/', ['get', 't'], 25], 0.4]], 17, ['*', 1.0, ['^', ['/', ['get', 't'], 25], 0.4]], 19.5, ['*', 1.7, ['^', ['/', ['get', 't'], 25], 0.4]]] } });

    // Animations : caustiques (et herbiers) à cinq images par seconde, seulement de près et sous une eau présente.
    let niveau = 0, image = 0;
    const animer = () => {
      const z = map.getZoom(); if (z < 13.5 || niveau < -8) return false;
      image = (image + 1) % NIMG; map.setPaintProperty('pl-clair', 'fill-pattern', 'pl-caust' + image);
      if (herbiers) map.setPaintProperty('pl-herbiers', 'fill-pattern', 'pl-herb' + image);
      return true;
    };
    const relancer = () => { horloge.geste = Date.now(); horloge.ajouter(animer); horloge.lancer(); };
    for (const ev of ['movestart', 'zoomend', 'click']) map.on(ev, relancer);
    relancer();
    const sim = simulation(app);

    // ----- Sites -----
    const SITES_CLE = 'cartes.plongee.sites';
    let mesSites = garde.lire(SITES_CLE, []);
    // Un lien partagé (?sites=…) apporte les sites d'un autre : ils s'ajoutent aux siens, sans doublon.
    try {
      const p = new URLSearchParams(location.search).get('sites');
      if (p) { const recus = JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, '+').replace(/_/g, '/'))))); let n = 0; for (const s of recus) if (!mesSites.some(t => distM(t.c, s.c) < 5 && t.nom === s.nom)) { mesSites.push(s); n++; } garde.ecrire(SITES_CLE, mesSites); if (n) setTimeout(() => { app.occupe(true, n + ' site' + (n > 1 ? 's' : '') + ' reçu' + (n > 1 ? 's' : '') + ' et ajouté' + (n > 1 ? 's' : '')); setTimeout(() => app.occupe(false), 3000); }, 1200); }
    } catch (err) { /* lien abîmé */ }
    const nomEpave = p => p.nom ? casse(p.nom) : (p.type || 'Épave');
    function tousSites() {
      const l = [];
      for (const f of de('epave')) { const p = f.properties; l.push({ id: 'e' + p.id, type: 'epave', nom: nomEpave(p), c: f.geometry.coordinates, p, rang: 1 }); }
      const statues = de('obstruction').filter(f => /statue/i.test(f.properties.note || ''));
      if (statues.length) { const c = statues.reduce((a, f) => [a[0] + f.geometry.coordinates[0] / statues.length, a[1] + f.geometry.coordinates[1] / statues.length], [0, 0]); l.push({ id: 'statues', type: 'statue', nom: 'Écomusée sous-marin', c, p: { n: statues.length, noms: statues.map(f => (/"([^"]+)"/.exec(f.properties.note) || [])[1]).filter(Boolean) }, rang: 0 }); }
      de('sec').slice(0, 30).forEach((f, i) => l.push({ id: 's' + i, type: 'sec', nom: 'Sec à ' + m(f.properties.p), c: f.geometry.coordinates, p: f.properties, rang: 3 }));
      mesSites.forEach((s, i) => l.push({ id: 'm' + i, type: 'moi', nom: s.nom, c: s.c, p: s, rang: -1 }));
      return l;
    }
    function dessinerSites() {
      map.getSource('pl-sites').setData({ type: 'FeatureCollection', features: tousSites().map(s => ({ type: 'Feature', properties: { id: s.id, nom: s.nom, i: 'pl-' + s.type, rang: s.rang }, geometry: { type: 'Point', coordinates: s.c } })) });
    }
    dessinerSites();
    const lienSites = () => { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('sites', btoa(unescape(encodeURIComponent(JSON.stringify(mesSites)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')); return u.toString(); };

    // ----- Conditions (Open-Meteo), partagées par les thèmes -----
    let meteo = null, meteoT = 0;
    async function conditions() {
      if (meteo && Date.now() - meteoT < 30 * 60000) return meteo;
      const [lo, la] = opts.centreMeteo, F = encodeURIComponent(opts.fuseau);
      const [mer, air] = await Promise.all([
        app.meteo(`https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction&timezone=${F}&forecast_days=4`),
        app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover&daily=sunrise,sunset&wind_speed_unit=kn&timezone=${F}&forecast_days=4`)]);
      if (!mer && !air) return null;
      meteo = { mer, air }; meteoT = Date.now(); return meteo;
    }
    const heureIdx = (h, iso) => { const k = h.time.indexOf(iso); return k; };
    // Heure ronde dans le fuseau de la carte (celui des prévisions), quel que soit celui de l'appareil.
    const isoHeure = d => d.toLocaleString('sv-SE', { timeZone: opts.fuseau, hour12: false }).slice(0, 13).replace(' ', 'T') + ':00';
    function lireHeure(M, iso) {
      const r = {};
      if (M.mer) { const h = M.mer.hourly, k = heureIdx(h, iso); if (k >= 0) Object.assign(r, { vague: h.wave_height[k], dirVague: h.wave_direction[k], periode: h.wave_period[k], houle: h.swell_wave_height[k], dirHoule: h.swell_wave_direction[k], periodeHoule: h.swell_wave_period[k], eau: h.sea_surface_temperature[k], courant: h.ocean_current_velocity ? h.ocean_current_velocity[k] : null, dirCourant: h.ocean_current_direction ? h.ocean_current_direction[k] : null }); }
      if (M.air) { const h = M.air.hourly, k = heureIdx(h, iso); if (k >= 0) Object.assign(r, { vent: h.wind_speed_10m[k], dirVent: h.wind_direction_10m[k], rafales: h.wind_gusts_10m[k], nuages: h.cloud_cover[k] }); }
      return r;
    }
    const dirMer = r => r.vague == null ? null : (r.houle != null && r.houle >= 0.5 * r.vague ? r.dirHoule : r.dirVague);

    // ---------- Thèmes ----------
    const themes = {};
    const aide = {
      vider: 'Le fond est le relevé Litto3D du Shom et de l\'IGN (2015) : un lidar aéroporté qui traverse l\'eau claire et relève le fond au mètre, jusqu\'à une quarantaine de mètres ici. Plus loin et plus profond, c\'est le modèle HOMONIM du Shom, à 100 m : formes générales seulement (teinte plus froide). Les couleurs du fond viennent de la carte des natures de fond du Shom (sable, roche, vase, au 1/50 000), adoucies, et l\'ombrage du relief lui-même. L\'eau est une teinte posée selon son épaisseur : baisser la mer ne déplace rien, elle fait voir le fond comme une vallée. Le menu propose un relief accentué, utile sous l\'eau où les pentes sont douces.',
      profondeurs: 'Profondeurs en mètres sous le niveau moyen de la mer (Litto3D, IGN 69 ; à quelques décimètres du zéro des cartes marines en Méditerranée). Dans la zone du lidar (pointillé doré), le fond est relevé au mètre ; au-delà, modèle à 100 m. Les isobathes sont retracées sur le relief lissé à une dizaine de mètres. Une roche isolée de petite taille, une ancre, une épave récente peuvent manquer. Ni carte marine ni instrument de navigation.',
      lumiere: 'L\'eau absorbe les couleurs dans l\'ordre : le rouge dès les premiers mètres, puis l\'orange et le jaune ; le vert et le bleu vont loin. Calcul pour une eau très claire (coefficients d\'absorption de l\'eau pure, Pope et Fry 1997), sur le trajet de la lumière de la surface au fond ; une eau chargée ou un ciel couvert assombrissent bien davantage. La part de lumière tient compte de la hauteur du soleil, calculée pour le jour et l\'heure.',
      poissons: 'Les espèces sont placées là où leur milieu existe (nature du fond, profondeur, pente), sur des points tous les 70 m de la zone du lidar. Personne ne cartographie les poissons : la carte montre ce qu\'on peut croiser, pas ce qui est là. Les dessins sont des pictogrammes ; tailles et vitesses sont pensées pour l\'écran. Les herbiers de posidonie, refuges de nombreuses espèces, ne sont pas encore sur la carte.',
      natures: 'Natures de fond au 1/50 000 du Shom (Licence Ouverte) : sédiment et roche relevés par prélèvements et levés anciens, généralisés. À cette échelle, une limite peut être décalée de plusieurs dizaines de mètres, et une tête de roche dans le sable n\'y figure pas : le relief du lidar la montre souvent mieux. Les herbiers de posidonie ne font pas partie de ce produit.',
      sites: 'Épaves et obstructions : base du Shom (CC BY-SA 4.0), avec la précision de position annoncée. Secs : sommets sous-marins repérés par la carte dans le relief du lidar, qui dominent leurs alentours d\'au moins 4 m. Les sites que tu ajoutes restent dans ce téléphone ; « Partager » les envoie par un lien. Aucun site n\'est une autorisation : zones protégées, chenaux et mouillages réglementés restent à vérifier.',
      parcours: 'Le profil lit le relief au pas de 3,5 m (lidar) le long du tracé. La durée suppose une palanquée qui palme tranquillement, autour de 10 m par minute, sans les paliers : elle donne un ordre de grandeur pour choisir un parcours, pas un temps de plongée. Ni la carte ni ce calcul ne remplacent le directeur de plongée, les tables ou l\'ordinateur.',
      niveaux: 'Repères de profondeur maximale de la Fédération française d\'études et de sports sous-marins : baptême 6 m ; niveau 1 jusqu\'à 20 m encadré ; niveau 2 jusqu\'à 40 m encadré (20 m en autonomie) ; niveau 3 jusqu\'à 60 m en autonomie. Les conditions du jour, l\'expérience et le directeur de plongée décident : ces lignes servent à lire le relief autour d\'un site.',
      conditions: 'Prévision Open-Meteo : vagues, houle, température de l\'eau et courant (modèles de vagues et d\'océan, maille de plusieurs kilomètres), vent (modèles de Météo-France). L\'abri compare, pour chaque endroit de la mer, la longueur d\'eau libre dans la direction d\'où viennent les vagues (le fetch) : un cap ou une île devant soi abrite. La diffraction autour des pointes et le ressac le long des falaises ne sont pas calculés. La visibilité sous l\'eau n\'est prévue par personne : elle dépend du plancton, des pluies et des derniers coups de vent.'
    };
    const ouvrir3d = () => { if (!app.relief3d) app.mettre3d(true); };
    const poserEau = (N, k) => map.setPaintProperty('pl-eau', 'color-relief-color', regleEau(N, k));
    const montrer = (ids, oui) => ids.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', oui ? 'visible' : 'none'); });
    const aireDecouverte = N => D.fonds.aires.slice(0, Math.min(100, Math.round(-N))).reduce((a, b) => a + b, 0);
    const lidarTotal = D.fonds.aires.reduce((a, b) => a + b, 0);

    // --- Vider la mer ---
    themes.vider = (() => {
      let anim = null;
      const q = { theme: 'Vider', libelle: 'Et sans la mer ?', aide: aide.vider };
      const maj = c => {
        poserEau(niveau);
        const a = aireDecouverte(niveau);
        c.querySelector('.v-n').textContent = niveau === 0 ? 'mer pleine' : '−' + Math.round(-niveau) + ' m';
        c.querySelector('.etat').innerHTML = niveau === 0 ? 'La mer est à son niveau : l\'eau claire laisse voir le fond près du bord. Fais baisser la mer pour découvrir le relief.' : niveau <= -100 ? 'Mer vidée : tout le plateau relevé au lidar est à nu, le large reste en eau.' : `Mer baissée de <span class="fort">${Math.round(-niveau)} m</span> : ${fr(a, 1)} km² de fond découvert, sur les ${fr(lidarTotal, 0)} km² relevés au lidar.`;
      };
      q.ouvrir = async (app) => {
        ouvrir3d();
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p>
          <div class="ligne"><label style="min-width:84px">Niveau</label><input type="range" class="n" min="-100" max="0" step="1" value="${niveau}" style="flex:1"><span class="fort v-n" style="min-width:84px;text-align:right"></span></div>
          <div class="puces"><button class="pl-plein">Mer pleine</button><button class="pl-m20">−20 m</button><button class="pl-vide">Vidée</button><button class="pl-anim">▶ Vider doucement</button></div>
          <div class="legende">${[2, 10, 20, 40, 60, 120].map(p => { const t = EAU.find(r => r[0] >= p) || EAU[EAU.length - 1]; return `<span><i style="background:rgb(${t[1]},${t[2]},${t[3]})"></i>${p} m d'eau</span>`; }).join('')}</div>`);
        const r = c.querySelector('.n');
        const aller = v => { niveau = v; r.value = v; maj(c); };
        r.oninput = () => { if (anim) { cancelAnimationFrame(anim); anim = null; } aller(+r.value); };
        c.querySelector('.pl-plein').onclick = () => aller(0); c.querySelector('.pl-m20').onclick = () => aller(-20); c.querySelector('.pl-vide').onclick = () => aller(-100);
        c.querySelector('.pl-anim').onclick = () => {
          if (anim) { cancelAnimationFrame(anim); anim = null; return; }
          const t0 = performance.now(), de = niveau < -95 ? 0 : niveau, a = -100, duree = 9000 * (de - a) / 100 + 500;
          if (de === 0) aller(0);
          const pas = t => { const u = Math.min(1, (t - t0) / duree), v = de + (a - de) * (u * u * (3 - 2 * u)); aller(Math.round(v)); if (u < 1 && app.active === q) anim = requestAnimationFrame(pas); else anim = null; };
          anim = requestAnimationFrame(pas);
        };
        maj(c);
      };
      q.fermer = () => { if (anim) cancelAnimationFrame(anim); anim = null; };
      return q;
    })();

    // --- Profondeurs ---
    themes.profondeurs = {
      theme: 'Profondeurs', libelle: 'Quelle profondeur ?', aide: aide.profondeurs,
      async ouvrir(app) {
        map.setPaintProperty('pl-eau', 'color-relief-color', regleBandes()); map.setPaintProperty('pl-eau', 'color-relief-opacity', 0.82);
        montrer(['pl-iso', 'pl-iso-txt', 'pl-lidar'], true);
        app.repondre(this.libelle, `<p class="etat">Touche la mer pour lire la profondeur, le fond et la précision du relevé.</p>
          <div class="legende">${BANDES.map((b, i) => `<span><i style="background:${b[1]}"></i>${BANDES[i + 1] ? b[0] + '–' + BANDES[i + 1][0] + ' m' : 'plus de ' + b[0] + ' m'}</span>`).join('')}<span><i style="background:transparent;border:1.5px dashed #e8be5a"></i>limite du lidar</span></div>`);
      },
      async toucher(app, ll) {
        const z = await altitude(ll.lng, ll.lat), n = natureEn(ll.lng, ll.lat), lid = dansLidar(ll.lng, ll.lat);
        if (z !== z) { app.bulle(ll, 'Hors du secteur relevé'); return; }
        if (z >= 0) { app.bulle(ll, `À terre<small>${m(z)} d'altitude</small>`); return; }
        app.bulle(ll, `<span class="fort">${m(-z)}</span> de fond<small>${n ? n.t.toLowerCase() + ' · ' : ''}${lid ? 'relevé au lidar (1 m)' : 'modèle à 100 m : ordre de grandeur'}</small>`);
      },
      fermer() { poserEau(niveau); map.setPaintProperty('pl-eau', 'color-relief-opacity', 1); montrer(['pl-iso', 'pl-iso-txt', 'pl-lidar'], false); }
    };

    // --- Lumière : couleurs au fond ---
    themes.lumiere = (() => {
      // Absorption de l'eau pure (m⁻¹), Pope et Fry 1997, et un peu de diffusion : rouge, orange, jaune, vert, bleu.
      const BANDE = [['rouge', 650, 0.35, [210, 40, 40]], ['orange', 600, 0.23, [240, 140, 30]], ['jaune', 575, 0.09, [240, 210, 40]], ['vert', 525, 0.05, [60, 170, 80]], ['bleu', 470, 0.02, [40, 110, 210]]];
      let prof = 10;
      const q = { theme: 'Lumière', libelle: 'Quelles couleurs au fond ?', aide: aide.lumiere };
      const reste = (k, d) => Math.exp(-(k + 0.012) * d);
      const maj = c => {
        const d = prof, sol = app.soleil(new Date(), opts.centreMeteo[1], opts.centreMeteo[0]), h = sol.hauteur != null ? sol.hauteur : sol.alt;
        const vu = BANDE.map(b => [b[0], reste(b[2], d * 1.15), b[3]]);
        c.querySelector('.v-p').textContent = d + ' m';
        c.querySelector('.pl-nuancier').innerHTML = vu.map(v => { const f = Math.max(0.04, v[1]), col = v[2].map((x, i) => Math.round(x * f + [8, 30, 60][i] * (1 - f) * 0.6)); return `<div><i style="background:rgb(${col})"></i><b>${v[0]}</b><span>${Math.round(v[1] * 100)} %</span></div>`; }).join('');
        const perdue = vu.filter(v => v[1] < 0.1).map(v => v[0]);
        const totale = Math.exp(-0.06 * d) * Math.max(0, Math.sin((h || 0) * RAD));
        c.querySelector('.etat').innerHTML = d === 0 ? 'En surface, toutes les couleurs sont là.' : `À <span class="fort">${d} m</span>, ${perdue.length ? 'il ne reste presque plus ' + perdue.map(n => /^[aeiou]/.test(n) ? 'd\'' + n : 'de ' + n).join(' ni ') : 'toutes les couleurs restent visibles, déjà ternies'} : un objet rouge paraît ${vu[0][1] < 0.1 ? 'brun ou noir' : 'sombre'}.`;
        c.querySelector('.pl-soleil').textContent = h > 0 ? `Soleil à ${Math.round(h)}° maintenant : au fond, environ ${Math.max(1, Math.round(totale * 100))} % de la lumière d'un plein soleil au zénith en surface.` : 'Soleil couché : sous l\'eau, seule la lampe rend les couleurs.';
        // Sur la carte : la mer à son niveau, et une ligne d'or le long de la profondeur choisie.
        map.setPaintProperty('pl-eau', 'color-relief-color', regleLigne(d));
      };
      q.ouvrir = async (app) => {
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p>
          <div class="ligne"><label style="min-width:84px">Profondeur</label><input type="range" class="p" min="0" max="40" step="1" value="${prof}" style="flex:1"><span class="fort v-p" style="min-width:56px;text-align:right"></span></div>
          <div class="pl-nuancier"></div><p class="petit2 pl-soleil"></p>`);
        c.querySelector('.p').oninput = e => { prof = +e.target.value; maj(c); };
        maj(c);
      };
      q.plein = () => ({ bloc: '.pl-nuancier' });
      q.fermer = () => poserEau(niveau);
      return q;
    })();

    // --- Poissons : qui vit ici ? ---
    themes.poissons = (() => {
      let filtre = null;
      const q = { theme: 'Poissons', libelle: 'Qui vit ici ?', aide: aide.poissons };
      const liste = (prof, mil) => ESPECES.filter(e => e.mil.includes(mil || 2) && prof >= e.p[0] - 2 && prof <= e.p[1] + 5);
      const fiche = e => `<div class="pl-fiche"><img src="${vignette(e)}" alt=""><div><b>${e.nom}</b> <i>${e.latin}</i>${e.statut ? ` <span class="pl-statut">${e.statut}</span>` : ''}<p>${e.f}</p><small>${e.mil.map(v => ({ 1: 'roche', 2: 'sable', 3: 'vase', h: 'herbier' }[v])).join(', ')} · souvent entre ${e.p[0]} et ${e.p[1]} m · jusqu'à ${e.cm} cm environ</small></div></div>`;
      q.ouvrir = async (app) => {
        ouvrir3d();
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p>
          <div class="vignettes pl-esp"><button data-e="" aria-pressed="${!filtre}">Toutes</button>${ESPECES.map(e => `<button data-e="${e.id}" aria-pressed="${filtre === e.id}" title="${e.nom}"><img src="${vignette(e)}" alt="" style="width:48px;height:28px;display:block;margin:0 auto 2px">${e.nom}</button>`).join('')}</div>
          <div class="pl-detail"></div>`);
        const etat = () => { c.querySelector('.etat').innerHTML = map.getZoom() < 14.6 ? 'Rapproche-toi d\'un fond (zoom plus fort) : les poissons apparaissent près du fond, là où vit leur espèce. Touche un poisson, ou un endroit, pour savoir qui on y croise.' : !sim.nb ? (filtre ? `Pas de milieu pour ${espece(filtre).nom.toLowerCase()} dans cette vue. Essaie plus près du bord, ou une autre espèce.` : 'Pas de poissons à montrer ici : la carte les place sur le plateau relevé au lidar, jusqu\'à 70 m de fond. Reviens vers les îles ou la côte.') : (filtre ? `${espece(filtre).nom} : là où son milieu existe dans la vue.` : 'Touche un poisson pour sa fiche, ou un endroit pour savoir qui on y croise.'); };
        c.querySelector('.pl-esp').onclick = ev => { const b = ev.target.closest('button[data-e]'); if (!b) return; filtre = b.dataset.e || null; c.querySelectorAll('.pl-esp button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); sim.filtrer(filtre); etat(); c.querySelector('.pl-detail').innerHTML = filtre ? fiche(espece(filtre)) : ''; };
        sim.allumer(true, filtre); etat(); app.suivre(q, etat);
        if (map.getZoom() < 14.6) map.easeTo({ zoom: 15.6, pitch: Math.max(map.getPitch(), 55), duration: 1200 });
      };
      q.toucher = async (app, ll) => {
        const p = map.project(ll), f = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ['pl-poissons'] })[0];
        const c = q._c; if (!c) return;
        if (f) { const e = espece(f.properties.e); c.querySelector('.pl-detail').innerHTML = fiche(e); app.bulle(ll, `<span class="fort">${e.nom}</span><small>${e.latin}</small>`); return; }
        const z = await altitude(ll.lng, ll.lat); if (z !== z || z >= 0) { app.bulle(ll, z >= 0 ? 'À terre' : 'Hors du secteur'); return; }
        const n = natureEn(ll.lng, ll.lat), mil = n ? { roche: 1, sable: 2, vase: 3 }[n.m] : 2, l = liste(-z, mil);
        app.bulle(ll, `<span class="fort">${m(-z)}</span>, ${n ? n.t.toLowerCase() : 'fond mal connu'}<small>${l.length} espèces qu'on peut y croiser</small>`);
        c.querySelector('.pl-detail').innerHTML = `<p class="petit2" style="margin-top:8px">Ici, sur ${n ? n.t.toLowerCase() : 'ce fond'} à ${m(-z)} :</p>` + l.map(fiche).join('');
      };
      q.plein = () => ({ bloc: '.pl-detail', rangees: ['.pl-esp'] });
      q.fermer = () => sim.allumer(false);
      return q;
    })();

    // --- Fonds : sable, roche, vase ---
    themes.natures = {
      theme: 'Fonds', libelle: 'Sur quel fond ?', aide: aide.natures,
      async ouvrir(app) {
        montrer(['pl-nature'], true);
        const masques = new Set(), c = app.repondre(this.libelle, `<p class="etat">Touche le fond pour sa nature. ${D.herbiers ? '' : 'Les herbiers de posidonie arriveront avec la donnée de l\'OFB.'}</p><div class="legende"></div>`);
        app.legende(c, [{ cle: 'roche', couleur: '#7d6650', texte: 'roche, cailloutis' }, { cle: 'sable', couleur: '#f0d78e', texte: 'sable, graviers' }, { cle: 'vase', couleur: '#8f9a6a', texte: 'vase' }], ms => map.setFilter('pl-nature', ['all', ['==', ['get', 'k'], 'nature'], ['!', ['in', ['get', 'm'], ['literal', [...ms]]]]]), masques);
      },
      async toucher(app, ll) {
        const n = natureEn(ll.lng, ll.lat), z = await altitude(ll.lng, ll.lat);
        app.bulle(ll, n ? `<span class="fort">${n.t}</span><small>${z === z && z < 0 ? m(-z) + ' de fond · ' : ''}${NOMS_MILIEU[n.m].toLowerCase()} pour la carte</small>` : (z >= 0 ? 'À terre' : 'Nature du fond inconnue ici'));
      },
      fermer() { montrer(['pl-nature'], false); map.setFilter('pl-nature', ['==', ['get', 'k'], 'nature']); }
    };

    // --- Sites : où plonger ? ---
    themes.sites = (() => {
      const q = { theme: 'Sites', libelle: 'Où plonger ?', aide: aide.sites };
      let choisi = null;
      async function decrire(s) {
        const c = q._c; if (!c) return; choisi = s;
        const [lon, lat] = s.c, z = await altitude(lon, lat), n = natureEn(lon, lat), lid = dansLidar(lon, lat);
        // Autour du site, 150 m : le plus haut et le plus profond, pour lire le dénivelé.
        let hmin = Infinity, hmax = -Infinity;
        for (let a = 0; a < 16; a++) for (const r of [40, 90, 150]) { const v = await altitude(lon + r * Math.cos(a * Math.PI / 8) / (111200 * Math.cos(lat * RAD)), lat + r * Math.sin(a * Math.PI / 8) / 111200); if (v === v) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); } }
        if (app.active !== q || choisi !== s) return;
        const p = s.p || {}, lignes = [];
        if (z === z) lignes.push(`<b>${z < 0 ? m(-z) : 'à terre'}</b> au point${hmin < Infinity ? `, de ${hmax >= 0 ? 'la surface' : m(-hmax)} à ${m(-hmin)} dans un rayon de 150 m` : ''}${lid ? '' : ' (modèle à 100 m)'}.`);
        if (n) lignes.push(`Fond : ${n.t.toLowerCase()}.`);
        if (s.type === 'epave') { if (p.type) lignes.push(`${p.type}${p.brassiage != null ? ', brassiage ' + fr(p.brassiage) + ' m (hauteur d\'eau sur l\'épave)' : ''}.`); if (p.note) lignes.push(`<span class="petit2">${propre(p.note)}</span>`); if (p.precis) lignes.push(`Position à ${Math.round(p.precis)} m près.`); }
        if (s.type === 'statue') lignes.push(`${p.n} statues immergées${p.noms && p.noms.length ? ' (' + p.noms.join(', ') + ')' : ''}, au large de l'île Sainte-Marguerite. Peu profond : accessible en randonnée palmée.`);
        if (s.type === 'sec') lignes.push(`Sommet à ${m(s.p.p)}, qui domine ses abords de ${m(s.p.h)}.`);
        const niv = z < 0 ? (-hmin <= 6 ? 'accessible dès le baptême' : -hmin <= 20 ? 'dans la limite du niveau 1' : -hmin <= 40 ? 'jusqu\'au niveau 2' : 'descend au-delà de 40 m') : '';
        if (niv) lignes.push(`Profondeur la plus forte alentour : ${niv}.`);
        const M = await conditions(); let cond = '';
        if (M && app.active === q && choisi === s) {
          const r = lireHeure(M, isoHeure(new Date())), dir = dirMer(r);
          if (r.vague != null) {
            const ab = abri(dir), mm = lireMasque(), i = Math.floor((lon - mm.b[0]) / (mm.b[2] - mm.b[0]) * mm.w), yM = l => Math.log(Math.tan((90 + l) * RAD / 2)), j = Math.floor((yM(mm.b[3]) - yM(lat)) / (yM(mm.b[3]) - yM(mm.b[1])) * mm.h);
            const f = i >= 0 && j >= 0 && i < mm.w && j < mm.h ? ab.fetch[j * mm.w + i] : NaN;
            cond = `Maintenant : vagues ${fr(r.vague, 1)} m venant ${duCap(dir)}${r.vent != null ? `, vent ${Math.round(r.vent)} nœuds ${duCap(r.dirVent)}` : ''}${r.eau != null ? `, eau à ${Math.round(r.eau)} °C` : ''}${f === f ? ` : site <span class="fort">${exposition(f, r.vague)}</span>` : ''}.`;
          }
        }
        c.querySelector('.pl-detail').innerHTML = `<h3 class="pl-h">${propre(s.nom)}</h3>${lignes.map(l => `<p>${l}</p>`).join('')}${cond ? `<p>${cond}</p>` : ''}
          <div class="puces"><button class="pl-y">Y aller</button><button class="pl-trajet">Tracer un parcours d'ici</button>${s.type === 'moi' ? '<button class="pl-oublier">Retirer ce site</button>' : ''}</div>`;
        c.querySelector('.pl-y').onclick = () => map.easeTo({ center: s.c, zoom: 16.2, pitch: 60, duration: 1400 });
        c.querySelector('.pl-trajet').onclick = () => { themes.parcours.depart = s.c; app.choisir(themes.parcours); };
        const ou = c.querySelector('.pl-oublier'); if (ou) ou.onclick = () => { mesSites = mesSites.filter(t => t !== s.p); garde.ecrire(SITES_CLE, mesSites); dessinerSites(); lister(); c.querySelector('.pl-detail').innerHTML = ''; app.sansBulle(); };
      }
      function lister() {
        const c = q._c; if (!c) return;
        const ctr = map.getCenter(), l = tousSites().map(s => Object.assign(s, { d: distM(s.c, [ctr.lng, ctr.lat]) })).sort((a, b) => (a.type === 'sec') - (b.type === 'sec') || a.d - b.d).slice(0, 14);
        c.querySelector('.pl-liste').innerHTML = l.map(s => `<button data-id="${s.id}">${propre(s.nom)}<small>${{ epave: 'épave', statue: 'statues', sec: 'sec', moi: 'mon site' }[s.type]} · ${s.d < 1000 ? Math.round(s.d / 10) * 10 + ' m' : fr(s.d / 1000, 1) + ' km'}</small></button>`).join('');
        c.querySelectorAll('.pl-liste button').forEach(b => { b.onclick = () => { const s = tousSites().find(t => t.id === b.dataset.id); if (s) { map.easeTo({ center: s.c, zoom: Math.max(map.getZoom(), 15), duration: 900 }); app.bulle({ lng: s.c[0], lat: s.c[1] }, `<span class="fort">${propre(s.nom)}</span>`); decrire(s); } }; });
      }
      q.ouvrir = async (app) => {
        ouvrir3d(); montrer(['pl-sites'], true);
        const c = q._c = app.repondre(q.libelle, `<p class="etat">Touche un site pour sa fiche, ou la mer pour en ajouter un à toi.</p>
          <div class="pl-liste"></div><div class="pl-detail"></div>
          <div class="puces"><button class="pl-partager">Partager mes sites (${mesSites.length})</button></div>`);
        c.querySelector('.pl-partager').onclick = async () => {
          if (!mesSites.length) { app.occupe(true, 'Aucun site ajouté pour l\'instant'); setTimeout(() => app.occupe(false), 2200); return; }
          const url = lienSites();
          if (navigator.share) { try { await navigator.share({ title: 'Sites de plongée', url }); } catch (e) { } } else { try { await navigator.clipboard.writeText(url); app.occupe(true, 'Lien copié'); setTimeout(() => app.occupe(false), 1800); } catch (e) { prompt('Lien à copier', url); } }
        };
        lister(); app.suivre(q, lister);
      };
      q.toucher = async (app, ll) => {
        const p = map.project(ll), f = map.queryRenderedFeatures([[p.x - 16, p.y - 16], [p.x + 16, p.y + 16]], { layers: ['pl-sites'] })[0];
        if (f) { const s = tousSites().find(t => t.id === f.properties.id); if (s) { app.bulle({ lng: s.c[0], lat: s.c[1] }, `<span class="fort">${propre(s.nom)}</span>`); decrire(s); } return; }
        const z = await altitude(ll.lng, ll.lat); if (z !== z || z >= 0) { app.bulle(ll, 'À terre ou hors du secteur'); return; }
        app.bulle(ll, `<span class="fort">${m(-z)}</span> de fond<small><button class="pl-ajout" style="margin-top:6px">Ajouter un site ici</button></small>`);
        setTimeout(() => { const b = document.querySelector('.bulle .pl-ajout'); if (b) b.onclick = () => { const nom = (prompt('Nom du site', 'Site à ' + m(-z)) || '').trim(); if (!nom) return; const s = { nom, c: [+ll.lng.toFixed(6), +ll.lat.toFixed(6)] }; mesSites.push(s); garde.ecrire(SITES_CLE, mesSites); dessinerSites(); lister(); app.sansBulle(); q._c.querySelector('.pl-partager').textContent = `Partager mes sites (${mesSites.length})`; decrire(tousSites().find(t => t.p === s)); }; }, 0);
      };
      q.plein = () => ({ bloc: ['.pl-liste', '.pl-detail'], consigne: 'Touche un site pour sa fiche, ou la mer pour en ajouter un.' });
      q.fermer = () => montrer(['pl-sites'], false);
      return q;
    })();

    // --- Parcours : par où passer ? ---
    themes.parcours = (() => {
      const CLE = 'cartes.plongee.parcours';
      let pts = garde.lire(CLE, []), tour = 0;
      const q = { theme: 'Parcours', libelle: 'Par où passer ?', aide: aide.parcours, depart: null };
      const niv = () => garde.lire('cartes.plongee.niveau', 20);
      const dessiner = () => {
        const d = { type: 'FeatureCollection', features: [] };
        if (pts.length > 1) d.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
        pts.forEach((p, i) => d.features.push({ type: 'Feature', properties: { n: i === 0 ? 'D' : String(i) }, geometry: { type: 'Point', coordinates: p } }));
        if (map.getSource('pl-parcours')) map.getSource('pl-parcours').setData(d);
        else {
          map.addSource('pl-parcours', { type: 'geojson', data: d });
          map.addLayer({ id: 'pl-parcours', type: 'line', source: 'pl-parcours', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f4e3b0', 'line-width': 3, 'line-dasharray': [2, 1.2] } });
          map.addLayer({ id: 'pl-parcours-pts', type: 'circle', source: 'pl-parcours', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#b8963e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        }
      };
      async function calculer(c) {
        const moi = ++tour, bloc = c.querySelector('.pl-prof');
        garde.ecrire(CLE, pts); dessiner();
        if (pts.length < 2) { c.querySelector('.etat').innerHTML = pts.length ? 'Touche la carte pour le point suivant.' : 'Touche la carte pour poser la mise à l\'eau, puis chaque point du parcours.'; bloc.innerHTML = ''; return; }
        c.querySelector('.etat').textContent = 'Lecture du fond…';
        const p = await profil(pts, 140); if (moi !== tour) return;
        const zs = p.points.map(x => x.z).filter(z => z === z), prof = Math.max(0, ...zs.map(z => -z)), L = niv(), trop = zs.filter(z => -z > L).length / Math.max(1, zs.length);
        const min = Math.round(p.total / 10);
        c.querySelector('.etat').innerHTML = `<span class="fort">${p.total < 1000 ? Math.round(p.total) + ' m' : fr(p.total / 1000, 2) + ' km'}</span>, fond le plus bas à <span class="fort">${m(prof)}</span> ; environ ${min} min de palmage tranquille${min > 45 ? ' : long pour une seule plongée' : ''}.${trop > 0 ? ` <span style="color:#e8be5a">${Math.round(trop * 100)} % du parcours passe sous ${L} m.</span>` : ''}`;
        bloc.innerHTML = svgProfil(p, L);
        app.survol.proposer('plongee', () => pts.length > 1 ? { pts: pts.slice() } : null);
      }
      q.ouvrir = async (app) => {
        ouvrir3d(); montrer(['pl-sites'], true);
        if (q.depart) { pts = [q.depart]; q.depart = null; }
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p><div class="pl-prof"></div>
          <div class="puces pl-niv">${[6, 20, 40, 60].map(v => `<button data-n="${v}" aria-pressed="${niv() === v}">${v} m</button>`).join('')}</div>
          <div class="puces"><button class="pl-annuler">Retirer le dernier point</button><button class="pl-raz">Effacer</button><button class="pl-retour">Boucler au départ</button><button class="pl-partage">Partager</button></div>`);
        c.querySelector('.pl-niv').onclick = e => { const b = e.target.closest('button[data-n]'); if (!b) return; garde.ecrire('cartes.plongee.niveau', +b.dataset.n); c.querySelectorAll('.pl-niv button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); calculer(c); };
        c.querySelector('.pl-annuler').onclick = () => { pts.pop(); calculer(c); };
        c.querySelector('.pl-raz').onclick = () => { pts = []; app.survol.retirer('plongee'); calculer(c); };
        c.querySelector('.pl-retour').onclick = () => { if (pts.length > 1) { pts.push(pts[0].slice()); calculer(c); } };
        c.querySelector('.pl-partage').onclick = async () => {
          if (pts.length < 2) return; const u = new URL(location.href); u.search = ''; u.searchParams.set('parcours', pts.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';')); u.searchParams.set('theme', 'Parcours');
          if (navigator.share) { try { await navigator.share({ title: 'Parcours de plongée', url: u.toString() }); } catch (e) { } } else { try { await navigator.clipboard.writeText(u.toString()); app.occupe(true, 'Lien copié'); setTimeout(() => app.occupe(false), 1800); } catch (e) { prompt('Lien à copier', u.toString()); } }
        };
        calculer(c);
        if (pts.length > 1) { const b = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: app.marges({ top: 90, bottom: 280, left: 50, right: 70 }), maxZoom: 17, duration: 900 }); }
      };
      q.toucher = (app, ll) => { pts.push([+ll.lng.toFixed(6), +ll.lat.toFixed(6)]); calculer(q._c); };
      q.plein = () => ({ bloc: '.pl-prof', boutons: ['.pl-annuler', '.pl-raz', '.pl-partage'], consigne: 'Touche la carte pour poser la mise à l\'eau, puis chaque point du parcours.' });
      q.fermer = () => { tour++; montrer(['pl-sites'], false); };   // le tracé reste visible sous les autres thèmes, on l'efface ici
      // Un parcours reçu par un lien.
      try { const p = new URLSearchParams(location.search).get('parcours'); if (p) { pts = p.split(';').map(s => s.split(',').map(Number)).filter(a => a.length === 2 && a.every(isFinite)); garde.ecrire(CLE, pts); } } catch (e) { }
      if (pts.length > 1) setTimeout(dessiner, 0);
      return q;
    })();

    // --- Niveaux : jusqu'où descendre ? ---
    themes.niveaux = (() => {
      const NIV = [[6, 'Baptême', 6], [20, 'Niveau 1', 20], [40, 'Niveau 2', 40], [60, 'Niveau 3', 60]];
      const q = { theme: 'Niveaux', libelle: 'Jusqu\'où descendre ?', aide: aide.niveaux };
      const maj = c => {
        const L = garde.lire('cartes.plongee.niveau', 20), n = NIV.find(x => x[0] === L) || NIV[1];
        map.setPaintProperty('pl-eau', 'color-relief-color', regleNiveau(L));
        c.querySelectorAll('.pl-niv button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.n === L)));
        c.querySelector('.etat').innerHTML = `${n[1]} : jusqu'à <span class="fort">${L} m</span>. En orangé, ce qui est plus profond ; la ligne d'or suit les ${L} m.`;
      };
      q.ouvrir = async (app) => {
        ouvrir3d();
        const c = q._c = app.repondre(q.libelle, `<p class="etat"></p><div class="puces pl-niv">${NIV.map(n => `<button data-n="${n[0]}">${n[1]} · ${n[0]} m</button>`).join('')}</div>
          <div class="legende"><span><i style="background:rgb(74,192,208)"></i>dans la limite</span><span><i style="background:#e8be5a"></i>la limite</span><span><i style="background:rgba(208,84,42,0.7)"></i>au-delà</span></div>`);
        c.querySelector('.pl-niv').onclick = e => { const b = e.target.closest('button[data-n]'); if (!b) return; garde.ecrire('cartes.plongee.niveau', +b.dataset.n); maj(c); };
        maj(c);
      };
      q.toucher = async (app, ll) => { const z = await altitude(ll.lng, ll.lat); if (z !== z || z >= 0) { app.bulle(ll, 'À terre ou hors du secteur'); return; } const L = garde.lire('cartes.plongee.niveau', 20); app.bulle(ll, `<span class="fort">${m(-z)}</span> de fond<small>${-z <= L ? 'dans la limite de ' + L + ' m' : 'au-delà de ' + L + ' m'}</small>`); };
      q.fermer = () => poserEau(niveau);
      return q;
    })();

    // --- Conditions : fait-il bon plonger ? ---
    themes.conditions = (() => {
      const q = { theme: 'Conditions', libelle: 'Fait-il bon plonger ?', aide: aide.conditions };
      let h = 0, M = null, tour = 0, derniere = null;
      const maintenant = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d; };
      const dateDe = k => new Date(maintenant().getTime() + k * 3600000);
      const jour = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: opts.fuseau });
      const heure = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: opts.fuseau });
      async function maj(c) {
        const moi = ++tour, d = dateDe(h);
        c.querySelector('.v-h').textContent = (h === 0 ? 'maintenant' : jour(d) + ' ' + heure(d));
        if (!M) { c.querySelector('.etat').textContent = 'Lecture des prévisions…'; M = await conditions(); if (moi !== tour) return; }
        if (!M) { c.querySelector('.etat').textContent = 'Les prévisions ne répondent pas pour l\'instant.'; return; }
        const r = lireHeure(M, isoHeure(d)); derniere = r; if (r.vague == null && r.vent == null) { c.querySelector('.etat').textContent = 'Pas de prévision pour cette heure.'; return; }
        const dir = dirMer(r), calme = r.vague != null && r.vague < 0.5 && (r.vent == null || r.vent < 12), agite = (r.vague != null && r.vague >= 1.2) || (r.vent != null && r.vent >= 20);
        c.querySelector('.etat').innerHTML = `${calme ? 'Mer calme' : agite ? 'Mer agitée' : 'Mer peu agitée'} : vagues <span class="fort">${r.vague != null ? fr(r.vague, 1) + ' m' : '?'}</span>${dir != null ? ' ' + duCap(dir) : ''}${r.vent != null ? `, vent <span class="fort">${Math.round(r.vent)} nœuds</span> ${duCap(r.dirVent)}` : ''}. En vert, les eaux abritées.`;
        c.querySelector('.pl-cond').innerHTML = `<div class="jours">${[
          ['Vagues', r.vague != null ? fr(r.vague, 1) + ' m' : '—', r.periode ? Math.round(r.periode) + ' s' : ''],
          ['Houle', r.houle != null ? fr(r.houle, 1) + ' m' : '—', r.dirHoule != null ? cardinal(r.dirHoule) : ''],
          ['Vent', r.vent != null ? Math.round(r.vent) + ' nd' : '—', r.rafales != null ? 'rafales ' + Math.round(r.rafales) : ''],
          ['Eau', r.eau != null ? Math.round(r.eau) + ' °C' : '—', r.courant != null ? 'courant ' + fr(r.courant / 1.852, 1) + ' nd' : '']].map(x => `<div><b>${x[0]}</b>${x[1]}<small style="display:block;color:var(--muted)">${x[2] || '&nbsp;'}</small></div>`).join('')}</div>`;
        if (dir != null && r.vague != null) { const ab = abri(dir); app.poser('pl-abri', { x0: S.versMerc(ab.b[0], ab.b[1])[0], y0: S.versMerc(ab.b[0], ab.b[1])[1], x1: S.versMerc(ab.b[2], ab.b[3])[0], y1: S.versMerc(ab.b[2], ab.b[3])[1] }, peindreAbri(ab, r.vague), 0.75); q._ab = ab; }
      }
      q.ouvrir = async (app) => {
        const c = q._c = app.repondre(q.libelle, `<p class="etat">Lecture des prévisions…</p>
          <div class="ligne"><label style="min-width:60px">Quand</label><input type="range" class="hh" min="0" max="84" step="1" value="${h}" style="flex:1"><span class="fort v-h" style="min-width:96px;text-align:right"></span></div>
          <div class="pl-cond"></div>
          <div class="legende"><span><i style="background:rgb(70,170,150)"></i>à l'abri</span><span><i style="background:rgb(190,200,110)"></i>peu exposé</span><span><i style="background:rgb(232,160,70)"></i>exposé</span><span><i style="background:rgb(222,104,66)"></i>très exposé</span></div>`);
        c.querySelector('.hh').oninput = e => { h = +e.target.value; maj(c); };
        map.setPaintProperty('pl-eau', 'color-relief-opacity', 0.8);
        await maj(c);
      };
      q.toucher = async (app, ll) => {
        const ab = q._ab, r = derniere; if (!ab || !r) return;
        const mm = lireMasque(), i = Math.floor((ll.lng - mm.b[0]) / (mm.b[2] - mm.b[0]) * mm.w), yM = l => Math.log(Math.tan((90 + l) * RAD / 2)), j = Math.floor((yM(mm.b[3]) - yM(ll.lat)) / (yM(mm.b[3]) - yM(mm.b[1])) * mm.h);
        const f = i >= 0 && j >= 0 && i < mm.w && j < mm.h ? ab.fetch[j * mm.w + i] : NaN;
        if (f !== f) { app.bulle(ll, 'À terre ou hors du secteur'); return; }
        app.bulle(ll, `<span class="fort">${exposition(f, r.vague)}</span><small>${f >= 12000 ? 'mer libre sur plus de 12 km' : 'eau libre sur ' + (f < 1000 ? Math.round(f / 10) * 10 + ' m' : fr(f / 1000, 1) + ' km')} ${versCap(dirMer(r))}</small>`);
      };
      q.plein = () => ({ bloc: '.pl-cond' });
      q.fermer = (app) => { tour++; app.retirer('pl-abri'); map.setPaintProperty('pl-eau', 'color-relief-opacity', 1); };
      return q;
    })();

    return { themes, altitude, especes: ESPECES };
  }

  window.Socle.plongee = { installer, especes: ESPECES };
})();
