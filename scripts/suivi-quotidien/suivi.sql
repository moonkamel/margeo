-- Suivi quotidien du seed : LECTURE SEULE (aucune écriture, aucune fonction volatile d'écriture).
-- Sortie : lignes « type<TAB>champs… », mises en forme par suivi.sh.
\set ON_ERROR_STOP on
WITH cellules AS (
    SELECT "catalogIdRecherche" AS catalogue, "marque",
           min("categorie") AS libelle,
           count(*) FILTER (WHERE "statut" = 'ACTIVE') AS suivies,
           count(*) FILTER (WHERE "statut" = 'SOLD' AND "soldAt" >= now() - interval '24 hours') AS sold_24h,
           count(*) FILTER (WHERE "statut" = 'DISAPPEARED' AND "soldAt" >= now() - interval '24 hours') AS disparues_24h,
           count(*) FILTER (WHERE "statut" = 'SOLD') AS sold_total,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "prixCourantCents")
               FILTER (WHERE "statut" = 'ACTIVE') AS mediane_cents
    FROM "TrackedListing"
    WHERE "catalogIdRecherche" IS NOT NULL
    GROUP BY 1, 2
),
ventes AS (
    -- Écart relatif entre le prix de vente stocké et la médiane des annonces actives de la cellule.
    SELECT c.catalogue, c."marque",
           max((c.mediane_cents - t."soldPrixCents") / c.mediane_cents) AS ecart_max,
           count(*) FILTER (WHERE t."soldPrixCents" < 0.5 * c.mediane_cents) AS faux_positifs
    FROM cellules c
    JOIN "TrackedListing" t
      ON t."catalogIdRecherche" = c.catalogue AND t."marque" = c."marque" AND t."statut" = 'SOLD'
    WHERE c.mediane_cents > 0 AND t."soldPrixCents" IS NOT NULL
    GROUP BY 1, 2
)
SELECT 'cellule', c.libelle || '|' || c."marque", c.suivies, c.sold_24h, c.disparues_24h,
       coalesce(round(c.mediane_cents)::bigint::text, ''), c.sold_total,
       coalesce(round(v.ecart_max * 100)::text, ''), coalesce(v.faux_positifs, 0)
FROM cellules c LEFT JOIN ventes v USING (catalogue, "marque")
ORDER BY c.catalogue, c."marque";

-- Dépense de la campagne du mois (heure de Paris) et arrêt dur enregistré par le dernier run.
SELECT 'campagne', "campagne",
       sum("coutSuiviMilliCents" + "coutDecouverteMilliCents"),
       (array_agg("budgetMaxCents" ORDER BY "startedAt" DESC))[1],
       count(*)
FROM "SeedRun"
WHERE "campagne" = 'seed-' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM')
GROUP BY "campagne";

SELECT 'non_rattachees', count(*) FROM "TrackedListing"
WHERE "statut" = 'ACTIVE' AND "catalogIdRecherche" IS NULL;
