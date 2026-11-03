# Test des marges sur les annonces suivies (gratuit, lecture seule)

Calcule la marge des annonces `ACTIVE` avec `analyzeListing` (préférences par défaut : 12 €/h,
seuil 5 €, 20 min, emballage 0,50 €), à partir d'un **export JSON**. Le script ne se connecte à
rien : ni base, ni Apify, ni réseau.

1. Exporter (SELECT uniquement) : exécuter `export.sql` avec le rôle `margeo_lecture` ou dans
   l'éditeur SQL Supabase, et enregistrer la valeur de la colonne `export` dans un fichier `.json`
   (hors du dépôt : il contient des URL d'annonces réelles).
2. Calculer :

```bash
packages/scraper/node_modules/.bin/tsx scripts/test-marges-annonces/marges.ts chemin/export.json
```

Test local sans production : `exemple.json` (données **fictives**, 6 ventes Nike 42) montre
le pipeline produire VERT / ORANGE / ROUGE quand des ventes existent.

Sans ventes suffisantes (≥ 5 dans la cellule), le résultat est `insufficient_data` : aucune
médiane n'est inventée. Les statistiques et les anomalies (prix < 5 €, > 3 × ou < ⅓ de la
médiane, marque absente du titre) portent sur les **prix affichés** des annonces suivies, pas
sur des ventes.
