(function () {
  "use strict";

  var etat = {
    data: null,
    selection: new Set() // ids des mesures cochées
  };

  var fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3, minimumFractionDigits: 0 });

  function formatMds(valeur, avecSigne) {
    var abs = Math.abs(valeur);
    var texte = fmt.format(abs) + " Mds€";
    if (avecSigne) {
      if (valeur > 0) texte = "+" + texte;
      else if (valeur < 0) texte = "-" + texte;
      else texte = "0 Mds€";
    }
    return texte;
  }

  function formatPct(valeur) {
    return fmt.format(Math.round(valeur * 10) / 10) + " %";
  }

  // ---------- Chargement des données ----------
  fetch("data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("Impossible de charger data.json (" + r.status + ")");
      return r.json();
    })
    .then(function (data) {
      etat.data = data;
      rendreContexte(data);
      rendreChapitres(data);
      recalculer();
    })
    .catch(function (err) {
      document.getElementById("chapitres").innerHTML =
        '<p style="color:#fff;padding:12px 4px;">Erreur de chargement des données (' +
        (err && err.message ? err.message : err) +
        "). Si vous ouvrez ce fichier directement depuis votre disque, lancez un petit serveur local (ex. <code>python3 -m http.server</code>) puis rechargez, ou déployez le dossier sur GitHub Pages.</p>";
    });

  // ---------- Rendu du bloc de contexte ----------
  function rendreContexte(data) {
    var ul = document.getElementById("contexte-liste");
    ul.innerHTML = "";
    data.contexte.items.forEach(function (texte) {
      var li = document.createElement("li");
      li.textContent = texte;
      ul.appendChild(li);
    });
    document.getElementById("val-cible").textContent =
      "Objectif : " + fmt.format(data.meta.deficit_cible_pct) + " %";
  }

  // ---------- Rendu des chapitres ----------
  function rendreChapitres(data) {
    var main = document.getElementById("chapitres");
    main.innerHTML = "";

    data.chapitres.forEach(function (chapitre) {
      var ouvert = chapitre.id === "orientations";

      var section = document.createElement("section");
      section.className = "chapitre";
      section.dataset.ouvert = ouvert ? "true" : "false";
      section.id = "chap-" + chapitre.id;

      var entete = document.createElement("button");
      entete.type = "button";
      entete.className = "chapitre-entete";
      entete.setAttribute("aria-expanded", ouvert ? "true" : "false");
      entete.innerHTML =
        '<span class="titre-wrap"><h3>' +
        echapper(chapitre.titre) +
        '</h3><span class="sous-total" data-role="sous-total"></span></span>' +
        '<span class="chevron" aria-hidden="true">' +
        iconeChevron() +
        "</span>";
      entete.addEventListener("click", function () {
        var estOuvert = section.dataset.ouvert === "true";
        section.dataset.ouvert = estOuvert ? "false" : "true";
        entete.setAttribute("aria-expanded", estOuvert ? "false" : "true");
      });
      section.appendChild(entete);

      if (chapitre.notes && chapitre.notes.length) {
        var notes = document.createElement("div");
        notes.className = "chapitre-notes";
        notes.innerHTML = chapitre.notes.map(echapper).join("<br>");
        section.appendChild(notes);
      }

      var corps = document.createElement("div");
      corps.className = "chapitre-corps";
      chapitre.mesures.forEach(function (mesure) {
        corps.appendChild(rendreMesure(mesure));
      });
      section.appendChild(corps);

      main.appendChild(section);
    });
  }

  function rendreMesure(mesure) {
    var row = document.createElement("div");
    row.className = "mesure";

    var idCase = "case-" + mesure.id;
    // Affichage "naturel" : une dépense qui augmente s'affiche en +, une recette qui augmente aussi.
    // (impact_mds représente l'effet sur le déficit ; pour une dépense, c'est l'inverse de l'effet affiché.)
    var valeurAffichee = mesure.categorie === "depense" ? -mesure.impact_mds : mesure.impact_mds;
    var texteChip = formatMds(valeurAffichee, true);

    var aInfo = !!(mesure.source || mesure.note);

    row.innerHTML =
      '<label class="case" for="' +
      idCase +
      '">' +
      '<input type="checkbox" id="' +
      idCase +
      '" data-id="' +
      mesure.id +
      '">' +
      '<span class="boite">' +
      iconeCoche() +
      "</span>" +
      "</label>" +
      '<div class="contenu">' +
      '<div class="ligne-haut">' +
      '<label class="libelle" for="' +
      idCase +
      '">' +
      echapper(mesure.libelle) +
      "</label>" +
      "</div>" +
      (mesure.note ? '<p class="note">' + echapper(mesure.note) + "</p>" : "") +
      '<div class="bas">' +
      '<span class="chip">' +
      '<span class="montant">' +
      texteChip +
      '</span><span class="type-libelle">' +
      echapper(mesure.type_libelle) +
      "</span></span>" +
      (aInfo
        ? '<button type="button" class="btn-info" data-info="' + mesure.id + '" aria-label="Voir la source">i</button>'
        : "") +
      "</div>" +
      "</div>";

    var checkbox = row.querySelector("input[type=checkbox]");
    checkbox.addEventListener("change", function () {
      if (checkbox.checked) etat.selection.add(mesure.id);
      else etat.selection.delete(mesure.id);
      recalculer();
    });

    if (aInfo) {
      row.querySelector(".btn-info").addEventListener("click", function () {
        ouvrirSource(mesure);
      });
    }

    return row;
  }

  // ---------- Calculs et bandeau ----------
  function trouverToutesLesMesures() {
    var toutes = [];
    etat.data.chapitres.forEach(function (ch) {
      ch.mesures.forEach(function (m) {
        toutes.push(Object.assign({ chapitreId: ch.id }, m));
      });
    });
    return toutes;
  }

  function recalculer() {
    if (!etat.data) return;
    var toutes = trouverToutesLesMesures();
    var cochees = toutes.filter(function (m) {
      return etat.selection.has(m.id);
    });

    // Recettes en plus : positif si les mesures cochées augmentent les recettes, négatif si elles les diminuent.
    var recettesEnPlus = cochees
      .filter(function (m) {
        return m.categorie === "recette";
      })
      .reduce(function (s, m) {
        return s + m.impact_mds;
      }, 0);

    // Dépenses en plus : positif si les mesures cochées augmentent la dépense, négatif si elles l'économisent.
    var depensesEnPlus = cochees
      .filter(function (m) {
        return m.categorie === "depense";
      })
      .reduce(function (s, m) {
        return s - m.impact_mds;
      }, 0);

    // Le déficit se dégrade avec les dépenses en plus, et s'améliore avec les recettes en plus.
    var variationDeficitMds = depensesEnPlus - recettesEnPlus;
    var deficitPct = etat.data.meta.deficit_sans_mesure_pct + variationDeficitMds / etat.data.meta.mds_par_point;

    var elRecettes = document.getElementById("val-recettes");
    elRecettes.textContent = formatMds(recettesEnPlus, true);
    elRecettes.className = "valeur " + (recettesEnPlus >= 0 ? "bon" : "attention");

    var elDepenses = document.getElementById("val-depenses");
    elDepenses.textContent = formatMds(depensesEnPlus, true);
    elDepenses.className = "valeur " + (depensesEnPlus <= 0 ? "bon" : "attention");

    var elDeficit = document.getElementById("val-deficit");
    elDeficit.textContent = formatPct(deficitPct);
    elDeficit.className = "valeur " + (deficitPct <= etat.data.meta.deficit_cible_pct ? "bon" : "attention");

    // Sous-totaux par chapitre
    etat.data.chapitres.forEach(function (ch) {
      var section = document.getElementById("chap-" + ch.id);
      if (!section) return;
      var sousTotalEl = section.querySelector('[data-role="sous-total"]');
      var sousTotal = ch.mesures.reduce(function (s, m) {
        return s + (etat.selection.has(m.id) ? m.impact_mds : 0);
      }, 0);
      var nbCoches = ch.mesures.filter(function (m) {
        return etat.selection.has(m.id);
      }).length;
      if (nbCoches === 0) {
        sousTotalEl.textContent = ch.mesures.length + " mesure" + (ch.mesures.length > 1 ? "s" : "");
        sousTotalEl.classList.remove("actif");
      } else {
        sousTotalEl.textContent = nbCoches + " sélectionnée" + (nbCoches > 1 ? "s" : "") + " · " + formatMds(sousTotal, true);
        sousTotalEl.classList.add("actif");
      }
    });
  }

  // ---------- Modales ----------
  function ouvrirSource(mesure) {
    document.getElementById("source-titre").textContent = mesure.libelle;
    var morceaux = [];
    if (mesure.source) morceaux.push("Source : " + mesure.source);
    if (mesure.note) morceaux.push(mesure.note);
    document.getElementById("source-texte").textContent = morceaux.join(" — ");
    ouvrirOverlay("overlay-source");
  }

  function ouvrirOverlay(id) {
    document.getElementById(id).classList.add("ouvert");
  }
  function fermerOverlay(id) {
    document.getElementById(id).classList.remove("ouvert");
  }

  document.querySelectorAll("[data-fermer]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      fermerOverlay(btn.getAttribute("data-fermer"));
    });
  });
  document.querySelectorAll(".overlay").forEach(function (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.classList.remove("ouvert");
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".overlay.ouvert").forEach(function (o) {
        o.classList.remove("ouvert");
      });
    }
  });

  document.getElementById("btn-mentions").addEventListener("click", function () {
    ouvrirOverlay("overlay-mentions");
  });
  document.getElementById("btn-contact").addEventListener("click", function () {
    ouvrirOverlay("overlay-contact");
  });

  document.getElementById("btn-reset").addEventListener("click", function () {
    etat.selection.clear();
    document.querySelectorAll('.mesure input[type="checkbox"]').forEach(function (cb) {
      cb.checked = false;
    });
    recalculer();
  });

  // ---------- Utilitaires ----------
  function echapper(texte) {
    var div = document.createElement("div");
    div.textContent = texte == null ? "" : texte;
    return div.innerHTML;
  }

  function iconeCoche() {
    return '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8.5L6.2 11.5L13 4.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function iconeChevron() {
    return '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
})();
