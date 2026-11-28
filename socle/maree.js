/* Marée : la hauteur de la mer à un instant quelconque, en altitude (zéro des cartes terrestres, IGN 69).
   Même méthode que la carte Marées (dont ce module reprend le calcul) : on lit un an de hauteurs horaires du modèle
   d'Open-Meteo au point de référence le plus proche, on y ajuste 23 ondes de marée par moindres carrés, et la marée
   astronomique se prolonge alors à n'importe quelle date. Dans la fenêtre du modèle (jusqu'à une semaine devant), on
   garde ses valeurs, qui tiennent compte du temps qu'il fait. Contrôle fait sur 30 jours tenus à l'écart : écart type
   de 18 cm, 60 cm au pire. Ce n'est pas l'annuaire du Shom : un ordre de grandeur fiable, pas un horaire officiel.

   Socle.maree.creer(app, { refs: [{ nom, p: [lon, lat] }], decal }) → { lire(), niveau(s, t), extremes(s, t0, t1), calculee(s, t) }
   decal : niveau moyen de la mer au-dessus du zéro IGN 69 sur cette côte. */
(function () {
  'use strict';
  const ONDES = [28.9841042, 30, 28.4397295, 30.0821373, 15.0410686, 13.9430356, 14.9589314, 13.3986609, 57.9682084, 58.9841042, 57.4238337, 86.9523127,
    29.5284789, 27.8953548, 27.9682084, 28.5125831, 29.9589333, 87.9682084, 43.4761563, 0.0410686, 0.0821373, 0.5443747, 1.0980331].map(v => v * Math.PI / 180);   // radians par heure
  function ajuster(tt, hh) {
    const n = 2 * ONDES.length + 1, A = Array.from({ length: n }, () => new Float64Array(n + 1)), ligne = new Float64Array(n), t0 = tt[0];
    for (let k = 0; k < tt.length; k++) {
      if (hh[k] !== hh[k]) continue; const x = (tt[k] - t0) / 36e5; ligne[0] = 1;
      for (let o = 0; o < ONDES.length; o++) { ligne[1 + 2 * o] = Math.cos(ONDES[o] * x); ligne[2 + 2 * o] = Math.sin(ONDES[o] * x); }
      for (let a = 0; a < n; a++) { const la = ligne[a], Aa = A[a]; for (let b = a; b < n; b++) Aa[b] += la * ligne[b]; Aa[n] += la * hh[k]; }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    for (let c = 0; c < n; c++) {   // élimination de Gauss avec pivot
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; const d = A[c][c]; if (Math.abs(d) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / d; if (f) for (let b = c; b <= n; b++) A[r][b] -= f * A[c][b]; }
    }
    return { t0, c: A.map((l, a) => l[n] / l[a]) };
  }
  function predire(m, t) { const x = (t - m.t0) / 36e5; let v = m.c[0]; for (let o = 0; o < ONDES.length; o++) v += m.c[1 + 2 * o] * Math.cos(ONDES[o] * x) + m.c[2 + 2 * o] * Math.sin(ONDES[o] * x); return v; }
  const iso = d => d.toISOString().slice(0, 10);

  function creer(app, opts) {
    const series = new Map(), decal = opts.decal || 0;
    // Série du point de référence le plus proche du centre de la carte (lue une fois, puis gardée).
    async function lire() {
      const c = app.map.getCenter(), ref = opts.refs.reduce((a, b) => app.distKm([c.lng, c.lat], a.p) < app.distKm([c.lng, c.lat], b.p) ? a : b);
      if (!series.has(ref.nom)) {
        series.set(ref.nom, (async () => {
          const j = await app.meteo(`https://marine-api.open-meteo.com/v1/marine?latitude=${ref.p[1]}&longitude=${ref.p[0]}&hourly=sea_level_height_msl&timezone=GMT&start_date=${iso(new Date(Date.now() - 365 * 864e5))}&end_date=${iso(new Date(Date.now() + 6 * 864e5))}`);
          const v = j && j.hourly && j.hourly.sea_level_height_msl;
          if (!v || !v.some(x => x != null)) return null;
          const tt = j.hourly.time.map(s => Date.parse(s + ':00Z')), hh = v.map(x => x == null ? NaN : x + decal);
          let fin = hh.length - 1; while (fin > 0 && hh[fin] !== hh[fin]) fin--;
          return { ref, t: tt, h: hh, fin: tt[fin], modele: ajuster(tt, hh) };
        })());
      }
      return series.get(ref.nom);
    }
    function niveau(s, t) {
      const i = Math.floor((t - s.t[0]) / 36e5);
      if (i < 1 || t > s.fin - 2 * 36e5 || !(s.h[i] === s.h[i])) return s.modele ? predire(s.modele, t) : NaN;   // hors de la fenêtre du modèle : marée calculée
      const f = (t - s.t[i]) / 36e5, p0 = s.h[i - 1], p1 = s.h[i], p2 = s.h[i + 1], p3 = s.h[Math.min(s.h.length - 1, i + 2)];
      return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);   // courbe lissée passant par les valeurs horaires
    }
    const calculee = (s, t) => t > s.fin - 2 * 36e5 || t < s.t[1];
    // Pleines et basses mers entre deux instants : { t, h, pm }.
    function extremes(s, t0, t1) {
      const r = []; let av = niveau(s, t0), sens = 0;
      for (let t = t0 + 6e5; t <= t1; t += 6e5) { const v = niveau(s, t), ns = Math.sign(v - av); if (sens && ns && ns !== sens) r.push({ t: t - 6e5, h: av, pm: sens > 0 }); if (ns) sens = ns; av = v; }
      return r;
    }
    return { lire, niveau, extremes, calculee };
  }
  window.Socle.maree = { creer };
})();
