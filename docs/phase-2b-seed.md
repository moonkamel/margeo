# Phase 2b — Crawl de seed : document à valider

> Statut : **proposition.** Aucun appel Apify n'a été fait. Les 15 cellules sont à
> `valide: false` dans `packages/scraper/seed/cellules.json`, et le CLI refuse de crawler une
> cellule non validée.

## 0. Prérequis de la nouvelle session (dans cet ordre, rien d'autre avant)

1. **Libellé exact de la catégorie pulls**. On lit le catalogue (`curl https://www.vinted.fr/catalog`
   ou URL équivalente), sans test de volume ni appel Apify.
   - On en relève l'identifiant et le slug de catalogue, et on corrige les 3 cellules pulls de
     `cellules.json` avant toute vérification.
   - **Si le libellé est ambigu** (plusieurs candidats, par exemple « Pulls et sweats » et
     « Sweats et pulls ») : on t'envoie le libellé trouvé et on ne lance rien.
2. **Présence du token sans le manipuler** :
   `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer test" https://api.apify.com/v2/users/me`
   - `200` → le proxy injecte le token. Le CLI utilisera ce même test au lieu de lire
     `process.env.APIFY_TOKEN`.
   - `401` → pas de token : on s'arrête, tu reconfigures.
   - Si la variable est dans `process.env`, seul `token.slice(0, 12) + '...'` est affiché.
3. **Alias de marques** : les alias validés de la section 7 sont chargés, et le test de
   non-régression passe.
4. **Code minimal**, puis tests en mock. Aucun appel facturé avant que ces tests passent.
   - Colonne `origine` avec sa contrainte (section 6).
   - Campagne mensuelle (section 3).
   - Table des alias de marques (section 7).
   - Commande `seed:verify-volume` (section 2 bis).

## 1. Acteur Apify — à remplir après le comparatif

