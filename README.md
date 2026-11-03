# Margeo Sourcing

Copilote d'achat **personnel** pour revendre sur Vinted : « si j'achète cet article à ce prix,
combien je gagne vraiment ? »

> **Outil personnel** (pivot du 2026-11-02) : pas de SaaS, pas de multi-utilisateur, pas de
> paiement. Trois briques : le **seed** (crawl quotidien des ventes réelles, en cours de test sur
> 3 cellules), une **API minimale** (`POST /analyze`, `GET /estimate`, token fixe) et une
> **extension** side panel. Tant que le seed n'a pas accumulé assez de ventes, les analyses
> renvoient `insufficient_data`.

## Démarrage rapide

Prérequis : Node 22, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # Postgres 16 + Redis 7
pnpm db:generate       # client Prisma
pnpm db:migrate        # applique infra/migrations (nécessite DATABASE_URL, cf. .env)
pnpm test
pnpm --filter @margeo/api dev
curl localhost:3000/health
```

Inspecter une annonce (outil de debug) :

```bash
pnpm scraper:inspect https://www.vinted.fr/items/123456-exemple
pnpm scraper:inspect https://www.vinted.fr/items/123456-exemple --json
```

Sans `APIFY_TOKEN` / `APIFY_ACTOR_ID`, le CLI passe en **mode hors-ligne** : il affiche une
annonce de démonstration issue des fixtures, ne fait aucune requête réseau, ne touche pas au
cache et ne fournit aucune vente (donc `insufficient_data`).

Les tests d'intégration du cache Redis s'exécutent dès que `REDIS_URL` est défini (`.env`).

`pnpm db:migrate` lit `DATABASE_URL` depuis l'environnement : exportez le `.env`
(`set -a && . ./.env && set +a`) ou passez la variable en ligne.

## Structure

```
apps/api            Fastify (GET /health pour l'instant)
packages/shared     Schémas Zod, moteur de marge, estimation, score — fonctions pures
packages/scraper    ScraperDriver, driver apify, normalisation, détection de vente, cache, CLI
                    (driver custom : stub documenté, hors MVP)
packages/db         Schéma Prisma + client (migrations dans infra/migrations)
infra/              docker-compose, migrations SQL
```

## Règles de calcul (packages/shared)

- Tous les montants sont en **centimes entiers**.
- `margeNette = revente − achat − fraisVinted − port − emballage − cotisations (12,3 %) − temps`.
- Statut sur la seule marge nette : `≥ seuil` → VERT, `> 0` → ORANGE, `≤ 0` → ROUGE.
- Score : `100 × (0,7 × clamp(margeNette / max(revente, 1 €)) + 0,3 × vitesse)` ;
  vitesse inconnue → 0,5 et `confidence: 'low'`.
- Le prix de revente est la **médiane des ventes réelles** (30 jours glissants, ≥ 5 ventes),
  avec repli (catégorie, marque, taille) → (catégorie, marque) → (catégorie).
  Sans données suffisantes : `insufficient_data`, aucune marge n'est inventée.
- Le prix de vente enregistré est le **dernier prix affiché** avant la vente, pas le prix négocié.
- Barème Vinted : `packages/shared/src/constants/vinted.ts` (date de vérification et valeurs non confirmées signalées).

## Scraping : sources et limites

- Driver par défaut : **Apify** (`SCRAPER_DRIVER=apify`), via `run-sync-get-dataset-items`.
  Le token passe dans l'en-tête `Authorization`, jamais dans l'URL. Le schéma d'entrée de
  l'acteur est isolé dans `DEFAULT_INPUT_BUILDERS` et sera confirmé sur l'acteur retenu.
- Seul un statut **« sold » explicite** compte comme vente pour les prix. Une disparition
  d'annonce (2 échecs consécutifs espacés d'au moins 12 h) n'est qu'un signal de vitesse.
- Les stats d'une recherche ne gardent que la cellule exacte (catégorie, marque, taille).
- Cache des stats : clé `stats:{categorie}:{marque}:{taille}`, TTL 6 h ; une panne Redis
  dégrade en appel direct, sans faire échouer l'analyse.
- Driver `custom` non implémenté : voir `packages/scraper/src/drivers/custom.ts` (CGU, CNIL, DAC7).

## Crawl de seed (Phase 2b)

Le seed tourne **uniquement depuis GitHub Actions** (`.github/workflows/seed.yml`, quotidien),
jamais depuis une session de dev. Plan, budget et cellules : `docs/phase-2b-seed.md`.

```bash
pnpm seed:run                                   # dry-run par défaut : aucun appel, aucune dépense
pnpm seed:verify-volume [--etape pilotes|reste] # dry-run par défaut
pnpm seed:run --execute --budget-max 10000      # GitHub Actions uniquement
```

- `--budget-max` est le **plafond** mensuel : arrêt dur à 80 % (68 € suivi + 12 € découverte pour
  100 €), code de sortie 3. Vérification du volume : campagne séparée, arrêt dur 11 €.
- `--execute` refuse toute cellule non validée, sans `catalogId`, ou dont la marque a un alias
  non validé (`packages/scraper/seed/cellules.json`, table `BrandAlias`).
- Variables requises en `--execute` (échec immédiat sinon) : `APIFY_TOKEN`, `APIFY_ACTOR_ID`,
  `DATABASE_URL`, `SEED_COUT_PAR_1000_CENTS`, `SEED_COUT_PAR_RUN_CENTS` (frais fixes par run,
  comptés dans l'arrêt dur).
- Dépense passée hors CLI : `pnpm seed:backfill-verify --amount-cents <c> --note "…"`
  (dry-run par défaut).
- **Données personnelles** : le seed ne stocke aucune donnée personnelle vendeur. Les payloads
  bruts sont filtrés par `sanitizeListingPayload` (allowlist, `packages/scraper/src/sanitize.ts`)
  avant insertion en base. Toute évolution du schéma de filtrage doit être validée.
- Rollbacks de migration : `infra/rollbacks/*.down.sql` (à exécuter avec `psql --single-transaction`).

## Limites connues de l'acteur retenu (`abotapi/vinted-fr-scraper`)

- **Pas de taille sur les vêtements** : aucune taille renvoyée sur les annonces de vêtements, même
  avec `fetchDetails` (0 / 10 annonces Sézane testées), alors qu'elle l'est sur les baskets. Les
  cellules de vêtements sont donc estimées au niveau (catégorie, marque), jamais (catégorie,
  marque, taille). Détails : `docs/phase-2b-seed.md`, section 8.15.
- **`fetchDetails` lent** : ~1 s par annonce, avec des pics à 35 s. Runs asynchrones obligatoires
  (`ApifyAsyncRunner`), jamais l'endpoint synchrone limité à 300 s.
- **Pas de compteur total** : une recherche plafonnée à N résultats ne dit pas combien d'annonces
  existent ; la vérification du volume mesure un plancher.
- **Tarif Starter mesuré** : 2,37 $ / 1 000 avec détails, 0,04 $ par run (1 Go de mémoire).

## Points ouverts

- [ ] **Vérifier la grille Vinted Pro** (utile seulement si les ventes passent en mode Pro) (commission forfaitaire 5 €/vente retenue, sources
      contradictoires) et la grille transporteurs (port). Les deux modes sont `verifie: false`
      dans `packages/shared/src/constants/vinted.ts` ; le mode PRO reste masqué
      (`isModeVenteDisponible`) tant qu'il n'est pas vérifié.
- [ ] **Vestiges du modèle SaaS en base** : tables `User`, `MagicLinkToken`, `RefreshToken`,
      `Subscription`, enum `Plan` et colonne `Analysis.consommeQuota` (créées par la migration
      initiale, vides). **Décision du 2026-11-03 : on n'y touche pas avant l'API minimale** ;
      suppression dans une migration dédiée une fois le schéma stabilisé.
