-- Row Level Security sur toutes les tables du schéma public (alerte Supabase du 2026-11-04).
-- Sans RLS, la clé publique « anon » de Supabase donne lecture ET écriture sur toutes les lignes
-- via l'API Supabase. Margeo n'utilise pas cette API : Prisma se connecte en propriétaire des
-- tables, non soumis à RLS. Aucune policy volontairement : l'API publique est fermée.
-- Idempotent. Une migration ne s'exécute qu'une fois : les tables FUTURES sont couvertes par le
-- test de migration « RLS sur toutes les tables » (packages/db/test/migrations.test.ts), qui
-- échoue si une nouvelle table n'active pas RLS dans sa propre migration.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;
