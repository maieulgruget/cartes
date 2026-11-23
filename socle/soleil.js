/* Questions de lumière, communes à plusieurs cartes : ombres portées à une heure donnée, heures de soleil d'un point,
   directions du lever et du coucher. Les ombres sont calculées sur la grille d'altitudes de la vue ;
   en vue rapprochée, on prend le modèle de surface (arbres et bâtiments compris). */
(function () {
  'use strict';
  const S = window.Socle, ROSE = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const cap = az => ROSE[Math.round(az / 45) % 8];
  const hm = min => { min = Math.round(min); return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`; };

  // Décalage (minutes) du fuseau par rapport à UTC à un instant donné.
  function decalage(fuseau, date) {
    const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(date).forEach(x => { p[x.type] = +x.value; });
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 6e4) * 6e4) / 6e4;
  }
  // Instant correspondant à une date (aaaa-mm-jj) et une heure locale (minutes) dans le fuseau.
  function instant(fuseau, jour, minutes) {
    const [a, m, j] = jour.split('-').map(Number), brut = Date.UTC(a, m - 1, j, 0, minutes);
    return new Date(brut - decalage(fuseau, new Date(brut)) * 6e4);
  }
  function maintenant(fuseau) {
    const d = new Date(), loc = new Date(d.getTime() + decalage(fuseau, d) * 6e4);
    return { jour: loc.toISOString().slice(0, 10), minutes: loc.getUTCHours() * 60 + Math.floor(loc.getUTCMinutes() / 10) * 10 };
  }
  const etat = { jour: null, minutes: null };   // date et heure partagées entre les questions

  async function charger(app, memo) {
    const b = app.emprise(0.2), surface = app.map.getZoom() >= 13.3;
    const cle = b.map(v => v.toFixed(4)).join() + surface;
    if (memo.cle !== cle) { app.occupe(true, 'Lecture du relief…'); memo.g = await app.grille(b, 420, { surface }); memo.cle = cle; app.occupe(false); }
    return memo.g;
  }
  function entete(fuseau) {
    if (!etat.jour) Object.assign(etat, maintenant(fuseau));
    return `<div class="ligne"><input type="date" class="jour" value="${etat.jour}"><span class="fort heure"></span><button class="now">Maintenant</button></div>`;
  }
  // Le bouton « Maintenant » ramène la date et l'heure à l'instant présent, puis relance le calcul.
  function brancherMaintenant(c, fuseau, apres) {
    c.querySelector('.now').onclick = () => { Object.assign(etat, maintenant(fuseau)); c.querySelector('.jour').value = etat.jour; const h = c.querySelector('.h'); if (h) h.value = etat.minutes; apres(); };
  }

  /* « Où est la lumière à cette heure ? » */
  function lumiere(opts) {
    const memo = {}, q = {
      theme: opts.theme || 'Lumière', libelle: opts.libelle || 'Où est la lumière à cette heure ?',
      aide: 'Ombres portées par le relief à la date et à l\'heure choisies : pour chaque maille, la carte remonte un rayon vers le soleil et regarde si le terrain le coupe. En vue rapprochée, elle prend le relevé de surface, donc les arbres et les bâtiments portent ombre. La position du soleil est calculée à un demi-degré près ; les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<input type="range" class="h" min="0" max="1430" step="10" value="${etat.minutes}">
          <p class="etat"></p><div class="legende"><span><i style="background:#060a14"></i>à l'ombre</span><span><i style="background:#e9c46a"></i>lumière rasante (soleil sous 12°)</span></div>
          <p class="petit">${opts.note || ''} Touche la carte pour connaître les heures de soleil d'un point.</p>`);
        const jour = c.querySelector('.jour'), h = c.querySelector('.h'), txt = c.querySelector('.etat'), heure = c.querySelector('.heure');
        let prevu = false;
        const dessiner = () => {
          prevu = false; const g = memo.g; if (!g || app.active !== q) return;
          const centre = app.map.getCenter(), s = app.soleil(instant(opts.fuseau, etat.jour, etat.minutes), centre.lat, centre.lng);
          heure.textContent = hm(etat.minutes);
          if (s.hauteur <= 0) { txt.textContent = 'Le soleil est sous l\'horizon.'; app.poser('ombres', g, app.peindre(g, () => [4, 8, 18, 150])); return; }
          const o = app.ombres(g, s.azimut, s.hauteur), rasant = s.hauteur < 12;
          let n = 0; for (let k = 0; k < o.length; k++) n += o[k];
          app.poser('ombres', g, app.peindre(g, k => o[k] ? [4, 8, 18, 165] : (rasant ? [233, 196, 106, 70] : null)));
          txt.innerHTML = `Soleil au <span class="fort">${cap(s.azimut)}</span> (${Math.round(s.azimut)}°), à <span class="fort">${Math.round(s.hauteur)}°</span> au-dessus de l'horizon. ${Math.round(100 * n / o.length)} % de la vue est à l'ombre${g.surface ? ', arbres et bâtiments compris' : ' (relief seul : zoome pour compter les arbres)'}.`;
        };
        const demander = () => { if (!prevu) { prevu = true; requestAnimationFrame(dessiner); } };
        const recharger = async () => { await charger(app, memo); demander(); };
        h.oninput = () => { etat.minutes = +h.value; demander(); };
        jour.onchange = () => { if (jour.value) { etat.jour = jour.value; demander(); } };
        brancherMaintenant(c, opts.fuseau, demander);
        app.suivre(q, recharger);
        await recharger();
      },
      toucher(app, ll) { heuresDeSoleil(app, memo.g, ll, opts, document.querySelector('.reponse .etat')); },
      fermer(app) { app.retirer('ombres', 'pointsoleil'); }
    };
    return q;
  }

  // Relief lointain autour d'un point : une grille large (25 km de part et d'autre, maille d'une centaine de mètres),
  // lue une fois par secteur, pour que les crêtes hors de la vue comptent dans les heures de soleil.
  const lointain = new Map();
  async function horizon(app, ll) {
    const cle = ll.lng.toFixed(1) + ',' + ll.lat.toFixed(1);
    if (!lointain.has(cle)) lointain.set(cle, app.grille([ll.lng - 0.36, ll.lat - 0.25, ll.lng + 0.36, ll.lat + 0.25], 560).catch(() => null));
    return lointain.get(cle);
  }
  // Heures de soleil d'un point sur la journée choisie, par pas de 5 minutes.
  async function heuresDeSoleil(app, g, ll, opts, cible) {
    if (!g || !cible) return;
    const k = app.indice(g, ll.lng, ll.lat); if (k < 0) { cible.textContent = 'Ce point est hors de la zone calculée : recentre la carte.'; return; }
    app.occupe(true, 'Lecture des crêtes alentour…'); const gl = await horizon(app, ll), kl = gl ? app.indice(gl, ll.lng, ll.lat) : -1; app.occupe(false);
    const plages = []; let debut = null, total = 0;
    for (let m = 0; m <= 1440; m += 5) {
      const s = app.soleil(instant(opts.fuseau, etat.jour, m), ll.lat, ll.lng), oui = m < 1440 && app.eclaire(g, k, s.azimut, s.hauteur) && (kl < 0 || app.eclaire(gl, kl, s.azimut, s.hauteur));
      if (oui && debut == null) debut = m; if (!oui && debut != null) { plages.push([debut, m]); total += m - debut; debut = null; }
    }
    const d = { type: 'Feature', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } };
    if (app.map.getSource('pointsoleil')) app.map.getSource('pointsoleil').setData(d);
    else { app.map.addSource('pointsoleil', { type: 'geojson', data: d }); app.map.addLayer({ id: 'pointsoleil', type: 'circle', source: 'pointsoleil', paint: { 'circle-radius': 7, 'circle-color': '#b8963e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }); }
    cible.innerHTML = plages.length
      ? `Ce point (${Math.round(g.z[k])} m) est au soleil ${plages.map(p => `de <span class="fort">${hm(p[0])}</span> à <span class="fort">${hm(p[1])}</span>`).join(', puis ')}, soit ${hm(total)} le ${etat.jour.split('-').reverse().join('/')}. <span class="petit">${gl ? 'Crêtes comptées jusqu\'à 25 km.' : 'Les crêtes lointaines n\'ont pas pu être lues.'}</span>`
      : `Ce point ne reçoit pas le soleil le ${etat.jour.split('-').reverse().join('/')}.`;
  }

  /* « Quand ce versant s'éclaire-t-il ? » : la même analyse, en entrée directe. */
  function versant(opts) {
    const memo = {}, q = {
      theme: opts.theme || 'Versant', libelle: opts.libelle || 'Quand ce versant s\'éclaire-t-il ?',
      aide: 'Heures de soleil du point touché sur la journée choisie, par pas de cinq minutes, en comptant les crêtes jusqu\'à 25 km. Précision de l\'ordre de dix minutes ; les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<p class="etat">Touche un point de la carte : un versant, un sommet, un fond de cirque.</p>`);
        c.querySelector('.heure').textContent = '';
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; if (q.dernier) q.toucher(app, q.dernier); } };
        brancherMaintenant(c, opts.fuseau, () => { if (q.dernier) q.toucher(app, q.dernier); });
        const recharger = () => charger(app, memo); app.suivre(q, recharger); await recharger();
      },
      toucher(app, ll) { q.dernier = ll; heuresDeSoleil(app, memo.g, ll, opts, document.querySelector('.reponse .etat')); },
      fermer(app) { q.dernier = null; app.retirer('pointsoleil'); }
    };
    return q;
  }

  /* « Où se lève et se couche le soleil ? » : directions depuis le centre de la carte, heures du lever, du coucher et des lumières dorées. */
  function leverCoucher(opts) {
    const q = {
      theme: opts.theme || 'Lever et coucher', libelle: opts.libelle || 'Où se lève et se couche le soleil ?',
      aide: 'Directions et heures du lever, du coucher et du point le plus haut du soleil, sur un horizon plat, depuis le point touché. Une crête retarde le lever et avance le coucher : le thème Versant donne les heures réelles.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<p class="etat"></p><div class="legende"><span><i style="background:#f4a261"></i>lever</span><span><i style="background:#e76f51"></i>coucher</span><span><i style="background:#e9c46a"></i>midi solaire</span></div><p class="petit">Touche la carte pour choisir le point d'où partent les directions ; sans cela, elles partent du centre. Elles sont tracées sur un horizon plat : une crête retarde le lever et avance le coucher (le thème Versant donne les heures réelles).</p>`);
        c.querySelector('.heure').textContent = '';
        const dessiner = () => {
          const ct = q.point || app.map.getCenter(); let lever = null, coucher = null, midi = null, hmax = -90, dore = [];
          let avant = app.soleil(instant(opts.fuseau, etat.jour, 0), ct.lat, ct.lng);
          for (let m = 2; m <= 1440; m += 2) {
            const s = app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng);
            if (avant.hauteur <= 0 && s.hauteur > 0) lever = { m, az: s.azimut };
            if (avant.hauteur > 0 && s.hauteur <= 0) coucher = { m, az: s.azimut };
            if ((avant.hauteur < 6) !== (s.hauteur < 6) && s.hauteur > -1) dore.push(m);
            if (s.hauteur > hmax) { hmax = s.hauteur; midi = { m, az: s.azimut }; }
            avant = s;
          }
          const km = 40000 / Math.pow(2, app.map.getZoom()) * 0.6, trait = (az, coul) => {
            const dlat = km / 111.2 * Math.cos(az * Math.PI / 180), dlon = km / 111.2 * Math.sin(az * Math.PI / 180) / Math.cos(ct.lat * Math.PI / 180);
            return { type: 'Feature', properties: { coul }, geometry: { type: 'LineString', coordinates: [[ct.lng, ct.lat], [ct.lng + dlon, ct.lat + dlat]] } };
          };
          const fc = { type: 'FeatureCollection', features: [lever && trait(lever.az, '#f4a261'), coucher && trait(coucher.az, '#e76f51'), midi && trait(midi.az, '#e9c46a')].filter(Boolean) };
          if (app.map.getSource('axes')) app.map.getSource('axes').setData(fc);
          else { app.map.addSource('axes', { type: 'geojson', data: fc }); app.map.addLayer({ id: 'axes', type: 'line', source: 'axes', paint: { 'line-color': ['get', 'coul'], 'line-width': 3.5, 'line-opacity': 0.95 } }); }
          c.querySelector('.etat').innerHTML = (lever && coucher)
            ? `Lever à <span class="fort">${hm(lever.m)}</span> au ${cap(lever.az)} (${Math.round(lever.az)}°), coucher à <span class="fort">${hm(coucher.m)}</span> au ${cap(coucher.az)} (${Math.round(coucher.az)}°). Au plus haut à ${hm(midi.m)} : ${Math.round(hmax)}° côté ${cap(midi.az)}.${dore.length >= 2 ? ` Lumière dorée (soleil sous 6°) jusqu'à ${hm(dore[0])} et à partir de ${hm(dore[dore.length - 1])}.` : ''}`
            : 'Pas de lever ni de coucher ce jour-là à cet endroit.';
        };
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; dessiner(); } };
        q.redessiner = dessiner;
        brancherMaintenant(c, opts.fuseau, dessiner);
        app.suivre(q, dessiner); dessiner();
      },
      toucher(app, ll) { q.point = ll; q.redessiner && q.redessiner(); },
      fermer(app) { q.point = null; app.retirer('axes'); }
    };
    return q;
  }

  /* « Combien d'heures de soleil ? » : durée d'ensoleillement de chaque point sur la journée choisie, relief compris. */
  function duree(opts) {
    const memo = {}, q = {
      theme: opts.theme || 'Ensoleillement', libelle: opts.libelle || 'Combien d\'heures de soleil ?',
      aide: 'Durée d\'ensoleillement de chaque maille sur la journée choisie, par pas de vingt minutes, relief compris. Le relief hors de la vue n\'est pas compté dans cette carte d\'ensemble : pour un point précis, le thème Versant est plus juste.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<p class="etat"></p>
          <div class="legende"></div>
          <p class="petit">${opts.noteDuree || ''} Calcul par pas de 20 minutes sur la vue affichée ; le relief hors de la vue n'est pas compté. Touche un point pour ses heures exactes.</p>`);
        c.querySelector('.heure').textContent = '';
        const RAMPE = [[0, 11, 23, 48], [2, 61, 90, 128], [4, 152, 193, 217], [6, 233, 196, 106], [8, 244, 162, 97], [10, 255, 243, 196]];
        const teinte = h => { for (let i = 1; i < RAMPE.length; i++) if (h <= RAMPE[i][0]) { const a = RAMPE[i - 1], b = RAMPE[i], f = (h - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, 185]; } return [255, 243, 196, 185]; };
        const tranche = h => String(Math.min(10, Math.round(h / 2) * 2));
        const peindreDuree = () => { const g = memo.g; if (g && app.active === q) app.poser('duree', g, app.peindre(g, k => (g.z[k] === g.z[k] && !masques.has(tranche(memo.cumul[k]))) ? teinte(memo.cumul[k]) : null)); };
        const masques = app.legende(c, [['0', '#0b1730', 'moins d\'1 h'], ['2', '#3d5a80', '2 h'], ['4', '#98c1d9', '4 h'], ['6', '#e9c46a', '6 h'], ['8', '#f4a261', '8 h'], ['10', '#fff3c4', '9 h et plus']].map(x => ({ cle: x[0], couleur: x[1], texte: x[2] })), peindreDuree, memo.masques || (memo.masques = new Set()));
        const calculer = async () => {
          const b = app.emprise(0.15), surface = app.map.getZoom() >= 13.3, cle = b.map(v => v.toFixed(4)).join() + surface + etat.jour;
          if (memo.cle === cle) return;
          app.occupe(true, 'Lecture du relief…'); const g = await app.grille(b, 300, { surface });
          app.occupe(true, 'Calcul de l\'ensoleillement…'); await new Promise(r => setTimeout(r, 40));
          const n = g.w * g.h, cumul = new Float32Array(n), ct = app.map.getCenter();
          for (let m = 0; m < 1440; m += 20) {
            const s = app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng); if (s.hauteur <= 0.5) continue;
            for (let k = 0; k < n; k++) if (app.eclaire(g, k, s.azimut, s.hauteur)) cumul[k] += 1 / 3;
          }
          if (app.active !== q) { app.occupe(false); return; }
          let max = 0, som = 0, nb = 0; for (let k = 0; k < n; k++) if (g.z[k] === g.z[k]) { if (cumul[k] > max) max = cumul[k]; som += cumul[k]; nb++; }
          memo.g = g; memo.cumul = cumul; memo.cle = cle;
          peindreDuree();
          c.querySelector('.etat').innerHTML = `Le ${etat.jour.split('-').reverse().join('/')} : jusqu'à <span class="fort">${hm(max * 60)}</span> de soleil sur les points les mieux exposés, ${hm(som / Math.max(1, nb) * 60)} en moyenne sur la vue${g.surface ? ' (arbres et bâtiments compris)' : ''}.`;
          app.occupe(false);
        };
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; calculer(); } };
        brancherMaintenant(c, opts.fuseau, calculer);
        app.suivre(q, calculer); await calculer();
      },
      toucher(app, ll) { heuresDeSoleil(app, memo.g, ll, opts, document.querySelector('.reponse .etat')); },
      fermer(app) { app.retirer('duree', 'pointsoleil'); }
    };
    return q;
  }

  /* « Où la lumière est-elle rasante ? » : pour la photo, ce qui compte est l'heure et l'angle de la lumière, pas sa durée.
     Chaque maille est classée selon qu'elle reçoit le soleil bas (moins de 12°) le matin, le soir, les deux, ou jamais. */
  function rasante(opts) {
    const memo = {}, masques = new Set(); let tour = 0;
    const COUL = { m: [244, 162, 97, 200], s: [157, 78, 221, 200], d: [255, 224, 102, 220], j: [6, 10, 20, 140] };
    const q = {
      theme: opts.theme || 'Rasante', libelle: opts.libelle || 'Où la lumière est-elle rasante ?',
      aide: 'Pour la journée choisie, la carte cherche les moments où le soleil est à moins de 12° au-dessus de l\'horizon, le matin puis le soir, par pas de dix minutes, et regarde pour chaque maille si le relief laisse passer ce soleil bas. Orange : lumière rasante le matin ; violet : le soir ; jaune : les deux ; sombre : jamais, le relief fait masque. Seul le relief de la vue (élargie d\'un cinquième) est compté : une crête lointaine hors de la carte peut encore masquer. Les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<p class="etat">Calcul…</p><div class="legende"></div>
          <p class="petit">${opts.noteRasante || ''} Touche les niveaux de la légende pour n'en garder qu'un.</p>`);
        c.querySelector('.heure').textContent = '';
        const peindre = () => { const g = memo.g, cl = memo.classes; if (!g || !cl || app.active !== q) return; app.poser('rasante', g, app.peindre(g, k => { const x = cl[k]; return x && !masques.has(x) ? COUL[x] : null; })); };
        app.legende(c, [{ cle: 'm', couleur: '#f4a261', texte: 'rasante le matin' }, { cle: 's', couleur: '#9d4edd', texte: 'rasante le soir' }, { cle: 'd', couleur: '#ffe066', texte: 'matin et soir' }, { cle: 'j', couleur: '#060a14', texte: 'jamais' }], peindre, masques);
        const calculer = async () => {
          const moi = ++tour; const b = app.emprise(0.2), cle = b.map(v => v.toFixed(4)).join();
          if (memo.cleG !== cle) { app.occupe(true, 'Lecture du relief…'); memo.g = await app.grille(b, 300); memo.cleG = cle; app.occupe(false); }
          if (moi !== tour || app.active !== q) return;
          const g = memo.g, ct = app.map.getCenter(), n = g.w * g.h, matin = new Uint8Array(n), soir = new Uint8Array(n), pas = [];
          for (let m = 0; m < 1440; m += 10) { const s = app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng); if (s.hauteur > 2 && s.hauteur < 12) pas.push({ m, s, matin: s.azimut < 180 }); }
          app.occupe(true, 'Calcul de la lumière rasante…');
          for (const p of pas) {
            await new Promise(r => setTimeout(r, 0)); if (moi !== tour || app.active !== q) { app.occupe(false); return; }
            const o = app.ombres(g, p.s.azimut, p.s.hauteur), cible = p.matin ? matin : soir; for (let k = 0; k < n; k++) if (!o[k]) cible[k] = 1;
          }
          app.occupe(false);
          const cl = new Array(n), cpt = { m: 0, s: 0, d: 0, j: 0 };
          for (let k = 0; k < n; k++) { if (!(g.z[k] === g.z[k]) || g.z[k] <= 0.5) { cl[k] = null; continue; } const x = matin[k] && soir[k] ? 'd' : matin[k] ? 'm' : soir[k] ? 's' : 'j'; cl[k] = x; cpt[x]++; }
          // Lissage : chaque maille prend la classe la plus fréquente de ses neuf voisines (le soleil très bas fait
          // ressortir le grain du relevé en fines rayures, qui ne veulent rien dire).
          const lisse = cl.slice(), W = g.w, H = g.h, ord = ['j', 'm', 's', 'd'];
          for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; if (!cl[k]) continue; const v = [0, 0, 0, 0]; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = cl[k + dj * W + di]; if (x) v[ord.indexOf(x)]++; } let best = 0; for (let n = 1; n < 4; n++) if (v[n] > v[best]) best = n; lisse[k] = ord[best]; }
          for (const x in cpt) cpt[x] = 0; for (let k = 0; k < n; k++) if (lisse[k]) cpt[lisse[k]]++;
          memo.classes = lisse; peindre();
          const tot = cpt.m + cpt.s + cpt.d + cpt.j || 1, mm = pas.filter(p => p.matin), ss = pas.filter(p => !p.matin);
          c.querySelector('.etat').innerHTML = pas.length ? `Soleil bas ${mm.length ? `le matin de <span class="fort">${hm(mm[0].m)}</span> à <span class="fort">${hm(mm[mm.length - 1].m + 10)}</span>` : ''}${mm.length && ss.length ? ', ' : ''}${ss.length ? `le soir de <span class="fort">${hm(ss[0].m)}</span> à <span class="fort">${hm(ss[ss.length - 1].m + 10)}</span>` : ''}. Sur les terres de la vue : ${Math.round(100 * cpt.m / tot)} % éclairées le matin seulement, ${Math.round(100 * cpt.s / tot)} % le soir seulement, ${Math.round(100 * cpt.d / tot)} % aux deux, ${Math.round(100 * cpt.j / tot)} % jamais.` : 'Pas de soleil bas ce jour-là.';
        };
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; calculer(); } };
        brancherMaintenant(c, opts.fuseau, calculer);
        app.suivre(q, calculer); await calculer();
      },
      fermer(app) { tour++; app.retirer('rasante'); }
    };
    return q;
  }

  /* « Par où passe le soleil ? » : un anneau autour du point touché, orienté comme la carte. L'arc du soleil y est tracé
     heure par heure : doré pendant l'heure dorée, clair ensuite, interrompu là où le relief masque le soleil. */
  function anneau(opts) {
    const memo = {}; let tour = 0;
    const q = {
      theme: opts.theme || 'Soleil', libelle: opts.libelle || 'Par où passe le soleil ?',
      aide: 'L\'anneau est centré sur le point touché et orienté comme la carte : chaque position sur l\'anneau est la direction du soleil à une heure de la journée. Trait doré : soleil visible et bas (moins de 6°, l\'heure dorée) ; trait clair : soleil visible plus haut ; trait gris fin : le soleil est levé mais caché par le relief, compté jusqu\'à 25 km. Le petit soleil suit le curseur d\'heure. Les heures sont calculées par pas de cinq minutes ; les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<input type="range" class="h" min="0" max="1435" step="5" value="${etat.minutes}">
          <p class="etat">Touche un point de vue : la carte calcule son soleil sur la journée.</p>
          <div class="legende"><span><i style="background:#e9a23b"></i>heure dorée</span><span><i style="background:#fff3c4"></i>soleil visible</span><span><i style="background:#8b93a3"></i>masqué par le relief</span></div>`);
        q._c = c;
        c.querySelector('.h').oninput = e => { etat.minutes = +e.target.value; q.soleilMobile(app); };
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; q.tracer(app); } };
        brancherMaintenant(c, opts.fuseau, () => q.tracer(app));
        const recharger = async () => { await charger(app, memo); if (!q.point) q.point = app.map.getCenter(); q.tracer(app); };
        app.suivre(q, recharger); await recharger();
      },
      position(app, az) {
        const ct = q.point, km = 40000 / Math.pow(2, app.map.getZoom()) * 0.2;
        return [ct.lng + km / 111.2 * Math.sin(az * Math.PI / 180) / Math.cos(ct.lat * Math.PI / 180), ct.lat + km / 111.2 * Math.cos(az * Math.PI / 180)];
      },
      async tracer(app) {
        const c = q._c, ct = q.point, g = memo.g, moi = ++tour; if (!ct || !g) return;
        const k = app.indice(g, ct.lng, ct.lat);
        app.occupe(true, 'Lecture des crêtes alentour…'); const gl = await horizon(app, ct), kl = gl ? app.indice(gl, ct.lng, ct.lat) : -1; app.occupe(false);
        if (moi !== tour || app.active !== q) return;
        const pas = []; for (let m = 0; m <= 1440; m += 5) { const s = app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng); pas.push({ m, s, vu: s.hauteur > 0 && (k < 0 || app.eclaire(g, k, s.azimut, s.hauteur)) && (kl < 0 || app.eclaire(gl, kl, s.azimut, s.hauteur)) }); }
        const fc = { type: 'FeatureCollection', features: [] };
        fc.features.push({ type: 'Feature', properties: { r: 'cercle' }, geometry: { type: 'LineString', coordinates: Array.from({ length: 73 }, (_, i) => q.position(app, i * 5)) } });
        fc.features.push({ type: 'Feature', properties: { r: 'nord' }, geometry: { type: 'Point', coordinates: q.position(app, 0) } });
        for (let i = 1; i < pas.length; i++) { const a = pas[i - 1], b = pas[i]; if (a.s.hauteur <= 0 && b.s.hauteur <= 0) continue; fc.features.push({ type: 'Feature', properties: { r: !b.vu ? 'masque' : b.s.hauteur < 6 ? 'dore' : 'clair' }, geometry: { type: 'LineString', coordinates: [q.position(app, a.s.azimut), q.position(app, b.s.azimut)] } }); }
        fc.features.push({ type: 'Feature', properties: { r: 'centre' }, geometry: { type: 'Point', coordinates: [ct.lng, ct.lat] } });
        if (app.map.getSource('anneau')) app.map.getSource('anneau').setData(fc);
        else {
          app.map.addSource('anneau', { type: 'geojson', data: fc });
          app.map.addLayer({ id: 'anneau-cercle', type: 'line', source: 'anneau', filter: ['==', ['get', 'r'], 'cercle'], paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.55 } });
          app.map.addLayer({ id: 'anneau-ombre', type: 'line', source: 'anneau', filter: ['in', ['get', 'r'], ['literal', ['dore', 'clair']]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#10192a', 'line-width': 9, 'line-opacity': 0.55 } });
          app.map.addLayer({ id: 'anneau-arc', type: 'line', source: 'anneau', filter: ['in', ['get', 'r'], ['literal', ['dore', 'clair', 'masque']]], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'r'], 'dore', '#e9a23b', 'clair', '#fff3c4', '#8b93a3'], 'line-width': ['match', ['get', 'r'], 'masque', 2, 6] } });
          app.map.addLayer({ id: 'anneau-points', type: 'circle', source: 'anneau', filter: ['in', ['get', 'r'], ['literal', ['centre', 'nord']]], paint: { 'circle-radius': ['match', ['get', 'r'], 'centre', 6, 3], 'circle-color': ['match', ['get', 'r'], 'centre', '#b8963e', '#ffffff'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
          app.map.addLayer({ id: 'anneau-n', type: 'symbol', source: 'anneau', filter: ['==', ['get', 'r'], 'nord'], layout: { 'text-field': 'N', 'text-font': ['Source Sans Pro Regular'], 'text-size': 12, 'text-offset': [0, -1], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#10192a', 'text-halo-width': 1.5 } });
        }
        // Fiche du point : premier et dernier rayon direct, fins et débuts d'heure dorée.
        const vus = pas.filter(p => p.vu), leve = pas.filter(p => p.s.hauteur > 0);
        if (!vus.length) { c.querySelector('.etat').textContent = 'Ce point ne reçoit pas de soleil direct ce jour-là.'; q.pas = pas; q.soleilMobile(app); return; }
        const premier = vus[0], dernier = vus[vus.length - 1], doreM = vus.filter(p => p.s.azimut < 180 && p.s.hauteur < 6), doreS = vus.filter(p => p.s.azimut >= 180 && p.s.hauteur < 6), haut = vus.filter(p => p.s.hauteur >= 6);
        const retard = premier.m - leve[0].m, avance = leve[leve.length - 1].m - dernier.m;
        c.querySelector('.etat').innerHTML = `Premier rayon direct à <span class="fort">${hm(premier.m)}</span>${retard > 10 ? ` (le relief le retarde de ${hm(retard)})` : ''}, dernier à <span class="fort">${hm(dernier.m)}</span>${avance > 10 ? ` (${hm(avance)} avant le coucher)` : ''}. ` +
          (doreM.length ? `Heure dorée du matin jusqu'à ${hm(doreM[doreM.length - 1].m + 5)}. ` : (haut.length && premier.s.azimut < 180 ? 'Pas d\'heure dorée le matin : quand le soleil passe la crête, il est déjà haut. ' : '')) +
          (doreS.length ? `Heure dorée du soir à partir de ${hm(doreS[0].m)}.` : 'Pas d\'heure dorée le soir : le relief cache le soleil avant qu\'il soit bas.');
        q.pas = pas; q.soleilMobile(app);
      },
      // Le petit soleil : sa position sur l'anneau à l'heure du curseur.
      soleilMobile(app) {
        const c = q._c; c.querySelector('.heure').textContent = hm(etat.minutes); if (!q.point) return;
        const s = app.soleil(instant(opts.fuseau, etat.jour, etat.minutes), q.point.lat, q.point.lng);
        const p = q.pas && q.pas[Math.round(etat.minutes / 5)], d = { type: 'FeatureCollection', features: s.hauteur > 0 ? [{ type: 'Feature', properties: { vu: p && p.vu ? 1 : 0, t: Math.round(s.hauteur) + '°' }, geometry: { type: 'Point', coordinates: q.position(app, s.azimut) } }] : [] };
        if (app.map.getSource('astre')) app.map.getSource('astre').setData(d);
        else { app.map.addSource('astre', { type: 'geojson', data: d }); app.map.addLayer({ id: 'astre', type: 'circle', source: 'astre', paint: { 'circle-radius': 10, 'circle-color': ['case', ['==', ['get', 'vu'], 1], '#ffd23f', '#8b93a3'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
          app.map.addLayer({ id: 'astre-h', type: 'symbol', source: 'astre', layout: { 'text-field': ['get', 't'], 'text-font': ['Source Sans Pro Regular'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#10192a', 'text-halo-width': 1.5 } }); }
      },
      toucher(app, ll) { q.point = ll; q.tracer(app); },
      fermer(app) { tour++; q.point = null; q.pas = null; app.retirer('astre-h', 'astre', 'anneau-n', 'anneau-points', 'anneau-arc', 'anneau-ombre', 'anneau-cercle'); for (const s of ['astre', 'anneau']) if (app.map.getSource(s)) app.map.removeSource(s); }
    };
    return q;
  }

  /* « Les nuages vont-ils boucher la vue ? » : nébuleuse prévue au point touché, heure par heure. */
  function nuages(opts) {
    let tour = 0;
    const q = {
      theme: opts.theme || 'Nuages', libelle: opts.libelle || 'Le ciel sera-t-il dégagé ?',
      aide: 'Couverture nuageuse prévue par Open-Meteo au point touché, heure par heure : les nuages bas (ceux qui bouchent les cirques et les sommets), puis le total. La maille du modèle fait plusieurs kilomètres : il donne la tendance du secteur, pas le nuage accroché à un rempart précis. Sous les tropiques, les nuages montent souvent dans les hauts dès la fin de matinée.',
      async ouvrir(app) { q._c = app.repondre(q.libelle, `<p class="etat">Lecture du ciel…</p><div class="tab"></div>`); await q.lire(app, app.map.getCenter()); },
      async lire(app, ll) {
        const c = q._c, moi = ++tour;
        const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${ll.lat.toFixed(3)}&longitude=${ll.lng.toFixed(3)}&hourly=cloud_cover_low,cloud_cover,precipitation_probability&forecast_hours=36&timezone=${encodeURIComponent(opts.fuseau)}`);
        if (moi !== tour || app.active !== q) return;
        const h = j && j.hourly; if (!h) { c.querySelector('.etat').textContent = 'Le ciel n\'a pas pu être lu. Réessaie dans un moment.'; return; }
        const jour = h.time.map((t, i) => ({ t, i, hh: +t.slice(11, 13) })).filter(x => x.hh >= 5 && x.hh <= 19);
        const clairs = jour.filter(x => h.cloud_cover_low[x.i] != null && h.cloud_cover_low[x.i] <= 30);
        c.querySelector('.etat').innerHTML = clairs.length ? `Peu de nuages bas (30 % au plus) prévus ici : ${clairs.slice(0, 8).map(x => `<span class="fort">${x.t.slice(8, 10)}/${x.t.slice(5, 7)} ${x.hh} h</span>`).join(', ')}${clairs.length > 8 ? '…' : ''}.` : 'Aucun créneau de jour avec peu de nuages bas dans les 36 heures prévues ici.';
        c.querySelector('.tab').innerHTML = `<div class="jours">${jour.slice(0, 16).map(x => { const b = h.cloud_cover_low[x.i], t = h.cloud_cover[x.i]; return `<div${b != null && b <= 30 ? ' style="outline:1px solid #b8963e"' : ''}><b>${x.hh} h</b>bas ${b == null ? '–' : Math.round(b) + ' %'}<br><small>total ${t == null ? '–' : Math.round(t) + ' %'}</small></div>`; }).join('')}</div>`;
        app.bulle(ll, 'Ciel prévu en ce point<small>voir le panneau</small>');
      },
      toucher(app, ll) { q.lire(app, ll); }
    };
    return q;
  }

  S.lumiere = { lumiere, versant, leverCoucher, duree, rasante, anneau, nuages, cap, hm, instant, decalage, etat, maintenant };
})();
