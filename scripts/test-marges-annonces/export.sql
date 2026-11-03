-- Export LECTURE SEULE pour marges.ts (SELECT uniquement, aucune écriture).
-- À exécuter avec le rôle margeo_lecture (scripts/suivi-quotidien/role-lecture-seule.sql) ou
-- dans l'éditeur SQL Supabase ; enregistrer la valeur de la colonne `export` dans un fichier .json.
SELECT json_build_object(
  'extraitLe', now(),
  'annonces', (SELECT coalesce(json_agg(x ORDER BY x.categorie, x.marque, x."prixCents"), '[]'::json) FROM (
    SELECT t."externalId", t.url, t.categorie, t.marque, t.taille, t.etat,
           t."prixCourantCents" AS "prixCents", t."subcategoryLabel", t."premiereVuAt",
           (SELECT o.titre FROM "ListingObservation" o
             WHERE o."trackedListingId" = t.id ORDER BY o."observedAt" DESC LIMIT 1) AS titre
    FROM "TrackedListing" t WHERE t.statut = 'ACTIVE') x),
  'ventes', (SELECT coalesce(json_agg(json_build_object(
      'categorie', s.categorie, 'marque', s.marque, 'taille', s.taille, 'etat', s.etat,
      'prixVenteCents', s."prixVenteCents", 'soldAt', s."soldAt", 'listedAt', s."listedAt",
      'source', s.source)), '[]'::json) FROM "SoldObservation" s)
) AS export;
