// lx-verdict.js — moteur de verdict du filtre par critères (onglet Lieux, incrément 6a+).
//
// Extrait le 2026-08-12 depuis index.html (fonctions lxEtatEquipe/lxEvalFam/lxBilan/lxNbPlein/
// lxMaxN/lxAbsorbCriteresPistes/LX_PISTE_V_ETAT/lxDeFam/lxMotPremiers/lxLibelleNiveau), sans
// aucun changement de comportement — objectif : rendre testable en Node, sans navigateur, la
// logique qui décide si un lieu tient les critères d'une famille. index.html ne réimplémente
// PAS ces règles : ses fonctions lx* du même nom sont désormais de fins appels à celles d'ici,
// alimentés par l'état global du site (LX_CRIT_ETATS, lxSel(), lxVisibles()...). Une seule
// implémentation, deux points d'appel (site + tests).
//
// Aucune dépendance au DOM, à Supabase ou à Leaflet : chaque fonction ne lit que ce qu'on lui
// passe en argument. C'est ce qui la rend rejouable par `node --test` sans page ni navigateur.
//
// Montage : script classique (pas de type="module"). Justification (3 lignes, cf. ticket) :
// le site entier est déjà en scripts classiques ES5-ish (var, IIFE, "use strict"), sans aucun
// import/export nulle part — un module isolé casserait l'homogénéité pour zéro bénéfice, GitHub
// Pages n'imposant aucune contrainte qui favoriserait l'un ou l'autre. En Node (tests), ce même
// fichier est chargé par `require()` grâce à l'export CommonJS conditionnel en pied de fichier ;
// en navigateur, il s'attache à `window.LxVerdict`. Un seul fichier, deux runtimes, zéro build.
//
// Périmètre : uniquement le calcul du verdict (notes/états -> tenu/en partie/manqué), l'état
// géographique d'un lieu vis-à-vis des départements d'une famille (ajouté le 2026-08-15), et
// les libellés qui en dérivent directement. Rien sur l'affichage, la carte ou la fiche du lieu.

