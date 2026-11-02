# Suivi quotidien du seed (lecture seule)

Rapport quotidien du test de pipeline (doc 2b, section 8.16) : annonces suivies, ventes et
disparitions des dernières 24 h, prix médian et écart des ventes par cellule, faux positifs `SOLD`
potentiels, annonces non rattachées, dépense de la campagne du mois.

**Hors du code du seed** : ce dossier n'est ni un paquet du workspace ni lu par les workflows.
Aucune dépendance Node : `bash`, `awk` et `psql` uniquement. Aucun appel Apify.

## Lecture seule, trois fois

1. **Rôle `margeo_lecture`** (`role-lecture-seule.sql`) : `SELECT` sur `TrackedListing` et `SeedRun`
   seulement, transactions en lecture seule par défaut. Deux policies RLS de lecture, réservées à ce
   rôle (RLS est actif sans policy : sans elles, le rôle ne verrait aucune ligne) ; l'API publique
   Supabase reste fermée.
2. **Session forcée en lecture seule** (`default_transaction_read_only=on`) par `suivi.sh`.
3. **`SUIVI_DATABASE_URL` obligatoire**, refusée si elle est identique à `DATABASE_URL` (utilisateur
   propriétaire du seed).

## Mise en place (une fois, par un administrateur)

Dans Supabase → SQL Editor : exécuter `role-lecture-seule.sql` après avoir remplacé le mot de passe.
URL de connexion : celle du Session pooler, avec l'utilisateur `margeo_lecture.<ref du projet>`.

## Utilisation

```bash
SUIVI_DATABASE_URL='postgresql://margeo_lecture.<ref>:<mot de passe>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require' \
SUIVI_PLAFOND_CENTS=1500 ./suivi.sh
```

- **Écart affiché/vendu** : plus grand écart entre le prix de vente stocké et la médiane des
  annonces actives de la cellule. Au-delà de 50 % : signalé (en rouge dans un terminal).
- **Faux positifs SOLD potentiels** : ventes à moins de 50 % de la médiane de leur cellule — soit
  une vraie affaire, soit une fausse vente : à vérifier à la main.

## Test (Postgres local uniquement)

```bash
TEST_ADMIN_URL=postgresql://margeo:margeo@localhost:5432/margeo ./test-local.sh
```

Base temporaire migrée, rôle de lecture, fixtures (dont une vente suspecte et une annonce non
rattachée), vérification du rapport et du refus de toute écriture, puis nettoyage. Refuse tout
hôte autre que `localhost`.
