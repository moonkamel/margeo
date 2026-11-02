# Phase 2b — Crawl de seed : document à valider

> Statut : **proposition.** Aucun appel Apify n'a été fait. Les 15 cellules sont à
> `valide: false` dans `packages/scraper/seed/cellules.json`, et le CLI refuse de crawler une
> cellule non validée.

## 1. Acteur Apify — à remplir après le comparatif

| Acteur | Schéma d'entrée | Tarif réel / 1 000 résultats | Champ sold natif | Dernier run | Testé sur 1 URL |
| ------ | --------------- | ---------------------------- | ---------------- | ----------- | --------------- |
| —      | —               | —                            | —                | —           | —               |
| —      | —               | —                            | —                | —           | —               |
| —      | —               | —                            | —                | —           | —               |

Critères, dans l'ordre :

1. payload stable et documenté ;
2. au plus 4 $ pour 1 000 résultats ;
3. champ `sold` ou statut exposé nativement ;
4. maintenu dans les 30 derniers jours.

Le comparatif se fera dans une nouvelle session, où le token sera disponible.

## 2. Les 15 cellules (3 catégories × 5 marques, aucune marque de luxe)

| #   | Catégorie Vinted            | Marque       | Justification                                                               |
| --- | --------------------------- | ------------ | --------------------------------------------------------------------------- |
| 1   | Baskets                     | Nike         | Marque de sneakers grand public                                             |
| 2   | Baskets                     | Adidas       | Idem                                                                        |
| 3   | Baskets                     | New Balance  | Citée comme marque à forte rotation (sell-through 61 %, source non auditée) |
| 4   | Baskets                     | Asics        | Sneakers lifestyle en vogue, à confirmer au comptage                        |
| 5   | Baskets                     | Veja         | Marque française, à confirmer au comptage                                   |
| 6   | Pulls (libellé à confirmer) | Sézane       | Citée comme marque préférée des utilisatrices Vinted (étude Vendy 2026)     |
| 7   | Pulls (libellé à confirmer) | AMI Paris    | Ta proposition ; premium contemporain, pas du luxe                          |
| 8   | Pulls (libellé à confirmer) | Sandro       | Citée dans les marques mid-premium françaises « les plus tournantes »       |
| 9   | Pulls (libellé à confirmer) | Maje         | Idem                                                                        |
| 10  | Pulls (libellé à confirmer) | Ralph Lauren | Premium, très présent en seconde main, à confirmer au comptage              |
| 11  | Casques audio et écouteurs  | Apple        | Ta proposition (AirPods) ; libellé de catégorie vu sur des annonces         |
| 12  | Casques audio et écouteurs  | Sony         | Ta proposition                                                              |
| 13  | Casques audio et écouteurs  | Bose         | Marque audio grand public                                                   |
| 14  | Casques audio et écouteurs  | JBL          | Idem                                                                        |
| 15  | Casques audio et écouteurs  | Samsung      | Galaxy Buds                                                                 |

Pour la tech, on garde une catégorie précise (casques et écouteurs) plutôt que « Tech » au sens
large : Apple, Sony et Samsung y vendent des produits comparables, ce qui rend la médiane
interprétable. La taille n'a pas de sens ici, donc les stats se font au niveau (catégorie, marque).

**Ce qui n'est PAS vérifié** :

- **Volume minimum (200 annonces actives par cellule)** : aucune source publique ne donne ce
  chiffre et je n'ai pas interrogé Vinted. Je ne peux donc pas le garantir.
- **Libellés exacts des catégories** : « Baskets » et « Casques audio et écouteurs » ont été
  observés dans des fils d'Ariane d'annonces. Le libellé de la catégorie pulls reste inconnu.

**Vérification du volume (décidée)** : comptage par Apify, sans comptage manuel.

- **Coût :** environ 9 € au maximum, imputés sur l'enveloppe découverte. Ils doivent être
  enregistrés dans `SeedRun` pour que l'arrêt dur en tienne compte.
- **Ordre :**
  1. 3 cellules pilotes d'abord, une par catégorie : Baskets|Nike, Pulls|Sézane,
     Casques|Apple, pour environ 2 €.
  2. Si les 3 passent, les 12 autres.
  3. Si une pilote échoue, on arrête et on reconsidère la catégorie entière.
