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
          <p class="etat"></p><div class="legende"><span><i style="background:#1c2848"></i>à l'ombre</span><span><i style="background:#e9c46a"></i>lumière rasante (soleil sous 12°)</span></div>
          <p class="petit">${opts.note || ''} Touche la carte pour connaître les heures de soleil d'un point.</p>`);
        const jour = c.querySelector('.jour'), h = c.querySelector('.h'), txt = c.querySelector('.etat'), heure = c.querySelector('.heure');
        let prevu = false;
        const dessiner = () => {
          prevu = false; const g = memo.g; if (!g || app.active !== q) return;
          const centre = app.map.getCenter(), s = app.soleil(instant(opts.fuseau, etat.jour, etat.minutes), centre.lat, centre.lng);
          heure.textContent = hm(etat.minutes);
          if (s.hauteur <= 0) { txt.textContent = 'Le soleil est sous l\'horizon.'; app.poser('ombres', g, app.peindre(g, () => [20, 30, 58, 140])); return; }
          const o = app.ombres(g, s.azimut, s.hauteur), rasant = s.hauteur < 12;
          let n = 0; for (let k = 0; k < o.length; k++) n += o[k];
          // Ombre bleu-gris, assez légère pour laisser lire le fond ; son bord est fondu sur une maille de part et
          // d'autre (moyenne des neuf voisines), ce qui dessine une pénombre au lieu d'une limite en escalier.
          const W = g.w, H = g.h, part = k => { const i = k % W, j = (k - i) / W; if (i < 1 || j < 1 || i > W - 2 || j > H - 2) return o[k]; let v = 0; for (let dj = -W; dj <= W; dj += W) v += o[k + dj - 1] + o[k + dj] + o[k + dj + 1]; return v / 9; };
          app.poser('ombres', g, app.peindre(g, k => { const f = part(k); return f > 0 ? [28, 40, 72, Math.round(150 * f)] : (rasant ? [233, 196, 106, 55] : null); }));
          txt.innerHTML = `Soleil au <span class="fort">${cap(s.azimut)}</span> (${Math.round(s.azimut)}°), à <span class="fort">${Math.round(s.hauteur)}°</span> au-dessus de l'horizon. ${Math.round(100 * n / o.length)} % de la vue est à l'ombre${g.surface ? ', arbres et bâtiments compris' : ' (relief seul : zoome pour compter les arbres)'}.`;
        };
        const demander = () => { if (!prevu) { prevu = true; requestAnimationFrame(dessiner); } };
        const recharger = async () => { await charger(app, memo); demander(); };
        h.oninput = () => { etat.minutes = +h.value; demander(); };
        jour.onchange = () => { if (jour.value) { etat.jour = jour.value; demander(); } };
        brancherMaintenant(c, opts.fuseau, demander);
        /* Plein écran : l'heure se règle sur un ruban qu'on fait défiler (un point d'écran par minute), le jour y est
           teinté du lever au coucher du soleil ; la date et « Maintenant » sont à côté. */
        q._plein = () => ({
          ruban: {
            min: 0, max: 1430, pas: 10, echelle: 1, texte: hm, lire: () => etat.minutes, ecrire: v => { etat.minutes = v; h.value = v; demander(); },
            graduations: Array.from({ length: 24 }, (_, i) => ({ v: i * 60, texte: i % 2 ? '' : i + ' h' })),
            plages: () => { const ct = app.map.getCenter(); let de = null; const out = []; for (let m = 0; m <= 1440; m += 10) { const haut = m < 1440 && app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng).hauteur > 0; if (haut && de == null) de = m; if (!haut && de != null) { out.push([de, m]); de = null; } } return out; }
          },
          date: { lire: () => etat.jour, ecrire: v => { jour.value = v; jour.onchange(); } },
          boutons: ['.now']
        });
        app.suivre(q, recharger);
        await recharger();
      },
      plein() { return q._plein(); },   // le panneau montre son bouton « plein écran » dès l'ouverture
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
    // Dégradé doré : ambre le matin, cuivre le soir, or clair quand le versant prend les deux. « Jamais » reste discret.
    const COUL = { m: [246, 190, 92, 175], s: [222, 128, 84, 175], d: [255, 232, 150, 195], j: [24, 34, 60, 70] };
    const q = {
      theme: opts.theme || 'Rasante', libelle: opts.libelle || 'Où la lumière est-elle rasante ?',
      aide: 'Pour la journée choisie, la carte cherche les moments où le soleil est à moins de 12° au-dessus de l\'horizon, le matin puis le soir, par pas de dix minutes, et regarde pour chaque maille si le relief laisse passer ce soleil bas. Ambre : lumière rasante le matin ; cuivre : le soir ; or clair : les deux ; voile sombre : jamais, le relief fait masque. Seul le relief de la vue (élargie d\'un cinquième) est compté : une crête lointaine hors de la carte peut encore masquer. Les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<p class="etat">Calcul…</p><div class="legende"></div>
          <p class="petit">${opts.noteRasante || ''} Touche les niveaux de la légende pour n'en garder qu'un.</p>`);
        c.querySelector('.heure').textContent = '';
        const peindre = () => { const g = memo.g, cl = memo.classes; if (!g || !cl || app.active !== q) return; app.poser('rasante', g, app.peindre(g, k => { const x = cl[k]; return x && !masques.has(x) ? COUL[x] : null; })); };
        app.legende(c, [{ cle: 'm', couleur: '#f6be5c', texte: 'rasante le matin' }, { cle: 's', couleur: '#de8054', texte: 'rasante le soir' }, { cle: 'd', couleur: '#ffe896', texte: 'matin et soir' }, { cle: 'j', couleur: '#182240', texte: 'jamais' }], peindre, masques);
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
      // Au point touché : ce que la carte dit de ce versant, et son altitude.
      toucher(app, ll) {
        const g = memo.g, cl = memo.classes, k = g && cl ? app.indice(g, ll.lng, ll.lat) : -1; if (k < 0 || !cl[k]) { app.bulle(ll, 'Hors de la vue calculée, ou en mer.'); return; }
        app.bulle(ll, `<span class="fort">${{ m: 'Lumière rasante le matin', s: 'Lumière rasante le soir', d: 'Lumière rasante matin et soir', j: 'Jamais de lumière rasante' }[cl[k]]}</span><small>${cl[k] === 'j' ? 'le relief cache le soleil quand il est bas' : 'le soleil bas y arrive sans être masqué'} · ${Math.round(g.z[k])} m</small>`);
      },
      // Plein écran : le jour à choisir ; la légende, en haut, se touche pour ne garder que le matin ou le soir.
      plein() { return { boutons: ['.now'] }; },
      fermer(app) { tour++; app.retirer('rasante'); }
    };
    return q;
  }

  /* « Par où passe le soleil ? » : la course du soleil autour du point touché, dans une vignette toujours de face
     (elle ne s'écrase pas quand la carte est inclinée) et tournée comme la carte : le nord de la vignette est le nord
     du terrain. Chaque position sur le cercle est la direction du soleil à une heure de la journée, les heures sont
     écrites le long de la course. Or : heure dorée ; clair : soleil visible ; gris : levé mais caché par le relief ;
     bleu nuit : sous l'horizon. */
  function anneau(opts) {
    const memo = {}; let tour = 0, marque = null, orienter = null;
    const T = 240, C = T / 2, RA = 88, RD = Math.PI / 180;
    const pt = (az, r) => [(C + r * Math.sin(az * RD)).toFixed(1), (C - r * Math.cos(az * RD)).toFixed(1)];
    // Arc de cercle entre deux azimuts, par le plus court chemin : près du zénith le soleil change vite de direction,
    // et une corde droite entre deux pas de calcul dessinait une course anguleuse.
    const arc = (a, b) => { const p0 = pt(a, RA), p1 = pt(b, RA), d = ((b - a + 540) % 360) - 180; return `M${p0[0]} ${p0[1]}A${RA} ${RA} 0 0 ${d >= 0 ? 1 : 0} ${p1[0]} ${p1[1]}`; };
    // Couleur du soleil visible selon sa hauteur : or quand il est bas, de plus en plus clair ensuite.
    const teinte = h => { if (h < 6) return '#e9a23b'; const f = Math.min(1, (h - 6) / 24); return `rgb(${Math.round(240 + 15 * f)},${Math.round(190 + 53 * f)},${Math.round(96 + 100 * f)})`; };
    const q = {
      theme: opts.theme || 'Soleil', libelle: opts.libelle || 'Par où passe le soleil ?',
      aide: 'La vignette est centrée sur le point touché et tournée comme la carte : chaque position sur le cercle est la direction du soleil à une heure de la journée, et les heures sont écrites le long de sa course. Trait épais doré : soleil visible et bas (moins de 6°, l\'heure dorée, brève sous les tropiques) ; trait clair : soleil visible plus haut ; trait gris fin : le soleil est levé mais caché par le relief, compté jusqu\'à 25 km ; bleu nuit : le soleil est sous l\'horizon. Le petit soleil suit le curseur d\'heure. Les heures sont calculées par pas de cinq minutes ; les nuages ne sont pas pris en compte.',
      async ouvrir(app) {
        const c = app.repondre(q.libelle, entete(opts.fuseau) + `<input type="range" class="h" min="0" max="1435" step="5" value="${etat.minutes}">
          <p class="etat">Touche un point de vue : la carte calcule son soleil sur la journée.</p>
          <div class="legende"><span><i style="background:#e9a23b"></i>heure dorée</span><span><i style="background:#fff3c4"></i>soleil visible</span><span><i style="background:#8b93a3"></i>caché par le relief</span><span><i style="background:#2a3658"></i>nuit</span></div>`);
        q._c = c;
        c.querySelector('.h').oninput = e => { etat.minutes = +e.target.value; q.soleilMobile(app); };
        c.querySelector('.jour').onchange = e => { if (e.target.value) { etat.jour = e.target.value; q.tracer(app); } };
        brancherMaintenant(c, opts.fuseau, () => q.tracer(app));
        // Sans point touché, la vignette se pose dans le tiers haut de l'écran : le centre est caché par le panneau.
        const recharger = async () => { await charger(app, memo); if (!q.point) { const cv = app.map.getCanvas(); q.point = app.map.unproject([cv.clientWidth / 2, cv.clientHeight * 0.3]); } q.tracer(app); };
        app.suivre(q, recharger); await recharger();
      },
      async tracer(app) {
        const c = q._c, ct = q.point, g = memo.g, moi = ++tour; if (!ct || !g) return;
        const k = app.indice(g, ct.lng, ct.lat);
        app.occupe(true, 'Lecture des crêtes alentour…'); const gl = await horizon(app, ct), kl = gl ? app.indice(gl, ct.lng, ct.lat) : -1; app.occupe(false);
        if (moi !== tour || app.active !== q) return;
        const pas = []; for (let m = 0; m <= 1440; m += 5) { const s = app.soleil(instant(opts.fuseau, etat.jour, m), ct.lat, ct.lng); pas.push({ m, s, vu: s.hauteur > 0 && (k < 0 || app.eclaire(g, k, s.azimut, s.hauteur)) && (kl < 0 || app.eclaire(gl, kl, s.azimut, s.hauteur)) }); }
        // La vignette : cercle de repère, course du soleil pas à pas, heures repères, nord.
        let nuit = '', fondArc = '', arcs = '', heures = '';
        for (let i = 1; i < pas.length; i++) {
          const a = pas[i - 1], b = pas[i], d = arc(a.s.azimut, b.s.azimut);
          if (b.s.hauteur <= 0) { nuit += d; continue; }
          if (b.vu) { fondArc += d; arcs += `<path d="${d}" stroke="${teinte(b.s.hauteur)}" stroke-width="${b.s.hauteur < 6 ? 13 : 8}"/>`; }
          else arcs += `<path d="${d}" stroke="#8b93a3" stroke-width="3"/>`;
        }
        let azPrec = null;   // deux heures trop proches sur le cercle (le soleil monte presque droit) : la seconde n'est pas écrite
        for (const p of pas) if (p.m % 120 === 0 && p.m < 1440 && p.s.hauteur > 0) {
          const ecart = azPrec == null ? 180 : Math.abs(((p.s.azimut - azPrec + 540) % 360) - 180); if (ecart < 16) continue; azPrec = p.s.azimut;
          const a = pt(p.s.azimut, RA - 7), b2 = pt(p.s.azimut, RA + 7), l = pt(p.s.azimut, RA + 19);
          heures += `<path d="M${a[0]} ${a[1]}L${b2[0]} ${b2[1]}" stroke="#10192a" stroke-width="2"/><text class="droit" x="${l[0]}" y="${l[1]}">${p.m / 60} h</text>`;
        }
        const n0 = pt(0, RA + 4), n1 = pt(0, RA - 26);
        const svg = `<svg viewBox="0 0 ${T} ${T}" aria-hidden="true"><g fill="none" stroke-linecap="round">
          <circle cx="${C}" cy="${C}" r="${RA}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1"/>
          <path d="${nuit}" stroke="#2a3658" stroke-width="6" stroke-opacity="0.9"/>
          <path d="${fondArc}" stroke="#10192a" stroke-width="14" stroke-opacity="0.55"/>${arcs}${heures}</g>
          <text class="droit" x="${n1[0]}" y="${n1[1]}" style="font-size:11px;fill:#cfd6e2">N</text><path d="M${n0[0]} ${n0[1]}L${pt(0, RA - 14)[0]} ${pt(0, RA - 14)[1]}" stroke="#cfd6e2" stroke-width="1.5"/>
          <circle cx="${C}" cy="${C}" r="6" fill="#b8963e" stroke="#fff" stroke-width="2"/>
          <g class="astre" style="display:none"><circle r="11" fill="#ffd23f" stroke="#fff" stroke-width="2.5"/><text class="h droit" y="23"></text></g></svg>`;
        if (!marque) {
          const e = document.createElement('div'); e.className = 'course';
          marque = new maplibregl.Marker({ element: e, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat([ct.lng, ct.lat]).addTo(app.map);
          // La vignette tourne avec la carte ; ses écritures, elles, restent droites.
          orienter = () => { const b = app.map.getBearing(); e.querySelectorAll('text.droit').forEach(x => { const px = +x.getAttribute('x') || 0, py = +x.getAttribute('y') || 0; x.setAttribute('transform', `rotate(${b.toFixed(1)} ${px} ${py})`); }); };
          app.map.on('rotate', orienter);
        }
        marque.setLngLat([ct.lng, ct.lat]); marque.getElement().innerHTML = svg; orienter();
        // Fiche du point : premier et dernier rayon direct, fins et débuts d'heure dorée.
        const vus = pas.filter(p => p.vu), leve = pas.filter(p => p.s.hauteur > 0);
        if (!vus.length) { c.querySelector('.etat').textContent = 'Ce point ne reçoit pas de soleil direct ce jour-là.'; q.pas = pas; q.soleilMobile(app); return; }
        const premier = vus[0], dernier = vus[vus.length - 1], doreM = vus.filter(p => p.s.azimut < 180 && p.s.hauteur < 6), doreS = vus.filter(p => p.s.azimut >= 180 && p.s.hauteur < 6), haut = vus.filter(p => p.s.hauteur >= 6);
        const retard = premier.m - leve[0].m, avance = leve[leve.length - 1].m - dernier.m;
        c.querySelector('.etat').innerHTML = `Premier rayon direct à <span class="fort">${hm(premier.m)}</span>${retard > 10 ? ` (le relief le retarde de ${hm(retard)})` : ''}, dernier à <span class="fort">${hm(dernier.m)}</span>${avance > 10 ? ` (${hm(avance)} avant le coucher)` : ''}. ` +
          (doreM.length ? `Heure dorée du matin de <span class="fort">${hm(doreM[0].m)}</span> à <span class="fort">${hm(doreM[doreM.length - 1].m + 5)}</span>. ` : (haut.length && premier.s.azimut < 180 ? 'Pas d\'heure dorée le matin : quand le soleil passe la crête, il est déjà haut. ' : '')) +
          (doreS.length ? `Heure dorée du soir de <span class="fort">${hm(doreS[0].m)}</span> à <span class="fort">${hm(doreS[doreS.length - 1].m + 5)}</span>.` : 'Pas d\'heure dorée le soir : le relief cache le soleil avant qu\'il soit bas.');
        q.pas = pas; q.soleilMobile(app);
      },
      // Le petit soleil : sa position sur la course à l'heure du curseur, avec cette heure écrite dessous.
      soleilMobile(app) {
        const c = q._c; c.querySelector('.heure').textContent = hm(etat.minutes); if (!q.point || !marque) return;
        const s = app.soleil(instant(opts.fuseau, etat.jour, etat.minutes), q.point.lat, q.point.lng), a = marque.getElement().querySelector('.astre'); if (!a) return;
        if (s.hauteur <= 0) { a.style.display = 'none'; return; }
        const p = q.pas && q.pas[Math.round(etat.minutes / 5)], xy = pt(s.azimut, RA);
        a.style.display = ''; a.setAttribute('transform', `translate(${xy[0]} ${xy[1]})`);
        a.querySelector('circle').setAttribute('fill', p && p.vu ? '#ffd23f' : '#8b93a3');
        a.querySelector('text').textContent = hm(etat.minutes); if (orienter) orienter();
      },
      // Plein écran : le ruban des heures promène le petit soleil sur sa course ; on touche la carte pour changer de point.
      plein(app) {
        const c = q._c, jour = c.querySelector('.jour'), h = c.querySelector('.h');
        return {
          ruban: { min: 0, max: 1435, pas: 5, echelle: 1, texte: hm, lire: () => etat.minutes, ecrire: v => { etat.minutes = v; h.value = v; q.soleilMobile(app); },
            graduations: Array.from({ length: 24 }, (_, i) => ({ v: i * 60, texte: i % 2 ? '' : i + ' h' })),
            plages: () => { const leve = (q.pas || []).filter(p => p.s.hauteur > 0); return leve.length ? [[leve[0].m, leve[leve.length - 1].m]] : []; } },
          date: { lire: () => etat.jour, ecrire: v => { jour.value = v; jour.onchange({ target: jour }); } },
          boutons: ['.now'], consigne: 'Touche un point de vue : la carte calcule son soleil sur la journée.'
        };
      },
      toucher(app, ll) { q.point = ll; q.tracer(app); },
      fermer(app) { tour++; q.point = null; q.pas = null; if (marque) { marque.remove(); marque = null; } if (orienter) { app.map.off('rotate', orienter); orienter = null; } }
    };
    return q;
  }

  /* « Les nuages vont-ils boucher la vue ? » : nébuleuse prévue au point touché, heure par heure. */
  function nuages(opts) {
    let tour = 0;
    const q = {
      theme: opts.theme || 'Nuages', libelle: opts.libelle || 'Le ciel sera-t-il dégagé ?',
      aide: 'Couverture nuageuse prévue par Open-Meteo au point touché, heure par heure, en frise : chaque case va du bleu (ciel clair) au gris (couvert). La première frise montre les nuages bas (ceux qui bouchent les cirques et les sommets) ; la seconde, tous les nuages, quand le modèle les distingue. Les créneaux dégagés (30 % de nuages bas au plus) sont cerclés d\'or, l\'heure qu\'il est de blanc. Sous chaque pictogramme, la température prévue à cette heure, à l\'altitude du point. Quand le modèle donne la même valeur pour les nuages bas et pour le total, une seule frise est affichée. La maille du modèle fait plusieurs kilomètres : il donne la tendance du secteur, pas le nuage accroché à un rempart précis. Sous les tropiques, les nuages montent souvent dans les hauts dès la fin de matinée.',
      async ouvrir(app) { q._c = app.repondre(q.libelle, `<p class="etat">Lecture du ciel…</p><div class="tab"></div>`); await q.lire(app, app.map.getCenter()); },
      async lire(app, ll) {
        const c = q._c, moi = ++tour;
        const j = await app.meteo(`https://api.open-meteo.com/v1/forecast?latitude=${ll.lat.toFixed(3)}&longitude=${ll.lng.toFixed(3)}&hourly=cloud_cover_low,cloud_cover,precipitation_probability,temperature_2m&forecast_hours=36&timezone=${encodeURIComponent(opts.fuseau)}`);
        if (moi !== tour || app.active !== q) return;
        const h = j && j.hourly; if (!h) { c.querySelector('.etat').textContent = 'Le ciel n\'a pas pu être lu. Réessaie dans un moment.'; return; }
        const jour = h.time.map((t, i) => ({ t, i, hh: +t.slice(11, 13) })).filter(x => x.hh >= 5 && x.hh <= 19).slice(0, 18);
        const bas = x => h.cloud_cover_low[x.i], tot = x => h.cloud_cover[x.i];
        const clairs = jour.filter(x => bas(x) != null && bas(x) <= 30);
        // Créneaux dégagés regroupés en plages (« de 8 h à 11 h ») plutôt qu'énumérés heure par heure.
        const plages = []; for (const x of clairs) { const d = plages[plages.length - 1]; if (d && d.fin.i === x.i - 1) d.fin = x; else plages.push({ deb: x, fin: x }); }
        const jj = x => `${x.t.slice(8, 10)}/${x.t.slice(5, 7)}`;
        c.querySelector('.etat').innerHTML = plages.length ? `Ciel dégagé des nuages bas ${plages.slice(0, 3).map(p => `le ${jj(p.deb)} de <span class="fort">${p.deb.hh} h</span> à <span class="fort">${p.fin.hh + 1} h</span>`).join(', ')}.` : 'Aucun créneau de jour dégagé dans les heures prévues ici.';
        // Une case par heure : sa teinte va du bleu du ciel clair au gris du ciel couvert.
        const teinte = v => { const f = Math.min(1, Math.max(0, v / 100)); return `rgb(${Math.round(118 + 20 * f)},${Math.round(190 - 48 * f)},${Math.round(236 - 80 * f)})`; };
        const picto = v => v <= 15 ? '☀️' : v <= 40 ? '🌤️' : v <= 75 ? '⛅' : '☁️';
        // L'heure qu'il est se repère dans la frise (case cerclée de blanc), quand elle fait partie des heures de jour montrées.
        const ici = maintenant(opts.fuseau), cleIci = ici.jour + 'T' + String(Math.floor(ici.minutes / 60)).padStart(2, '0');
        const bande = (val, pictos) => `<div class="frise">${jour.map((x, n) => { const v = val(x), nj = n > 0 && x.t.slice(0, 10) !== jour[n - 1].t.slice(0, 10); return `<div class="${v != null && v <= 30 ? 'ok' : ''}${nj ? ' nj' : ''}${x.t.slice(0, 13) === cleIci ? ' ici' : ''}" title="${x.hh} h : ${v == null ? '–' : Math.round(v) + ' %'}">${pictos ? `<span>${v == null ? '' : picto(v)}</span>${temp ? `<em>${temp(x)}</em>` : ''}` : ''}<i style="background:${v == null ? '#39455c' : teinte(v)}"></i><b>${pictos && x.t.slice(0, 13) === cleIci ? 'maint.' : pictos && (x.hh % 2 === 1 || nj) ? x.hh + 'h' : ''}</b></div>`; }).join('')}</div>`;
        // La température de l'heure, sous le pictogramme : celle du modèle à l'altitude du point touché.
        const T = h.temperature_2m, temp = T && T.some(v => v != null) ? x => T[x.i] == null ? '' : String(Math.round(T[x.i])).replace('-', '−') + '°' : null;
        const ts = T ? jour.map(x => T[x.i]).filter(v => v != null) : [];
        if (ts.length) c.querySelector('.etat').innerHTML += ` Températures de <span class="fort">${String(Math.round(Math.min(...ts))).replace('-', '−')}°</span> à <span class="fort">${String(Math.round(Math.max(...ts))).replace('-', '−')}°</span> sur ces heures.`;
        const pareils = jour.every(x => bas(x) === tot(x));
        c.querySelector('.tab').innerHTML = bande(bas, true) + (pareils ? '' : `<p class="petit2" style="margin:6px 0 0">Tous nuages confondus (les nuages hauts voilent la lumière sans boucher la vue) :</p>` + bande(tot, false)) +
          '';
        app.bulle(ll, 'Ciel prévu en ce point');
      },
      // Plein écran : la frise des nuages bas, heure par heure, reste sous la carte ; on touche un autre point pour la relire.
      plein() { return { bloc: '.tab .frise', consigne: 'Touche la carte : le ciel prévu en ce point, heure par heure.' }; },
      toucher(app, ll) { q.lire(app, ll); }
    };
    return q;
  }

  S.lumiere = { lumiere, versant, leverCoucher, duree, rasante, anneau, nuages, cap, hm, instant, decalage, etat, maintenant };
})();
