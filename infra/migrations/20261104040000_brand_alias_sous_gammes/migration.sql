-- Alias validés le 2026-11-04 après lecture du premier dataset réel (catalogue 1242, « Nike »).
-- Rattachés : gammes et collaborations vendues sous la marque.
-- NON rattachés, volontairement : « Jordan » (sous-marque, dynamique de prix propre), « Yeezy »
-- (sous-marque), « Adidas Originals » (déjà acté, section 7). Test de non-régression associé.
INSERT INTO "BrandAlias" ("alias", "marque", "valide", "dateValidation") VALUES
    ('Nike Air', 'Nike', true, '2026-11-04T00:00:00Z'),
    ('Nike x Nocta', 'Nike', true, '2026-11-04T00:00:00Z'),
    ('Nike x Off-White', 'Nike', true, '2026-11-04T00:00:00Z'),
    ('Adidas Equipment', 'Adidas', true, '2026-11-04T00:00:00Z'),
    ('Adidas Terrex', 'Adidas', true, '2026-11-04T00:00:00Z');
