# Margeo Sourcing

Copilote d'achat pour revendeurs Vinted : « si j'achète cet article à ce prix, combien je gagne vraiment ? »

> État : **Phase 2a — Plomberie scraping** (driver Apify testé sur fixtures, normalisation,
> détection de vente, cache Redis, CLI de debug). Aucune donnée de vente réelle pour l'instant :
> les analyses renvoient `insufficient_data` tant que le crawl de seed (Phase 2b) n'a pas tourné.
> Le README complet (déploiement, sécurité CSRF, limites du scraping) arrive en Phase 6.

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
packages/shared     Schémas Zod, moteur de marge, estimation, score, quota — fonctions pures
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
  Sans données suffisantes : `insufficient_data`, aucune marge n'est inventée et le quota n'est pas consommé.
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

## TODO avant ouverture commerciale

- [ ] **Vérifier la grille Vinted Pro** (commission forfaitaire 5 €/vente retenue, sources
      contradictoires) et la grille transporteurs (port). Les deux modes sont `verifie: false`
      dans `packages/shared/src/constants/vinted.ts` ; le mode PRO reste masqué dans l'UI
      (`isModeVenteDisponible`) tant qu'il n'est pas vérifié.
