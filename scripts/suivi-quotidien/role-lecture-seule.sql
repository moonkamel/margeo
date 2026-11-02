-- Rôle LECTURE SEULE pour le script de suivi quotidien (décision du 2026-11-04).
-- À exécuter UNE fois, par un administrateur (Supabase → SQL Editor), en remplaçant le mot de passe.
-- Aucun droit d'écriture : SELECT uniquement, et uniquement sur les deux tables lues par le script.
--
-- RLS est actif sur toutes les tables, sans policy (API Supabase « anon » fermée). Un rôle qui
-- n'est pas propriétaire des tables n'y verrait AUCUNE ligne : les deux policies ci-dessous
-- n'autorisent la lecture qu'à ce rôle précis ; l'API publique reste fermée.
CREATE ROLE margeo_lecture WITH LOGIN PASSWORD 'REMPLACER-PAR-UN-MOT-DE-PASSE-FORT'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
-- Toute transaction de ce rôle est en lecture seule, même si le client tente d'écrire.
ALTER ROLE margeo_lecture SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public TO margeo_lecture;
GRANT SELECT ON "TrackedListing", "SeedRun" TO margeo_lecture;

CREATE POLICY "suivi_lecture" ON "TrackedListing" FOR SELECT TO margeo_lecture USING (true);
CREATE POLICY "suivi_lecture" ON "SeedRun" FOR SELECT TO margeo_lecture USING (true);