(function (root, factory) {
  "use strict";
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    root.LxVerdict = mod;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  // Les pistes équipe (t='p') qualifient leurs critères à la main dans carte_lieux.data.criteres
  // ([{n, v, note}], v déjà tranché en 'oui'/'partiel'/'non'/'?') — pas un second seuil de note,
  // juste une traduction vers le vocabulaire des 250 lieux qualifiés en base (met/part/miss/ask).
  // '?' et toute valeur absente/inconnue retombent sur 'ask' — jamais sur 'miss' (cf. absorbCriteresPistes).
  var LX_PISTE_V_ETAT = { oui: "met", partiel: "part", non: "miss" };

  // Un critère absent de l'état d'équipe (jamais qualifié par personne, sur aucun lieu) retombe
  // sur 'ask' : c'est la seule valeur de repli, et 'ask' ne compte JAMAIS comme manqué (cf. evalFam).
  function etatEquipe(critEtats, lieuQid, cid) {
    var e = critEtats[lieuQid];
    return (e && e[cid]) || "ask";
  }

  // Absorbe LX_PISTES dans critEtats, EN PLACE (comme l'original mutait LX_CRIT_ETATS) :
  // appelant responsable de l'ordre (après le chargement des états d'équipe, jamais avant, sous
  // peine d'être écrasé). Toute valeur de critère inattendue ('?' compris) retombe sur 'ask',
  // jamais sur 'miss' — c'est le point testé explicitement (une régression ici viderait le
  // filtre pour toutes les pistes équipe).
  //
  // FUSION, pas affectation (corrigé le 2026-08-15, migration lieux_criteres v2). Avant ce
  // correctif, `critEtats[p.qid] = etats` écrasait TOUT ce que la vue lieux_criteres_etat avait
  // déjà servi pour ce lieu — inoffensif tant que la vue ne servait aucune piste (0/12 avant la
  // v2), mais dès qu'elle sert les 7 critères calculés (s1, s4, s6, s7, c2_mrnxzasm,
  // c1_ms9fya7c, c2_ms9fzvx4) sur les 262 lieux, l'écrasement les aurait effacés pour les 12
  // pistes, qui seraient retombées en 'ask' sur ces 7 critères — donc SERVIES pour toutes les
  // familles sans qu'aucune règle ne l'ait décidé. C'est la classe de défaut B1 du 2026-08-11
  // (un état vide/effacé se lit comme favorable), rejouée ici en silence. On pose désormais les
  // clés b1..b10 des pistes PAR-DESSUS ce que critEtats[p.qid] contient déjà, sans y toucher :
  // aucun recouvrement possible avec les clés s*/c*, les deux univers de clés sont disjoints.
  function absorbCriteresPistes(pistes, critEtats) {
    (pistes || []).forEach(function (p) {
      if (!p.criteres || !p.criteres.length) return;
      var etats = critEtats[p.qid] || {};
      p.criteres.forEach(function (c) {
        if (c.n == null) return;
        etats["b" + c.n] = LX_PISTE_V_ETAT[c.v] || "ask";
      });
      critEtats[p.qid] = etats;
    });
    return critEtats;
  }

  // Valeur de repli 1 quand aucune famille n'est sélectionnée (pas un vrai plafond) — le point
  // exact que B2 a corrigé le 2026-08-11 : lxRenderCurseur() ne clampe le curseur QUE si une
  // vraie sélection existe (fs.length truthy), jamais sur ce repli.
  function maxN(selFams) {
    return (selFams || []).reduce(function (a, f) { return Math.max(a, f.order.length); }, 1);
  }

  // ---------------------------------------------------------------------------------------
  // LUM-48 (2026-08-16) — la note par famille (décision 7 du cadrage, tranchée par Benoit le
  // 2026-08-09 : « je veux une note par famille c'est tout l'intérêt »).
  //
  // Modèle, repris mot pour mot du cadrage :
  //   · la note de l'ÉQUIPE reste le socle — c'est la qualification documentaire des 250 lieux,
  //     avec sa source et son niveau de confiance ;
  //   · une famille peut poser SA note sur n'importe quel critère, dans le même vocabulaire ;
  //   · tant qu'elle n'a rien dit, la note de l'équipe vaut pour elle ;
  //   · le filtre lit, pour chaque famille, SA note si elle existe, sinon celle de l'équipe.
  //     Un même lieu peut donc tenir pour une famille et tomber pour une autre : c'est l'objet
  //     de la fonctionnalité, pas un effet de bord.
  //   · la note d'équipe n'est JAMAIS la moyenne des notes des familles (une moyenne confond
  //     « on n'est pas d'accord » avec « on est d'accord que c'est moyen », alors que tout
  //     l'écran repose sur le désaccord). Rien ici n'agrège quoi que ce soit.
  //
  // LE POINT QUI SE JOUE ICI, ET QUI N'EST PAS ÉVIDENT : « je ne sais pas » (ask) posé
  // EXPLICITEMENT par une famille est une note, pas une absence de note. Il ÉCRASE donc un
  // 'met' d'équipe — la famille dit « je ne reprends pas votre relevé à mon compte ». C'est
  // pour ça que revenir à la note d'équipe est une SUPPRESSION de ligne, jamais un 'ask' :
  // confondre les deux ferait disparaître, sans le dire, la seule façon d'exprimer un doute.
  //
  // Forme attendue de `notesFam` : {lieu_id: {critere: {compte_id: 'met'|'part'|'miss'|'ask'}}}
  // — exactement ce que la table notes_familles (compte_id, lieu_id, critere, etat) rend une
  // fois indexée. Absent/incomplet -> on retombe sur l'équipe, jamais sur une valeur inventée.
  var ETATS_NOTE = { met: 1, part: 1, miss: 1, ask: 1 };

  // La note propre d'un compte sur un critère d'un lieu, ou null s'il n'a rien dit. Une valeur
  // hors vocabulaire est traitée comme « rien dit » : une donnée abîmée ne doit pas décider
  // d'un verdict (même discipline que absorbCriteresPistes, qui retombe sur 'ask' et jamais
  // sur 'miss').
  function noteFamille(notesFam, lieuQid, cid, compteId) {
    if (!notesFam || !compteId) return null;
    var parLieu = notesFam[lieuQid];
    if (!parLieu) return null;
    var parCrit = parLieu[cid];
    if (!parCrit) return null;
    var e = parCrit[compteId];
    return ETATS_NOTE[e] ? e : null;
  }

  // Range les lignes plates de notes_familles (compte_id, lieu_id, critere, etat) dans la forme
  // qu'attendent les fonctions ci-dessus. Ici plutôt que dans index.html parce que c'est le
  // CONTRAT de forme entre la table et la règle : si les deux divergent, tout retombe en
  // silence sur la note d'équipe et personne ne voit rien — exactement la classe de défaut
  // « un état vide se lit comme un fait » du 2026-08-11. Testable, donc testé.
  // Une ligne dont l'état est hors vocabulaire est ÉCARTÉE à l'indexation (la contrainte
  // notes_familles_etat_chk l'interdit déjà en base : ce filtre couvre le cas où la contrainte
  // serait relâchée un jour, pas une donnée attendue).
  function indexeNotes(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.lieu_id || !r.critere || !r.compte_id) return;
      if (!ETATS_NOTE[r.etat]) return;
      var l = out[r.lieu_id] || (out[r.lieu_id] = {});
      var c = l[r.critere] || (l[r.critere] = {});
      c[r.compte_id] = r.etat;
    });
    return out;
  }

  // L'état qui FAIT FOI pour une famille donnée : sa note si elle en a posé une, sinon celle
  // de l'équipe. C'est le seul endroit du projet où cette priorité est écrite.
  function etatPourFamille(critEtats, notesFam, lieuQid, cid, compteId) {
    return noteFamille(notesFam, lieuQid, cid, compteId) || etatEquipe(critEtats, lieuQid, cid);
  }

  // C1 (cadrage) : seul 'miss' fait perdre le niveau — 'ask' ne compte NULLE PART dans miss.
  // Le critère 2 est non qualifié sur les 250 lieux ; s'il comptait comme manqué, curseur à 2
  // renverrait zéro lieu partout et la fonctionnalité serait morte-née à l'écran.
  //
  // `notesFam` est OPTIONNEL et ajouté en dernier argument (LUM-48) : omis, la fonction se
  // comporte exactement comme avant les notes par famille — c'est ce qui permet aux tests
  // écrits avant ce lot de rester valides tels quels, et de prouver la non-régression.
  function evalFam(critEtats, it, f, n, notesFam) {
    var k = Math.min(n, f.order.length), st = [], met = 0, part = 0, ask = 0, miss = [];
    for (var i = 0; i < k; i++) {
      var e = etatPourFamille(critEtats, notesFam, it.qid, f.order[i], f.id);
      st.push(e);
      if (e === "met") met++;
      else if (e === "part") part++;
      else if (e === "ask") ask++;
      else miss.push(f.order[i]);
    }
    return { st: st, k: k, met: met, part: part, ask: ask, miss: miss, ok: miss.length === 0, tronq: f.order.length < n };
  }

  function bilan(critEtats, selFams, it, n, notesFam) {
    var fs = selFams || [], sat = 0, ask = {};
    fs.forEach(function (f) {
      var e = evalFam(critEtats, it, f, n, notesFam);
      if (e.ok) sat++;
      for (var i = 0; i < e.k; i++) if (e.st[i] === "ask") ask[f.order[i]] = 1;
    });
    return { sat: sat, ask: Object.keys(ask), tot: fs.length };
  }

  // visibles : liste déjà filtrée (recherche/nature/favoris) par l'appelant — cette fonction ne
  // sait rien du DOM ni de la recherche texte, elle ne fait que compter.
  function nbPlein(critEtats, selFams, visibles, n, notesFam) {
    var fs = selFams || [];
    return (visibles || []).filter(function (it) { return bilan(critEtats, fs, it, n, notesFam).sat === fs.length; }).length;
  }

  function motPremiers(n) { return n === 1 ? "premier critère" : "premiers critères"; }

  function deFam(f) {
    return /^Famille /.test(f.nom) ? "de la " + f.nom.replace("Famille ", "famille ") : "de " + f.nom;
  }

  // ---------------------------------------------------------------------------------------
  // Départements : le niveau « cœur » (2026-08-15, révision de la décision 13)
  //
  // Le questionnaire fait cliquer chaque département en TROIS états (rien / favorable / de
  // cœur). Deux formes coexistent en base : un tableau de codes (ancienne saisie binaire,
  // antérieure au niveau cœur — le cœur n'y est pas « absent », il est INCONNU) ou un objet
  // {code: 1|2}. La décision 13 les faisait compter pareil et n'en restituait qu'un booléen ;
  // au 15/08, 3 des 4 réponses publiées portent un niveau cœur, donc l'égalisation efface un
  // signal donné explicitement. Ce qui NE change pas : la zone départage, elle n'élimine
  // jamais — rien ici n'entre dans evalFam()/bilan(), qui continuent d'ignorer la géographie.
  function normalizeDepts(v) {
    if (Array.isArray(v)) {
      var o = {};
      v.forEach(function (c) { o[c] = 1; });
      return { n: o, coeurConnu: false };
    }
    if (v && typeof v === "object") {
      var out = {};
      Object.keys(v).forEach(function (c) { var lvl = +v[c]; if (lvl === 1 || lvl === 2) out[c] = lvl; });
      return { n: out, coeurConnu: true };
    }
    return { n: {}, coeurConnu: false };
  }

  // null  : le lieu n'a pas de département connu (pistes équipe) — troisième état explicite,
  //         jamais dérivé de la commune, jamais pénalisant (inchangé depuis la décision 13).
  // coeur : niveau 2.  fav : niveau 1, la famille a pu exprimer un cœur.
  // favnr : niveau 1 mais forme binaire — favorable, cœur NON RENSEIGNÉ (≠ pas de cœur).
  // hors  : absent de sa liste.
  function zoneEtat(deptsBruts, deptLieu) {
    if (!deptLieu) return null;
    var d = normalizeDepts(deptsBruts), lvl = d.n[deptLieu];
    if (lvl === 2) return "coeur";
    if (lvl === 1) return d.coeurConnu ? "fav" : "favnr";
    return "hors";
  }

  // Départage au tri, à nombre égal de familles servies : plus petit = mieux placé. Strict
  // sur-ensemble du comptage hors-zone d'avant (hors = +1) ; le cœur ajoute le seul bonus.
  // 'favnr' et null valent 0 comme 'fav' : une information manquante ne pénalise personne.
  function zoneScore(etat) {
    if (etat === "coeur") return -1;
    if (etat === "hors") return 1;
    return 0;
  }

  var ZONE_LIBELLE = {
    coeur: "Dans un département de cœur",
    fav: "Dans un département favorable",
    favnr: "Favorable — cœur non renseigné",
    hors: "Hors de sa zone géographique"
  };
  function zoneLibelle(etat) { return ZONE_LIBELLE[etat] || ""; }

  // Somme des scores de zone d'un lieu sur les familles sélectionnées (remplace le comptage
  // hors-zone seul). Le paramètre `deptLieu` est lu par l'appelant : cette fonction ne connaît
  // ni le DOM ni la forme d'un item de carte.
  function zoneScoreTotal(deptLieu, selFams) {
    return (selFams || []).reduce(function (a, f) { return a + zoneScore(zoneEtat(f.depts, deptLieu)); }, 0);
  }

  // 2026-08-15 — la géographie devient un FILTRE, en plus du départage (demande de Benoit :
  // « rajouter dans les critères si on ne garde que les lieux de cœur ou tous les lieux dans la
  // zone whitelistée, une case à cocher dans les filtres »).
  //   mode 'zone'  : on garde les lieux qui sont dans la zone retenue d'une famille, quel que
  //                  soit le niveau (favorable OU cœur). C'est le défaut.
  //   mode 'coeur' : on ne garde que les départements de cœur.
  // Deux neutralités, et ce sont elles qui font que la règle ne se retourne pas contre
  // quelqu'un : un lieu sans département connu (pistes équipe) ne peut être exclu par un
  // critère géographique qu'on ne sait pas évaluer ; et une famille dont le cœur n'est pas
  // renseigné (ancienne forme de réponse) ne fait jamais échouer le mode 'coeur' — sinon la
  // seule réponse antérieure au niveau cœur viderait le filtre pour tout le monde.
  // Comme partout ailleurs : la sélection vide ne restreint rien.
  // Révisé le 2026-08-15 (union), REVENU À L'INTERSECTION le 2026-08-16 sur arbitrage de
  // Benoit : « je préfère une réponse à zéro qu'une réponse qui répond tout ». Historique, à
  // ne pas re-parcourir : la version d'origine exigeait TOUTES les familles sélectionnées, y
  // compris celles qui n'ont pas renseigné de cœur — donc une seule ancienne réponse (Famille
  // Plaut, saisie binaire) vidait l'écran. Le correctif du 15/08 a jeté l'intersection avec
  // l'eau du bain en passant à « au moins une », c'est-à-dire à l'UNION : à 5 familles cochées,
  // 193 lieux sur 255 en mode zone et 89 en mode cœur — un filtre qui ne filtrait presque plus.
  // La bonne dimension n'était pas union/intersection mais QUI PARTICIPE : l'intersection se
  // fait sur les familles CONTRIBUTRICES, celles qui ont réellement exprimé ce que le mode
  // demande. Une famille muette sur la question est neutre, jamais éliminatoire ; et à une
  // seule famille cochée on retrouve exactement sa zone, comme le voulait le retour du 15/08.
  //
  // Trois modes, pilotés par la liste déroulante de la barre de filtre :
  //   'off'   : aucune restriction géographique.
  //   'zone'  : le lieu est dans la zone retenue (favorable OU cœur) de TOUTES les familles
  //             cochées qui ont renseigné au moins un département.
  //   'coeur' : le lieu est dans un département de cœur de TOUTES les familles cochées qui ont
  //             renseigné un cœur.
  //
  // Conséquence assumée, mesurée en base le 16/08 avant d'écrire (5 familles publiées) : les
  // cœurs de Gineyts (22, 29) sont disjoints de ceux de Decuyper/Gastou (44, 85), donc
  // l'intersection des 4 cœurs renseignés est VIDE et le mode 'coeur' à 5 familles ne laisse
  // que les 12 pistes sans département. Ce n'est pas un défaut : c'est le fait que l'écran
  // doit dire. Le repli reste à la main de l'utilisateur (décocher une famille), jamais
  // automatique — un filtre qui s'adoucit tout seul ment sur ce qu'il montre.
  //
  // Deux garde-fous, pour que la règle ne se retourne jamais contre quelqu'un :
  //  - un lieu sans département connu (pistes équipe) n'est exclu par AUCUN mode : on ne
  //    disqualifie pas sur un critère qu'on ne sait pas évaluer ;
  //  - si AUCUNE des familles sélectionnées n'a renseigné de cœur (cas d'une réponse en
  //    ancienne forme, comme Famille Plaut), le mode 'coeur' retombe sur 'zone' au lieu de
  //    vider l'écran. Un écran vide sans explication se lit comme « aucun lieu ne convient »,
  //    alors que la vraie cause est « cette famille n'a pas dit son cœur ».

  function aUneZone(d) { for (var k in d.n) { if (d.n[k] === 1 || d.n[k] === 2) return true; } return false; }
  function aUnCoeur(d) {
    if (!d.coeurConnu) return false;
    for (var k in d.n) { if (d.n[k] === 2) return true; }
    return false;
  }

  // Qui participe réellement au filtre géographique, et sous quel mode après repli. Exposée
  // parce que l'écran doit pouvoir DIRE « communs aux N familles qui l'ont renseigné » sans
  // recompter à sa façon — la divergence entre deux comptages est le défaut du 16/08 qu'on ne
  // rejoue pas. Renvoie toujours {mode, fams} ; fams vide = la géographie ne restreint rien.
  function zoneContribs(selFams, mode) {
    var fs = selFams || [], i, d, out = [];
    if (mode !== "zone" && mode !== "coeur") return { mode: "off", fams: [] };
    if (!fs.length) return { mode: mode, fams: [] };
    if (mode === "coeur") {
      for (i = 0; i < fs.length; i++) { d = normalizeDepts(fs[i].depts); if (aUnCoeur(d)) out.push(fs[i]); }
      if (out.length) return { mode: "coeur", fams: out };
      mode = "zone"; // repli explicite, cf. note ci-dessus
      out = [];
    }
    for (i = 0; i < fs.length; i++) { d = normalizeDepts(fs[i].depts); if (aUneZone(d)) out.push(fs[i]); }
    return { mode: "zone", fams: out };
  }

  function zoneRetenue(deptLieu, selFams, mode) {
    if (mode !== "zone" && mode !== "coeur") return true;
    if (deptLieu == null || deptLieu === "") return true;

    var c = zoneContribs(selFams, mode), fams = c.fams;
    if (!fams.length) return true;

    for (var i = 0; i < fams.length; i++) {
      var e = zoneEtat(fams[i].depts, deptLieu);
      if (c.mode === "coeur") { if (e !== "coeur") return false; }
      else if (e === "hors") return false;
    }
    return true;
  }

  function libelleNiveau(n, selFams) {
    var mot = motPremiers(n), fs = selFams || [];
    if (fs.length === 1) return fs[0].moi ? mot + " de votre classement" : mot + " " + deFam(fs[0]);
    return mot + " de chaque famille";
  }

  return {
    LX_PISTE_V_ETAT: LX_PISTE_V_ETAT,
    ETATS_NOTE: ETATS_NOTE,
    etatEquipe: etatEquipe,
    noteFamille: noteFamille,
    etatPourFamille: etatPourFamille,
    indexeNotes: indexeNotes,
    absorbCriteresPistes: absorbCriteresPistes,
    maxN: maxN,
    evalFam: evalFam,
    bilan: bilan,
    nbPlein: nbPlein,
    motPremiers: motPremiers,
    deFam: deFam,
    libelleNiveau: libelleNiveau,
    normalizeDepts: normalizeDepts,
    zoneEtat: zoneEtat,
    zoneScore: zoneScore,
    zoneLibelle: zoneLibelle,
    zoneScoreTotal: zoneScoreTotal,
    zoneContribs: zoneContribs,
    zoneRetenue: zoneRetenue
  };
});
