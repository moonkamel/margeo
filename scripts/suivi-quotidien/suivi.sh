#!/usr/bin/env bash
# Suivi quotidien du seed Margeo — LECTURE SEULE.
#
#   SUIVI_DATABASE_URL='postgresql://margeo_lecture:…@…/postgres?sslmode=require' ./suivi.sh
#   SUIVI_PLAFOND_CENTS=1500 (facultatif) : plafond affiché à côté de la dépense.
#
# Garde-fous : rôle margeo_lecture (SELECT seul, voir role-lecture-seule.sql) ET session forcée
# en lecture seule (default_transaction_read_only) : toute écriture est refusée par Postgres.
# Le script refuse DATABASE_URL (variable du seed, utilisateur propriétaire) : SUIVI_DATABASE_URL
# est obligatoire. Aucun appel Apify, aucune écriture, aucun fichier produit.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${SUIVI_DATABASE_URL:-}" ]; then
  echo "✖ SUIVI_DATABASE_URL manquant (URL du rôle margeo_lecture, lecture seule)." >&2
  exit 2
fi
if [ -n "${DATABASE_URL:-}" ] && [ "${SUIVI_DATABASE_URL}" = "${DATABASE_URL}" ]; then
  echo "✖ SUIVI_DATABASE_URL est identique à DATABASE_URL (utilisateur propriétaire) : refusé." >&2
  exit 2
fi

donnees="$(PGOPTIONS='-c default_transaction_read_only=on' \
  psql "$SUIVI_DATABASE_URL" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 -f "$ICI/suivi.sql")"

ROUGE='' ; RAZ=''
if [ -t 1 ] || [ -n "${FORCE_COLOR:-}" ]; then ROUGE=$'\033[31m'; RAZ=$'\033[0m'; fi

# awk en octets (LC_ALL=C) + largeurs calculées en caractères UTF-8 : alignement identique sous
# Linux (gawk, mawk) et macOS (awk BSD), malgré « é » et « € ».
printf '%s\n' "$donnees" | LC_ALL=C awk -F '\t' -v rouge="$ROUGE" -v raz="$RAZ" \
  -v date="$(TZ=Europe/Paris date +%Y-%m-%d)" -v plafond="${SUIVI_PLAFOND_CENTS:-}" '
function euros(c) { return sprintf("%.2f €", c / 100) }
function nbcar(t,   u) { u = t; return length(t) - gsub(/[\200-\277]/, "", u) }
function blancs(k,   r) { r = ""; while (k-- > 0) r = r " "; return r }
function gauche(t, w) { return t blancs(w - nbcar(t)) }
function droite(t, w) { return blancs(w - nbcar(t)) t }
function virgule(s) { gsub(/\./, ",", s); return s }
$1 == "cellule" { n++; nom[n] = $2; suivies[n] = $3; s24[n] = $4; d24[n] = $5; med[n] = $6
                  ecart[n] = $8; fp += $9; if (nbcar($2) > larg) larg = nbcar($2) }
$1 == "campagne" { campagne = $2; depense = $3; arret = $4 }
$1 == "non_rattachees" { nonr = $2 }
END {
  if (larg < 14) larg = 14
  printf "Date : %s\n", date
  if (campagne == "") printf "Campagne : aucun run ce mois-ci\n"
  else {
    ligne = sprintf("Campagne %s : %s consommés", campagne, virgule(euros(depense / 1000)))
    if (plafond != "") ligne = ligne sprintf(" / plafond %s", virgule(euros(plafond)))
    if (arret != "") ligne = ligne sprintf(" (arrêt dur %s)", virgule(euros(arret)))
    print ligne
  }
  print ""
  print gauche("Cellule", larg) " | Suivies | SOLD 24h | Disparues 24h | Prix médian | Écart affiché/vendu"
  for (i = 1; i <= n; i++) {
    m = (med[i] == "") ? "—" : virgule(euros(med[i]))
    if (ecart[i] == "") e = "—"
    else if (ecart[i] + 0 > 50) e = rouge sprintf("%s %% ⚠", ecart[i]) raz
    else e = sprintf("%s %%", ecart[i])
    print gauche(nom[i], larg) " | " droite(suivies[i], 7) " | " droite(s24[i], 8) " | " \
      droite(d24[i], 13) " | " droite(m, 11) " | " e
  }
  if (n == 0) print "(aucune annonce suivie)"
  print ""
  printf "Analyses non rattachées : %s\n", (nonr == "" ? 0 : nonr)
  if (fp > 0) printf "%sFaux positifs SOLD potentiels : %d (vente < 50 %% de la médiane de la cellule, à vérifier)%s\n", rouge, fp, raz
  else printf "Faux positifs SOLD potentiels : 0\n"
}'
