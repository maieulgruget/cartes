/* Thème « Formes du relief » : chaque maille est comparée à l'altitude moyenne de son voisinage (indice de position
   topographique, Weiss 2001). Plus haute que ses voisines, c'est une crête ou un sommet ; plus basse, un fond de vallon ;
   entre les deux, un versant ou un replat selon la pente. Le rayon du voisinage fixe la taille des formes repérées. */
(function () {
  'use strict';
  const S = window.Socle;
  const CL = [['s', '#b5443a', 'crêtes et sommets', [181, 68, 58, 200]], ['h', '#e0a458', 'hauts de versant', [224, 164, 88, 170]], ['v', '#d9d2b8', 'versants', [217, 210, 184, 90]],
    ['r', '#8fbf8f', 'replats et plateaux', [143, 191, 143, 180]], ['b', '#6fa3c7', 'bas de versant', [111, 163, 199, 170]], ['f', '#2f5d8a', 'fonds de vallon', [47, 93, 138, 205]]];
  function formes(opts) {
    opts = opts || {}; let rayon = opts.rayon || 300; const memo = {}, masques = new Set();
    const q = {
      theme: 'Formes', libelle: 'Crête, versant ou fond de vallon ?',
      aide: 'Pour chaque maille, la carte compare son altitude à la moyenne des altitudes alentour, dans le rayon choisi. Nettement au-dessus : crête ou sommet. Nettement en dessous : fond de vallon. Entre les deux : haut ou bas de versant, et replat si la pente est faible (moins de 6°). Un petit rayon fait ressortir les croupes et les ravines, un grand rayon les grandes crêtes et les vallées. C\'est une lecture géométrique du relevé LiDAR de l\'IGN : elle ne dit rien de la nature du terrain.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, `<div class="ligne"><label>Taille des formes</label><div class="puces r">${[[100, 'fines'], [300, 'moyennes'], [800, 'grandes']].map(x => `<button data-r="${x[0]}" aria-pressed="${rayon === x[0]}">${x[1]}</button>`).join('')}</div></div><p class="etat">Touche la carte pour lire la forme d'un point.</p><div class="legende"></div>`);
        const dessiner = () => {
          const g = memo.g; if (!g || app.active !== q) return;
          const { z, w, h, pas } = g, r = Math.max(1, Math.round(rayon / pas)), W = w + 1;
          // sommes cumulées (altitudes et nombre de mailles valides) : la moyenne d'un carré se lit en quatre accès
          const som = new Float64Array(W * (h + 1)), nb = new Int32Array(W * (h + 1));
          for (let j = 0; j < h; j++) { let ls = 0, ln = 0; for (let i = 0; i < w; i++) { const v = z[j * w + i]; if (v === v) { ls += v; ln++; } som[(j + 1) * W + i + 1] = som[j * W + i + 1] + ls; nb[(j + 1) * W + i + 1] = nb[j * W + i + 1] + ln; } }
          const tpi = new Float32Array(w * h); let s2 = 0, n = 0;
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const k = j * w + i, v = z[k]; if (!(v === v)) { tpi[k] = NaN; continue; }
            const i0 = Math.max(0, i - r), i1 = Math.min(w, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(h, j + r + 1);
            const cnt = nb[j1 * W + i1] - nb[j0 * W + i1] - nb[j1 * W + i0] + nb[j0 * W + i0], tot = som[j1 * W + i1] - som[j0 * W + i1] - som[j1 * W + i0] + som[j0 * W + i0];
            tpi[k] = v - tot / Math.max(1, cnt); s2 += tpi[k] * tpi[k]; n++;
          }
          const et = Math.sqrt(s2 / Math.max(1, n)) || 1, pente = memo.a.pente, classe = new Uint8Array(w * h);
          for (let k = 0; k < w * h; k++) { const t = tpi[k] / et; classe[k] = !(t === t) ? 255 : t > 1 ? 0 : t < -1 ? 5 : t > 0.5 ? 1 : t < -0.5 ? 4 : pente[k] < 6 ? 3 : 2; }
          memo.classe = classe;
          app.poser('formes', g, app.peindre(g, k => { const cl = classe[k]; return cl === 255 || masques.has(CL[cl][0]) ? null : CL[cl][3]; }));
        };
        app.legende(c, CL.map(x => ({ cle: x[0], couleur: x[1], texte: x[2] })), dessiner, masques);
        const recharger = async () => {
          const b = app.emprise(0.15), cle = b.map(v => v.toFixed(4)).join();
          if (memo.cle !== cle) { app.occupe(true, 'Lecture du relief…'); memo.g = await app.grille(b, 460); memo.a = app.pentes(memo.g); memo.cle = cle; app.occupe(false); }
          dessiner();
        };
        c.querySelector('.r').onclick = e => { const v = +e.target.dataset.r; if (!v) return; rayon = v; c.querySelectorAll('.r button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === v)); dessiner(); };
        app.suivre(q, recharger); await recharger();
      },
      toucher(app, ll) {
        const g = memo.g, k = g ? app.indice(g, ll.lng, ll.lat) : -1; if (k < 0 || !memo.classe || memo.classe[k] === 255) return;
        document.querySelector('.reponse .etat').innerHTML = `Ici, à <span class="fort">${Math.round(g.z[k])} m</span> : <span class="fort">${CL[memo.classe[k]][2]}</span>, pente de ${Math.round(memo.a.pente[k])}°.`;
      },
      fermer(app) { app.retirer('formes'); }
    };
    return q;
  }
  S.formes = formes;
})();
