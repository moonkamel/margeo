# Margeo Sourcing

Copilote d'achat pour revendeurs Vinted : « si j'achète cet article à ce prix, combien je gagne vraiment ? »

> État : **Phase 1 — Fondations** (monorepo, moteur de marge, schéma de données, squelette API).
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

`pnpm db:migrate` lit `DATABASE_URL` depuis l'environnement : exportez le `.env`
(`set -a && . ./.env && set +a`) ou passez la variable en ligne.

## Structure

```
apps/api            Fastify (GET /health pour l'instant)
packages/shared     Schémas Zod, moteur de marge, estimation, score, quota — fonctions pures
packages/scraper    Interface ScraperDriver + drivers apify (stub Phase 1) et custom (stub, hors MVP)
packages/db         Schéma Prisma + client (migrations dans infra/migrations)
infra/              docker-compose, migrations SQL
```

## Règles de calcul (packages/shared)

- Tous les montants sont en **centimes entiers**.
- `margeNette = revente − achat − fraisVinted − port − emballage − cotisations (12,3 %) − temps`.
- Le prix de revente est la **médiane des ventes réelles** (30 jours glissants, ≥ 5 ventes),
  avec repli (catégorie, marque, taille) → (catégorie, marque) → (catégorie).
  Sans données suffisantes : `insufficient_data`, aucune marge n'est inventée et le quota n'est pas consommé.
- Le prix de vente enregistré est le **dernier prix affiché** avant la vente, pas le prix négocié.
- Barème Vinted : `packages/shared/src/constants/vinted.ts` (date de vérification et valeurs non confirmées signalées).
