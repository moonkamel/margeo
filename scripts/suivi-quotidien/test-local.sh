#!/usr/bin/env bash
# Test du script de suivi sur un Postgres LOCAL uniquement (docker compose up, ou équivalent).
#   TEST_ADMIN_URL=postgresql://margeo:margeo@localhost:5432/margeo ./test-local.sh
# Crée une base temporaire migrée + le rôle margeo_lecture, insère des fixtures, vérifie le
# rapport et que toute écriture est refusée, puis supprime base et rôle. Refuse tout hôte distant.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
ADMIN="${TEST_ADMIN_URL:-postgresql://margeo:margeo@localhost:5432/margeo}"

hote="$(printf '%s' "$ADMIN" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#')"
case "$hote" in localhost | 127.0.0.1 | ::1) ;; *) echo "✖ Test local uniquement (hôte : $hote)" >&2; exit 2 ;; esac

BASE="margeo_suivi_test_$$"
url_base() { printf '%s' "$1" | sed -E "s#/[^/?]+(\?|$)#/$BASE\1#"; }
DB_URL="$(url_base "$ADMIN")"
LECTURE_URL="$(printf '%s' "$DB_URL" | sed -E 's#://[^@]*@#://margeo_lecture:lecture@#')"
echec=0
verifie() { if grep -qF -- "$2" <<<"$1"; then echo "  ✓ $3"; else echo "  ✖ $3 (attendu : $2)"; echec=1; fi; }

nettoie() {
  psql "$ADMIN" -X -q -c "DROP DATABASE IF EXISTS \"$BASE\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql "$ADMIN" -X -q -c "DROP ROLE IF EXISTS margeo_lecture" >/dev/null 2>&1 || true
}
trap nettoie EXIT
nettoie
psql "$ADMIN" -X -q -c "CREATE DATABASE \"$BASE\""
(cd "$RACINE/packages/db" && DATABASE_URL="$DB_URL" pnpm -s exec prisma migrate deploy >/dev/null)
sed "s/REMPLACER-PAR-UN-MOT-DE-PASSE-FORT/lecture/" "$ICI/role-lecture-seule.sql" \
  | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null

psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO "SeedRun" (id, campagne, statut, "budgetMaxCents", "startedAt", "finishedAt", "coutDecouverteMilliCents", "coutSuiviMilliCents")
VALUES (gen_random_uuid(), 'seed-' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM'), 'COMPLETED', 1200, now() - interval '1 day', now(), 6200, 0),
       (gen_random_uuid(), 'seed-' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM'), 'COMPLETED', 1200, now(), now(), 18600, 26600),
       (gen_random_uuid(), 'seed-2020-01', 'COMPLETED', 1200, '2020-01-02', '2020-01-02', 99999000, 0);
INSERT INTO "TrackedListing" (id, "externalId", url, categorie, marque, "prixInitialCents", "prixCourantCents", etat, statut,
  "premiereVuAt", "derniereVuAt", "derniereVerifAt", "soldAt", "soldPrixCents", "soldSource", "catalogIdRecherche")
VALUES
 (gen_random_uuid(),'s1','u','Sweats (F)','Sézane',4000,4000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,13),
 (gen_random_uuid(),'s2','u','Sweats (F)','Sézane',5000,5000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,13),
 (gen_random_uuid(),'s3','u','Sweats (F)','Sézane',6000,6000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,13),
 (gen_random_uuid(),'s4','u','Sweats (F)','Sézane',4500,4500,'BON','SOLD',now(),now(),now(),now() - interval '2 hours',4500,'sold_status',13),
 (gen_random_uuid(),'n1','u','Baskets (H)','Nike',12000,12000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,1242),
 (gen_random_uuid(),'n2','u','Baskets (H)','Nike',12000,12000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,1242),
 (gen_random_uuid(),'n3','u','Baskets (H)','Nike',3000,3000,'BON','SOLD',now(),now(),now(),now() - interval '3 days',3000,'sold_status',1242),
 (gen_random_uuid(),'n4','u','Baskets (H)','Nike',9000,9000,'BON','DISAPPEARED',now(),now(),now(),now() - interval '5 hours',9000,'disappeared',1242),
 (gen_random_uuid(),'m1','u','Baskets','Nike',8000,8000,'BON','ACTIVE',now(),now(),now(),NULL,NULL,NULL,NULL);
SQL

echo "Rapport (rôle margeo_lecture) :"
sortie="$(SUIVI_DATABASE_URL="$LECTURE_URL" SUIVI_PLAFOND_CENTS=1500 "$ICI/suivi.sh")"
printf '%s\n' "$sortie" | sed 's/^/    /'
verifie "$sortie" "consommés / plafond 15,00 € (arrêt dur 12,00 €)" "dépense de la campagne du mois seule : 0,51 € (6,2 + 18,6 + 26,6 c)"
verifie "$sortie" "0,51 €" "montant de la campagne"
verifie "$sortie" "Sweats (F)|Sézane |       3 |        1 |             0 |     50,00 € | 10 %" "Sézane : 3 suivies, 1 vente 24 h, médiane 50 €, écart 10 %"
verifie "$sortie" "Baskets (H)|Nike  |       2 |        0 |             1 |    120,00 € | 75 % ⚠" "Nike : vente ancienne à 30 € signalée (écart 75 %), 1 disparition 24 h"
verifie "$sortie" "Analyses non rattachées : 1" "annonce historique sans catalogue comptée"
verifie "$sortie" "Faux positifs SOLD potentiels : 1" "faux positif potentiel compté"

echo "Garde-fous :"
if PGOPTIONS='-c default_transaction_read_only=on' psql "$LECTURE_URL" -X -q -c 'UPDATE "SeedRun" SET statut = '"'"'FAILED'"'"'' >/dev/null 2>&1; then
  echo "  ✖ une écriture a été acceptée"; echec=1; else echo "  ✓ écriture refusée (session en lecture seule)"; fi
if psql "$LECTURE_URL" -X -q -c 'DELETE FROM "TrackedListing"' >/dev/null 2>&1; then
  echo "  ✖ suppression acceptée sans PGOPTIONS"; echec=1; else echo "  ✓ suppression refusée même sans PGOPTIONS (rôle)"; fi
if psql "$LECTURE_URL" -X -q -c 'SELECT 1 FROM "BrandAlias"' >/dev/null 2>&1; then
  echo "  ✖ lecture d'une table non accordée"; echec=1; else echo "  ✓ tables non accordées illisibles"; fi
if SUIVI_DATABASE_URL= "$ICI/suivi.sh" >/dev/null 2>&1; then echo "  ✖ lancé sans SUIVI_DATABASE_URL"; echec=1; else echo "  ✓ refus sans SUIVI_DATABASE_URL"; fi
if DATABASE_URL="$DB_URL" SUIVI_DATABASE_URL="$DB_URL" "$ICI/suivi.sh" >/dev/null 2>&1; then
  echo "  ✖ accepté avec l'URL propriétaire"; echec=1; else echo "  ✓ refus si SUIVI_DATABASE_URL = DATABASE_URL"; fi
avant="$(psql "$DB_URL" -X -A -t -c 'SELECT count(*) FROM "TrackedListing"')"
[ "$avant" = "9" ] && echo "  ✓ données inchangées après le rapport (9 annonces)" || { echo "  ✖ données modifiées"; echec=1; }

[ "$echec" = 0 ] && echo "✔ Tous les contrôles passent." || { echo "✖ Échec."; exit 1; }
