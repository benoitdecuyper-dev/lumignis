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
  function absorbCriteresPistes(pistes, critEtats) {
    (pistes || []).forEach(function (p) {
      if (!p.criteres || !p.criteres.length) return;
      var etats = {};
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

  // C1 (cadrage) : seul 'miss' fait perdre le niveau — 'ask' ne compte NULLE PART dans miss.
  // Le critère 2 est non qualifié sur les 250 lieux ; s'il comptait comme manqué, curseur à 2
  // renverrait zéro lieu partout et la fonctionnalité serait morte-née à l'écran.
  function evalFam(critEtats, it, f, n) {
    var k = Math.min(n, f.order.length), st = [], met = 0, part = 0, ask = 0, miss = [];
    for (var i = 0; i < k; i++) {
      var e = etatEquipe(critEtats, it.qid, f.order[i]);
      st.push(e);
      if (e === "met") met++;
      else if (e === "part") part++;
      else if (e === "ask") ask++;
      else miss.push(f.order[i]);
    }
    return { st: st, k: k, met: met, part: part, ask: ask, miss: miss, ok: miss.length === 0, tronq: f.order.length < n };
  }

  function bilan(critEtats, selFams, it, n) {
    var fs = selFams || [], sat = 0, ask = {};
    fs.forEach(function (f) {
      var e = evalFam(critEtats, it, f, n);
      if (e.ok) sat++;
      for (var i = 0; i < e.k; i++) if (e.st[i] === "ask") ask[f.order[i]] = 1;
    });
    return { sat: sat, ask: Object.keys(ask), tot: fs.length };
  }

  // visibles : liste déjà filtrée (recherche/nature/favoris) par l'appelant — cette fonction ne
  // sait rien du DOM ni de la recherche texte, elle ne fait que compter.
  function nbPlein(critEtats, selFams, visibles, n) {
    var fs = selFams || [];
    return (visibles || []).filter(function (it) { return bilan(critEtats, fs, it, n).sat === fs.length; }).length;
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

  function libelleNiveau(n, selFams) {
    var mot = motPremiers(n), fs = selFams || [];
    if (fs.length === 1) return fs[0].moi ? mot + " de votre classement" : mot + " " + deFam(fs[0]);
    return mot + " de chaque famille";
  }

  return {
    LX_PISTE_V_ETAT: LX_PISTE_V_ETAT,
    etatEquipe: etatEquipe,
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
    zoneScoreTotal: zoneScoreTotal
  };
});