- **Méthode :**
  1. Comptage seul si l'acteur le permet.
  2. Sinon `maxItems: 250` : atteindre le plafond signifie plus de 250 annonces.
  3. En dernier recours, `maxItems: 50` avec extrapolation, ce qui suffit à éliminer les
     cellules sous 50 annonces.
- **Catégorie « Pulls » vérifiée en premier**, avec l'identifiant ou le slug de catalogue exact
  dans l'URL, pas du texte libre. Libellés probables : « Pulls et sweats », « Sweats et pulls ».
  Le paramètre de catalogue sera ajouté à la recherche une fois l'identifiant connu.
- **Remplacements prévus** si une cellule a moins de 200 annonces actives :
  - Veja → Puma ou Converse ;
  - AMI Paris → Lacoste ou Tommy Hilfiger.
- **New Balance :** tester que les variantes « New Balance », « NewBalance » et « NB » sont bien
  rattachées à la même marque. Aujourd'hui, la comparaison est exacte (casse et espaces
  ignorés) : « NewBalance » et « NB » ne correspondraient PAS. Il faudra une table d'alias de
  marques, à valider avec toi.

**Précision attendue à J+28** : 20 annonces actives × 15 cellules = 300 annonces suivies. Avec
un taux de vente de 5 à 10 % par mois, on peut espérer environ 21 ventes au total, soit environ
1,4 par cellule. Le niveau (catégorie, marque, taille) restera donc `insufficient_data` presque
partout. Les estimations viendront du niveau (catégorie, marque) pour les cellules à fort
volume, et du niveau (catégorie) pour les autres, affichées avec `source: 'fallback'` et
`confidence: 'low'`. **Le seed de 4 semaines valide le pipeline, il ne produit pas
d'estimations précises.** Un niveau (catégorie, marque, taille) exploitable est visé vers
**S+12** : c'est la date de disponibilité commerciale réaliste.

## 3. Budget : 60 € TTC maximum, arrêt dur dans le code à 48 €

| Enveloppe  | Plafond  | Volume prévu                                                     |
| ---------- | -------- | ---------------------------------------------------------------- |
| Suivi      | 30 €     | ~300 annonces × 28 jours ≈ 8 400 résultats                       |
| Découverte | 18 €     | remplissage initial (~300) + remplacements, ≤ 5 / cellule / jour |
| **Total**  | **48 €** | arrêt dur (80 % de 60 €)                                         |

**Correction apportée au plan** : la découverte complète jusqu'à un **parc cible de 20 annonces
actives par cellule** (`--cible-actives 20`), avec au plus 5 résultats par cellule et par jour.
Sans cette cible, le parc grossirait de 75 annonces par jour. On passerait alors à environ
28 000 re-vérifications sur 4 semaines, soit environ 74 € à 2,6 € pour 1 000, au lieu de 8 400.
Conséquence : le parc complet est atteint vers J+4.

**Tarif plafond pour tenir dans les enveloppes** : 8 400 résultats de suivi pour 30 € donnent
un maximum de 0,357 c par résultat, soit **3,57 € pour 1 000 résultats**. C'est cohérent avec ton
critère de 4 $ pour 1 000. Au-delà, on réduit le périmètre, on n'augmente pas le budget.

**Garanties du code** (`packages/scraper/src/seed/`, 135 tests en mock, sans réseau) :

- Avant chaque appel, son coût **maximal** est réservé (`maxItems` × tarif). Un appel qui ferait
  dépasser 48,00 € est refusé. Le test vérifie qu'on atteint 48,00 € et jamais 48,01 €.
- La dépense est persistée en base (`SeedRun`) **après chaque appel**. Un crash ne la fait pas
  oublier, et la campagne reprend avec le bon cumul.
- Un appel en échec est compté au coût maximal, par prudence.
- Si l'enveloppe de suivi déborde, **la découverte est coupée en premier**.
- À l'arrêt dur, le job GitHub échoue avec le code 3 et une annotation « ARRÊT DUR », ce qui
  déclenche une notification GitHub.
- **Deuxième filet, côté Apify** : je recommande de régler une limite d'usage mensuelle sur le
  compte Apify (Billing → Usage limit) à 50 $ environ. Le compteur local repose sur le tarif
  déclaré, alors que la facture réelle peut inclure du calcul en plus.

### Coût au-delà du premier cycle

Le seed de 4 semaines est un **premier cycle de validation**, pas la durée de vie du crawl.
Notation : T = tarif réel de l'acteur, en € pour 1 000 résultats.

