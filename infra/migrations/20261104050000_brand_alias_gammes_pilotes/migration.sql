-- Alias validés le 2026-11-04 après la vérification des 3 pilotes (catalogue 1242).
-- Rattachés : gammes, modèles et collaborations vendus sous la marque.
-- Toujours exclus : Jordan, Yeezy, adidas Originals, Givenchy. Les résultats croisés (« adidas »
-- dans une recherche Nike, « Nike » dans une recherche Adidas) ne sont pas des alias : ils restent
-- hors cellule.
INSERT INTO "BrandAlias" ("alias", "marque", "valide", "dateValidation") VALUES
    ('Nike SB', 'Nike', true, '2026-11-04T00:00:00Z'),
    ('Air Force', 'Nike', true, '2026-11-04T00:00:00Z'),
    ('adidas Stan Smith', 'Adidas', true, '2026-11-04T00:00:00Z'),
    ('adidas x Oamc', 'Adidas', true, '2026-11-04T00:00:00Z');