| Acteur                                                                         | Schéma d'entrée                                                                                                                                          | Tarif réel / 1 000 résultats                                                                                               | Champ sold natif                                                                                                                                                         | Dernier run                                             | Testé sur 1 URL            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------- |
| `kazkn/vinted-smart-scraper` (fiche lue + 1 run de test le 2026-11-04, 0,02 $) | `query`, `categoryId`, `brandIds`, `sizeIds`, `maxItems` 1–300 ; **aucun paramètre de page ou d'offset** ; **plan Free plafonné à 30 résultats par run** | 2,50 $ (Free), 2,25 $ (Bronze), 2,125 $ (Silver), 1,875 $ (Gold et au-delà) + 0,02 $ par démarrage (Free)                  | **`catalog_id` absent** du payload (test réel) ; mode `SELL_THROUGH_TRACKER`                                                                                             | 2026-11-02 (126 494 runs, 55 utilisateurs sur 30 jours) | oui (1242 Nike)            |
| `abotapi/vinted-fr-scraper` (tests du 2026-11-04 : 3 runs, 0,16 $)             | `queries`, `categoryId`, `brandId`, `maxItems`, `maxPages`, `fetchDetails`, `incrementalMode`/`emitExpired`                                              | 1,80 $ / 1 000 résultats + 0,80 $ / 1 000 détails + 0,05 $ par run (Free) ; **2,60 $ / 1 000 avec `fetchDetails`**, mesuré | **`catalogId` = sous-catégorie réelle avec `fetchDetails: true`** (recherche sur 13 → 529 « Pulls d'hiver », 194 « Cardigans ») ; absent sans ; `isReserved`, `isClosed` | 2026-11-02                                              | oui (1242 Nike, 13 Sézane) |
| `studio-amba/vinted-scraper-v2` (fiche lue, run refusé : plan payant requis)   | modes `index`/`full`/`watch`, `catalogIds`, `watchItemIds`, `missesBeforeVanished`                                                                       | 5,00 $ / 1 000 + 0,01 $ par run                                                                                            | `soldSignal` annoncé, à tester (tests B, C)                                                                                                                              | 2026-11-02 (0 utilisateur sur 30 jours)                 | non                        |

Critères, dans l'ordre :

0. **Éliminatoire (décision du 2026-11-04)** : `catalog_id` (sous-catégorie) présent sur **chaque**
   annonce renvoyée. Sans lui, le seed écarte l'annonce : un acteur qui ne l'expose pas est disqualifié.
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

**Précision attendue à J+28** : 20 annonces actives × 15 cellules = 300 annonces suivies.

- **Ventes attendues** : avec l'hypothèse conservatrice de travail de 7 % par mois (le taux réel est entre 5 et 30 % selon la catégorie et la marque, à mesurer à J+14), environ 21 ventes au total,
  soit environ 1,4 par cellule sur la fenêtre de 30 jours.
- **Niveaux (catégorie, marque, taille) et (catégorie, marque)** : ils resteront presque
  partout sous le minimum de 5 ventes, donc en `insufficient_data`.
- **Niveau (catégorie)** : il regroupe les 5 marques, soit environ 7 ventes, et devrait être le
  seul à franchir le seuil.
- **Affichage** : l'estimation montrera son `niveau` (`categorie`). La confiance sera `low` tant
  que la vitesse de vente est inconnue.

**Le seed de 4 semaines valide le pipeline, il ne produit pas d'estimations précises.** La date
de maturité dépend de la taille du parc par cellule, pas de la durée du crawl (section 3).

## 2 bis. Plan de vérification du volume (`seed:verify-volume`)

- **Budget dédié** : `SEED_VERIFY_BUDGET_CENTS_MAX=900` (9 €), indépendant du budget du seed.
  Il est compté dans une campagne séparée (`verify-YYYY-MM`) pour qu'on sache ce qui a coûté quoi.
- **`--dry-run` par défaut** : la commande affiche les cellules, les URL de catalogue et le coût
  maximal estimé, sans appeler Apify. `--execute` est obligatoire pour dépenser.
- **Mesure**, par ordre de préférence :
  1. comptage seul si l'acteur le permet ;
  2. sinon `maxItems: 250`, où le plafond atteint signifie plus de 250 annonces ;
  3. en repli, `maxItems: 50`.
- **Étape 1 — 3 cellules pilotes** : Baskets|Nike, Pulls|Sézane, Casques|Apple, pour environ 2 €.
- **Étape 2 — les 12 autres**, seulement si les 3 pilotes passent.
- **Remplacements** (Veja → Puma ou Converse, AMI Paris → Lacoste ou Tommy Hilfiger) : uniquement
  après la mesure des 12, jamais avant d'avoir mesuré le volume réel.

**Critères d'arrêt** : on s'arrête et on te consulte dans trois cas.

| Critère                                                               | Effet                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Une cellule pilote sous 200 annonces actives                          | Les 12 autres ne sont pas lancées ; on reconsidère la catégorie entière |
| Budget de vérification de 9 € atteint                                 | Arrêt dur, message explicite                                            |
| Slug ou libellé de catalogue inattendu (ou 0 résultat sur une pilote) | Arrêt, libellé envoyé pour arbitrage                                    |

## 3. Budget — remplacé par la section 8 (plafond dur de 100 €/mois, tiering)

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

### Campagne mensuelle et réapprovisionnement

- **Campagne** : nommée automatiquement `seed-YYYY-MM` (exemple : `seed-2026-11`), selon le
  mois civil en heure de Paris. Le plafond est `SEED_BUDGET_CENTS_MAX`, à 4 800 par défaut,
  défini en variable GitHub.
- **Reprise** : si la campagne du mois existe, le compteur continue. Un nouveau mois ouvre une
  nouvelle campagne avec le compteur à zéro.
- **Garde-fou** : si le budget est épuisé avant la fin du mois, le job échoue (code 3) avec un
  message explicite, par exemple « Budget seed épuisé le 15/11, prochain run le 01/12 ».
  - Les runs suivants du même mois échouent de même, avec le même message, sans aucun appel.
  - Le crawl n'est donc jamais arrêté en silence.

### Budget prévisionnel S+4 à S+12 (à confirmer avec le tarif réel)

Notation : T = tarif de l'acteur en € pour 1 000 résultats.

| Scénario                              | Annonces suivies | Résultats par mois | T = 2,6 € | T = 3,57 € |
| ------------------------------------- | ---------------- | ------------------ | --------- | ---------- |
| Premier cycle : 15 cellules × 20      | 300              | ~9 100             | ~24 €     | ~33 €      |
| Ta proposition S+4 : 30 cellules × 20 | 600              | ~18 200            | ~47 €     | ~65 €      |

Avec un plafond de **80 €/mois**, l'arrêt dur à 80 % tombe à 64 €. Il couvre 30 cellules à
2,6 €, mais il serait atteint en fin de mois si T vaut 3,57 €.

**⚠️ Le plan S+12 ne tient pas avec 20 annonces actives par cellule** (voir ci-dessous).

#### Pourquoi la maturité ne vient pas avec le temps

La médiane est calculée sur une **fenêtre glissante de 30 jours** (décision Q5). Les ventes ne
**s'accumulent donc pas** de mois en mois : à tout instant, une cellule ne compte que les
ventes des 30 derniers jours.

- **Ventes par mois et par cellule** : avec 20 annonces actives et l'hypothèse conservatrice de 7 % (taux réel entre 5 et 30 %, à mesurer à J+14)
  par mois, on obtient environ **1,4 vente**. C'est le cas à S+4 comme à S+12.
- **Pour franchir le minimum de 5 ventes en 30 jours au niveau (catégorie, marque)**, il faut
  environ 5 / 0,07 ≈ **70 annonces actives par cellule**.
- **Au niveau (catégorie, marque, taille)**, il faut ce volume pour chaque taille. Avec 5 à 10
  tailles courantes, cela représente **350 à 700 annonces actives par cellule**.

| Cible                              | Actives par cellule | Pour 15 cellules | Résultats par mois | T = 2,6 €        |
| ---------------------------------- | ------------------- | ---------------- | ------------------ | ---------------- |
| (catégorie, marque) mature         | ~70                 | ~1 050           | ~32 000            | ~83 €/mois       |
| (catégorie, marque, taille) mature | 350 à 700           | 5 250 à 10 500   | 160 000 à 315 000  | 410 à 820 €/mois |

**Options à trancher**, après le pilote J+14 qui mesurera le vrai taux de vente :

- **(a) Agrandir le parc** sur les cellules prioritaires, pour viser la maturité au niveau
  (catégorie, marque) à environ 83 €/mois pour 15 cellules.
- **(b) Fenêtre plus longue** (60 ou 90 jours) en repli, quand la fenêtre de 30 jours est
  insuffisante. Cela modifie la règle Q5 validée et les prix seraient moins frais, mais les
  ventes sont toutes réelles.
- **(c) Accepter le niveau (catégorie) ou (catégorie, marque)** comme niveau de production pour
  la plupart des cellules. Le niveau (catégorie, marque, taille) serait réservé à quelques
  cellules à très fort volume.

Ma recommandation est **(a) ciblé + (c)** : agrandir le parc seulement sur les 3 à 5 cellules
les plus rentables. On ne touche pas à la fenêtre de 30 jours sans ta décision.

## 4. Exécution

Le crawl tourne sur **GitHub Actions** (`.github/workflows/seed.yml`), jamais depuis une session de dev.

- **Planification** : cron quotidien à 5 h UTC, soit 6 h à Paris en hiver.
- **Lancement manuel** : `workflow_dispatch`, avec un champ `cellule` pour le lancement J+1 sur une seule cellule.
- **Logs** : JSON lignes, archivés comme artifact pendant 90 jours, avec un résumé dans le job.
- **Démarrage** : le job échoue immédiatement si `APIFY_TOKEN`, `SEED_DATABASE_URL`, `APIFY_ACTOR_ID` ou `SEED_COUT_PAR_1000_CENTS` manque.

Configuration à créer dans GitHub (Settings → Secrets and variables → Actions) :

| Type     | Nom                        | Valeur                                                                    |
| -------- | -------------------------- | ------------------------------------------------------------------------- |
| Secret   | `APIFY_TOKEN`              | token Apify                                                               |
| Secret   | `SEED_DATABASE_URL`        | URL Postgres de production                                                |
| Variable | `APIFY_ACTOR_ID`           | acteur retenu après comparatif                                            |
| Variable | `SEED_COUT_PAR_1000_CENTS` | tarif réel en centimes d'euro pour 1 000 résultats (ex. 260)              |
| Variable | `SEED_COUT_PAR_RUN_CENTS`  | frais fixes par run de l'acteur, en centimes d'euro (ex. 5) — obligatoire |
| Variable | `SEED_BUDGET_CENTS_MAX`    | plafond mensuel en centimes, 10000 par défaut (arrêt dur 80 %)            |

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
7. **Au-delà de J+28** : le crawl continue en Phase 3, sans interruption. La maturité dépend de
   la taille du parc par cellule, pas de la durée (fenêtre de 30 jours, voir section 3).

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

**Colonne `origine` (validée, à coder en début de session)** :

- `TrackedListing.origine` : `SEED` ou `MIGRATION`, valeur par défaut `MIGRATION` pour que la
  migration existante reste compatible ;
- `INDEX (origine)` ;
- `CHECK (origine <> 'SEED' OR marque IS NOT NULL)`.

Le seed écrit toujours `origine = 'SEED'`. La migration `NOT NULL` stricte sur `marque` est
reportée à la Phase 3.

## 7. Alias de marques (table `BrandAlias`)

- **Champs** : `alias` (texte tel qu'écrit dans l'annonce), `marque` (nom canonique),
  `valide` (faux par défaut), `dateValidation`.
- **Règle** : le seed refuse de crawler une cellule dont la marque a au moins un alias non
  validé, comme pour `cellules.json`.
- **Comparaison existante** : elle ignore déjà la casse et les espaces en début et fin de
  texte. Les variantes de pure casse (`NIKE`, `nike`) sont donc couvertes sans alias ; elles
  restent dans la table pour la traçabilité. Les accents, eux, ne sont pas ignorés : `Sezane`
  a besoin de son alias.

| Marque canonique | Alias validés                                     | Non rattachés (ambigus ou sous-marques)      |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| New Balance      | NewBalance, New-Balance, New balance, new balance | **NB**                                       |
| Nike             | NIKE, nike                                        | —                                            |
| Adidas           | ADIDAS, adidas                                    | **Adidas Originals** (sous-marque distincte) |
| Sézane           | Sezane, SEZANE, Sézane Paris                      | —                                            |
| AMI Paris        | Ami Paris, ami paris                              | **AMI** seul                                 |
| Sandro           | SANDRO, sandro paris                              | —                                            |
| Maje             | MAJE, maje paris                                  | —                                            |
| Ralph Lauren     | RALPH LAUREN, Polo Ralph Lauren                   | **Polo** seul                                |
| Apple            | apple, APPLE                                      | —                                            |
| Sony             | SONY, sony                                        | —                                            |
| Bose             | BOSE, bose                                        | —                                            |
| JBL              | JBL, jbl                                          | —                                            |
| Samsung          | SAMSUNG, samsung                                  | —                                            |

**Test de non-régression de référence** :

- chaque alias validé ci-dessus est rattaché à sa marque canonique ;
- `NB`, `AMI`, `Polo` et `Adidas Originals` ne sont rattachés à **aucune** cellule.

Toute nouvelle validation d'alias passe par ce test.

## 8. Décisions actées le 2026-11-03 (elles priment sur les sections précédentes)

Le seed est l'actif principal du produit : le budget découle des objectifs de donnée, pas l'inverse.

### 8.1 Tiering des cellules (révisable à J+14)

| Tier          | Cellules                                                                                                    | Annonces actives par cellule | Objectif de maturité                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **Priority**  | Baskets\|Nike, Baskets\|Adidas, Casques\|Apple, Casques\|Sony, Pulls\|Sézane                                | 70 minimum                   | (catégorie, marque) à S+4 ; (catégorie, marque, taille) à S+12 sur les tailles les plus fréquentes |
| **Secondary** | Baskets\|New Balance, Baskets\|Asics, Casques\|Bose, Pulls\|Sandro, Pulls\|Maje                             | 30                           | (catégorie, marque) à S+8                                                                          |
| **Tertiary**  | Baskets\|Veja (ou Puma), Casques\|JBL, Casques\|Samsung, Pulls\|Ralph Lauren, Pulls\|AMI Paris (ou Lacoste) | 20                           | (catégorie) à S+4 ; (catégorie, marque) à S+12 si le taux de vente le permet                       |

**À coder en début de session** :

- `cellules.json` gagne les champs `tier` et `cibleActives` ;
- la cible par cellule remplace l'option globale `--cible-actives`.

### 8.2 Budget mensuel : plafond dur à 100 €

Hypothèse : chaque annonce active est re-vérifiée une fois par jour, sur 30 jours.

| Poste                                   | Volume par mois | T = 2,6 € pour 1 000 | T = 3,57 € pour 1 000 |
| --------------------------------------- | --------------- | -------------------- | --------------------- |
| Priority (350 actives)                  | ~10 500         | ~27 €                | ~37 €                 |
| Secondary (150 actives)                 | ~4 500          | ~12 €                | ~16 €                 |
| Tertiary (100 actives)                  | ~3 000          | ~8 €                 | ~11 €                 |
| Découverte (compléter jusqu'aux cibles) | ~3 000          | ~8 €                 | ~11 €                 |
| **Total**                               | ~21 000         | **~55 à 60 €**       | **~75 à 82 €**        |

- **Plafond dur** : `SEED_BUDGET_CENTS_MAX=10000`, soit 100 €/mois. Il remplace le plafond de 48 €.
- **Le crawl n'est pas coupé** pour économiser.
- La vérification du volume garde son budget dédié de 9 €.

### 8.3 `--execute` obligatoire

- **Commandes concernées** : `seed:verify-volume` et `seed:run`. Elles tournent en `--dry-run` par
  défaut et affichent les cellules, les lots et le coût maximal estimé, sans appeler Apify.
- **À coder** : aujourd'hui, `seed:run` exécute directement. Il faut ajouter le mode dry-run par
  défaut et passer `--execute` dans `.github/workflows/seed.yml`.

### 8.4 Re-tiering à J+14 sur le taux de vente réel

**Calcul du taux de vente par cellule** :
ventes `sold_status` observées sur la période ÷ nombre moyen d'annonces actives suivies, ramené à
30 jours. Les disparitions sont rapportées à part, comme signal faible.

| Taux de vente sur 30 jours | Décision                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| Plus de 15 %               | Passage en priority, parc porté à 70 ou plus                                  |
| Entre 7 et 15 %            | Tier inchangé                                                                 |
| Moins de 7 %               | Descente d'un tier, ou remplacement par une autre marque de la même catégorie |

La liste des 15 cellules n'est pas figée : elle est révisée à J+14 sur ces données.

**Plan B, si le taux reste entre 5 et 7 % partout** :

- le produit promet le niveau (catégorie, marque) sur les cellules priority, et le niveau
  (catégorie) ailleurs ;
- le budget mensuel est maintenu ;
- la communication reste honnête.

### 8.5 Transparence dans la payload et l'UI (Phases 3 et 4)

**Deux champs distincts dans la payload** :

- `niveau` : niveau de repli de l'estimation. Valeurs cibles `'taille' | 'marque' | 'categorie'`.
  Aujourd'hui, ce sont `categorie_marque_taille`, `categorie_marque` et `categorie` : renommage à
  faire avec l'API en Phase 3.
- `source` : origine du **multiplicateur d'état**, `'empirical' | 'fallback'`. C'est un concept
  distinct du niveau.

**Nombre de ventes** : `ventesObservees` remplace `nbVentes`, renommage en Phase 3.

**Affichage dans le panneau**, à côté du KPI de marge :
« Basé sur 7 ventes en 30 jours (niveau marque, multiplicateur état empirique) ». La mention
« précision moyenne » apparaît quand le niveau est la marque ou la catégorie.

### 8.6 Marketing

« Nous vous donnons la meilleure estimation possible avec les données disponibles. » Jamais
« prédiction exacte ».

### 8.7 Schéma et alias

- `origine` (`SEED | MIGRATION`), `INDEX (origine)` et `CHECK (origine <> 'SEED' OR marque IS NOT NULL)` :
  validé (section 6).
- Alias de marques : validés (section 7). `NB`, `AMI`, `Polo` et `Adidas Originals` ne sont pas
  rattachés. Le test de non-régression est obligatoire.

### 8.8 Ordre de la nouvelle session

1. Lecture du catalogue Vinted pour le slug exact de la catégorie pulls.
2. Test de présence du token avec `GET /v2/users/me`.
3. **Arrêt immédiat avec compte rendu** si le slug est ambigu ou le token absent.
4. Sinon, déroulé de la section 0 dans l'ordre.

### 8.9 Réponses du 2026-11-03 (fin de session) — à appliquer en début de nouvelle session

1. **Premier cycle** : plafond de **100 € TTC** dès le départ (il remplace 60 € et 48 €), arrêt
   dur à **80 €**, soit 80 % du plafond.
2. **Enveloppes (corrigé le 2026-11-04)** : **68 € de suivi et 12 € de découverte**, soit 85 % / 15 %
   appliqués à l'arrêt dur de 80 € (et non au plafond de 100 €). La découverte est coupée en
   premier ; les 20 € au-delà de l'arrêt dur sont une marge contre les écarts de facturation
   Apify et ne sont jamais dépensés. ~~85 € + 15 €~~ : incohérent avec `BudgetLedger`, abandonné.
3. **Sens de `--budget-max`** : il devient le **plafond** (10 000 centimes), et l'arrêt dur est
   calculé à 80 % de ce plafond. Aujourd'hui, `--budget-max` fixe directement l'arrêt dur : c'est
   à modifier dans le code.
4. **Alerte d'épuisement à 80 € consommés** : le workflow échoue avec le message « Budget seed à
   80 % — prochain run le 01/XX ou ajuster `SEED_BUDGET_CENTS_MAX` ». Les 20 € restants sont une
   marge contre les écarts de facturation Apify ; ils ne sont pas dépensés.
5. **`seed:run`** :
   - `--dry-run` par défaut : il affiche « dry-run, aucune dépense » et sort en succès ;
   - le workflow passe `--execute` et `--budget-max 10000`.
6. **`cellules.json`** : chaque cellule porte trois champs obligatoires.
   - `tier` : `priority`, `secondary` ou `tertiary` ;
   - `cibleActives` : 70, 30 ou 20, et doit correspondre au tier ;
   - `valide` : reste à `false` tant que le volume n'est pas vérifié.

   Un test refuse un fichier où `cibleActives` ne correspond pas au tier.

7. **Ordre strict de la nouvelle session**, avec arrêt net au premier échec :
   1. Libellé et identifiant de la catégorie pulls (si ambigu, compte rendu et rien d'autre).
   2. Test du token avec `/v2/users/me` (si 401, arrêt).
   3. Code : dry-run par défaut de `seed:run`, `tier` et `cibleActives`, budget à 80 % du
      plafond. Tests en mock, puis commit.
   4. `seed:verify-volume --dry-run` sur les 3 pilotes, avec envoi du détail estimé.
   5. **Point de contrôle humain** : aucun `--execute` sans go explicite.

### 8.10 Décisions du 2026-11-04 (appliquées dans le code)

**Catalogues des pulls** (relevés sur vinted.fr ; l'identifiant fait foi, le libellé est cosmétique,
le slug `jumpers-and-sweaters` est commun aux deux et ne suffit pas) :

| Catalogue | Libellé Vinted                 | Cellules                |
| --------- | ------------------------------ | ----------------------- |
| **13**    | Sweats et sweats à capuche (F) | Sézane, Sandro, Maje    |
| **79**    | Sweats et pulls (H)            | AMI Paris, Ralph Lauren |

- **Catégorie parente crawlée entière (option a)** : sur-ensemble des sous-catégories, on filtre
  ensuite en SQL sans re-crawl. `TrackedListing.subcategoryId` / `subcategoryLabel` sont écrits à
  la première observation et immuables.
- **Rattachement** : catalogue de recherche (`TrackedListing.catalogIdRecherche`, immuable) +
  marque canonique via alias validés. Jamais par le libellé.
- **`SubcategoryToParent`** : remplie au fil des observations (`verifie = false`), à vérifier à J+14.
  Une annonce sans sous-catégorie, ou dont la sous-catégorie est déjà rattachée à un autre parent,
  est écartée et signalée (« Élargissement de recherche »).
- **Baskets** : **1242** = Hommes › Chaussures › Baskets (slug `trainers`), relevé le 2026-11-04.
  Côté Femmes : identifiant à relever dans le navigateur. Répartition des 5 marques à trancher.
- **Casques** : **3566** = Électronique › Audio, casques et hi-fi (parent large : enceintes,
  radios…). L'identifiant de la sous-catégorie « Casques audio et écouteurs » reste à relever.
- **Acteur** : candidat principal `kazkn` (Vinted Smart Scraper), secours `abotapi/vinted-fr-scraper`.
  Tarifs, `catalog_id` et pagination à confirmer dans le comparatif avant validation.

**Vérification du volume** : campagne `verify-YYYY-MM`, plafond **12 €**, arrêt dur **11 €**
(environ 92 % ; ce n'est pas la règle des 80 % du seed), `maxItems: 200` par cellule (= seuil).
Raison : 15 cellules × 200 résultats à 3,57 € / 1 000 = 10,71 € ; à 2,60 € / 1 000, 7,80 €.
Le budget de vérification est **additionnel** à celui du seed : plafond global du premier mois
**110 €** (100 € seed + 10 à 11 € vérification), puis 100 € les mois suivants.

**Compteur `analysesNonRattachees`** : annonces ACTIVE sans `catalogIdRecherche` (ancienne
migration), jamais re-vérifiées par le seed. Publié à chaque run (`SeedRun.details`, résumé du job).
S'il est élevé dans deux mois, on envisagera une migration de rattachement rétroactif.

**Colonne `origine` abandonnée** : `catalogIdRecherche IS NULL` = ancienne migration,
`IS NOT NULL` = seed. Une seconde colonne serait une deuxième source de vérité.

**Points de re-tiering à J+14** :

- **Sandro** : démarré en Femmes (13). S'il sous-performe, on ajoute Sandro Hommes (79) en
  cellule #16, sans basculer (les observations Femmes sont conservées).
- **Ralph Lauren** : version large pour le pilote. « Polo Ralph Lauren » (premium) et « Lauren
  Ralph Lauren » (diffuse) ont des gammes de prix disjointes : à scinder si la médiane est trop
  dispersée.

**Risque : taille absente sur les vêtements (abotapi)** — test du 2026-11-04, catalogue 13,
« Sézane », `fetchDetails: true` : **0 annonce sur 5** porte une taille (aucune clé `size*`), alors que
les titres l'indiquent (« Taille TU », « Gr. S », « taille M ») et qu'elle était présente sur
Baskets (1242, « 42 »). Vinted expose donc la taille : c'est l'acteur qui ne la lit pas sur ces
annonces (hypothèse b).

- Conséquence si l'acteur abotapi est retenu : les cellules Sézane — et probablement toutes les
  cellules des catalogues 13 et 79, à confirmer — sont calculées au niveau **(catégorie, marque)**
  uniquement, affiché `niveau: 'marque'` dans l'UI. Précision moindre, produit intact.
- L'annonce sans taille est acceptée (`taille: null`, avertissement `taille_absente`).
- À re-vérifier sur studio-amba (tests B et C) avant le choix final de l'acteur.

**Données personnelles** : `sanitizeListingPayload` (allowlist) filtre chaque payload avant
stockage — aucun champ vendeur, ni `description`, ni photo. Toute évolution de la liste est validée. `size`,
`size_title`, `sizeId`, `size_id` y figurent ; `itemClosingAction` / `item_closing_action` en sont
retirés (ambigus, non utilisés).

**Prérequis durs avant tout `--execute`** : identifiants Baskets et Casques, acteur Apify choisi
après le comparatif (section 1) et validé.

### 8.11 Décisions du 2026-11-04 (fin de journée)

**Acteur primaire : `abotapi/vinted-fr-scraper`** (`fetchDetails: true`). `catalogId` = sous-catégorie
réelle, marque normalisée, adaptateur codé. `studio-amba` reste en réserve : il exige un plan
payant ; il sera testé au passage au plan Starter (juste avant J+1 du seed), et on bascule s'il
fonctionne mieux. Le plan Starter n'est pas pris pendant le développement.

**Frais fixes par run comptés dans l'arrêt dur** (faille corrigée, prérequis bloquant de tout
`--execute`) : chaque réservation = frais du run + résultats max × tarif ; un run sans résultat
coûte ses frais. `SEED_COUT_PAR_RUN_CENTS` est obligatoire en `--execute`.

- Effet mesuré au dry-run (hypothèse 5 c par run, 27 runs par jour au plus : 12 lots de suivi de
  50 + 15 découvertes) : 1,35 € par jour de frais fixes. **Au rythme maximal, l'arrêt dur de 80 €
  tombe vers le jour 26 (2,60 € / 1 000) ou 22 (3,57 € / 1 000).** Le rythme maximal suppose une
  découverte pleine chaque jour, ce qui n'arrive que pendant le remplissage des parcs.
- Levier sans toucher au budget : des lots de re-vérification de 100 au lieu de 50 (6 runs de
  suivi au lieu de 12, environ 9 € par mois de frais en moins). À décider.

**Backfill** : `pnpm seed:backfill-verify --amount-cents <c> --note "…"` (dry-run par défaut,
`--execute` avec `DATABASE_URL`) saisit une dépense passée hors CLI dans `verify-YYYY-MM`. À
exécuter sur la base de production : 24 c, « tests acteurs du 2026-11-04 » (0,236 $ facturés).

**Taille absente** : la chaîne complète est testée (payload abotapi sans taille → seed → vente →
estimation au niveau (catégorie, marque), sans erreur).