| Période                                    | Volume estimé                                                               | Coût à T = 2,6 € | Coût à T = 3,57 € |
| ------------------------------------------ | --------------------------------------------------------------------------- | ---------------- | ----------------- |
| Premier cycle (4 semaines)                 | ~8 400 suivi + ~300 remplissage + ~100 remplacements + ≤ 3 000 vérification | ~31 €            | ~43 €             |
| Régime établi (par mois, Phase 3 et suite) | ~9 000 suivi + ~100 remplacements                                           | ~24 €/mois       | ~33 €/mois        |

Ces chiffres seront recalculés avec le tarif réel après le comparatif.
**Réapprovisionnement** : le budget est piloté par une variable `SEED_BUDGET_CENTS_MAX`, à
ajuster chaque mois. Le mécanisme exact reste à valider (voir les questions en fin de message).

## 4. Exécution

Le crawl tourne sur **GitHub Actions** (`.github/workflows/seed.yml`), jamais depuis une session de dev.

- **Planification** : cron quotidien à 5 h UTC, soit 6 h à Paris en hiver.
- **Lancement manuel** : `workflow_dispatch`, avec un champ `cellule` pour le lancement J+1 sur une seule cellule.
- **Logs** : JSON lignes, archivés comme artifact pendant 90 jours, avec un résumé dans le job.
- **Démarrage** : le job échoue immédiatement si `APIFY_TOKEN`, `SEED_DATABASE_URL`, `APIFY_ACTOR_ID` ou `SEED_COUT_PAR_1000_CENTS` manque.

Configuration à créer dans GitHub (Settings → Secrets and variables → Actions) :

| Type     | Nom                        | Valeur                                                       |
| -------- | -------------------------- | ------------------------------------------------------------ |
| Secret   | `APIFY_TOKEN`              | token Apify                                                  |
| Secret   | `SEED_DATABASE_URL`        | URL Postgres de production                                   |
| Variable | `APIFY_ACTOR_ID`           | acteur retenu après comparatif                               |
| Variable | `SEED_COUT_PAR_1000_CENTS` | tarif réel en centimes d'euro pour 1 000 résultats (ex. 260) |
| Variable | `SEED_CAMPAIGN`            | ex. `seed-2026-11`                                           |

Le cron ne s'exécute que depuis la branche par défaut : rien ne tourne avant le merge.

## 5. Séquence

1. Ta validation de ce document : liste des cellules et méthode de vérification du volume.
2. Comparatif des 3 acteurs (nouvelle session), tableau de la section 1 rempli, mapping
   `DEFAULT_INPUT_BUILDERS` calé sur l'acteur retenu.
3. Ta validation de l'acteur. On passe les cellules à `valide: true` et on configure GitHub.
4. **J+1** : `workflow_dispatch` sur 1 cellule (la plus prometteuse : Baskets|Nike), puis contrôle des données réelles.
5. **J+2** : les 14 autres cellules.
6. **J+14** : checkpoint durci.
   - Aucune cellule avec au moins 2 ventes observées → on arrête et on reconsidère le périmètre.
   - Au moins 5 cellules avec 2 ventes ou plus → on continue.
7. **Au-delà de J+28** : le crawl continue en Phase 3, sans interruption, pour faire mûrir les
   données jusqu'à S+12.

## 6. Stockage (migration déjà livrée, commit séparé)

- **`TrackedListing`** : état courant d'une annonce suivie.
  - Une contrainte CHECK garantit que le statut vendu ou disparu et les informations de vente sont toujours renseignés ensemble.
- **`ListingObservation`** : journal append-only de snapshots, relié à `trackedListingId`.
  - Une annonce « introuvable » n'y écrit rien : elle incrémente seulement `echecsConsecutifs`.
- **`SoldObservation`** : projection de `TrackedListing`, écrite dans la même transaction que le passage à `SOLD` ou `DISAPPEARED`.
- **`SeedRun`** : un enregistrement par exécution, avec la dépense par enveloppe et les compteurs.

Deux écarts par rapport à ta spécification de `TrackedListing` :

- **`taille` est nullable**, parce que la catégorie tech n'a pas de taille.
- **`marque` est aussi nullable**, pour pouvoir reprendre les observations existantes, dont la
  marque pouvait être absente. Le seed, lui, n'écrit que des annonces avec marque, puisque le
  filtre de cellule l'exige. Dis-moi si tu veux un `NOT NULL` strict ; il demanderait une migration
  de nettoyage.
