# Scanner de bonnes affaires (V1)

Décisions du 2026-11-03 (outil personnel). Objectif : chaque matin, un message Telegram avec les
meilleures affaires sur des modèles ciblés, chacune avec un lien direct vers l'annonce.

## Méthode d'estimation : prix neuf × coefficient du modèle × état

- Modèles ciblés : `packages/shared/data/target-models.json` (fichier versionné, pas de table).
  `catalogId` fait foi ; `catalogPath` sert seulement au contrôle.
- `coefficientInitial` est exprimé en **très bon état** et déduit des médianes de revente connues
  (Detroit : 49,95 € / ~155 € ≈ 0,32). Les autres états passent par `MULTIPLICATEURS_ETAT_REPLI`.
- Recalage sur les ventes observées du modèle : < 3 ventes → initial ; 3 à 9 → moyenne
  initial / observé ; ≥ 10 → observé seul.
- Prix neufs = **estimations** (`prixVerifie: false`) tant qu'ils ne sont pas vérifiés ; le message
  Telegram le signale.
- Une grille générique « neuf × 0,55 en très bon état » a été écartée : elle surestimait la revente
  de ~70 % (Detroit estimée 85 € pour un marché à 50 €) et aurait produit des faux positifs.

## Reconnaissance du modèle

Marque exacte de l'annonce (« Carhartt » ≠ « Carhartt WIP »), mots-clés en mots entiers, mot-clé
le plus long gagnant (« og detroit », « crawford » avant « detroit »), exclusions communes
(« style », « type », « façon », « like », « inspiré », « replica »…).

## Déroulé d'un scan (`packages/scraper/src/scan`)

1. Une recherche par modèle (texte + catalogue, plus récentes d'abord, sans détails).
2. Filtre sur l'aperçu : marque, modèle, prix < revente maximale du modèle (meilleur état),
   jamais notifiée ; dédoublonnage entre recherches.
3. **Un seul** run de détails pour tous les candidats (30 au plus, les moins chers d'abord).
4. Marge complète (`computeMargin` : frais, port, cotisations, temps), seuil 10 €, top 5.
5. Telegram : synthèse puis une carte par affaire (photo, marge, bouton « Ouvrir sur Vinted »).

Run de détails coupé ou en échec : aucune affaire n'est retenue pour ce scan (alerte).

## Budget

Campagne `scan-YYYY-MM` séparée du seed. Plafond 9,20 € (10 $), arrêt dur 7,36 €. Chaque run
coûte 0,04 $ de frais fixes : 4 recherches + 1 run de détails par jour ≈ 7 à 9 $ / mois.

## Reste à faire (après le compte rendu J+3)

- Run de test facturé (~0,05 $, avec accord) : tri `newest_first`, plusieurs requêtes par run,
  sous-catégorie réelle des Detroit (`categoriesObservees`).
- Table `Deal` (annonces notifiées, pas de données vendeur), CLI et workflow `scan.yml`
  (groupe de concurrence `apify-runs` partagé avec le seed).
- Secrets `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` (jamais dans un fichier ni un log).
- Titres réels d'annonces pour enrichir les tests de reconnaissance.
