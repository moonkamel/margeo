# Phase 2b — Crawl de seed : proposition à valider

> Statut : **proposition, rien n'est lancé.** Aucun appel Apify avant ton go explicite.

## 1. Acteur Apify

Le réseau de la session de dev bloque `apify.com` : je n'ai pas pu lire la fiche d'un acteur
ni son schéma d'entrée. Ce qui suit vient de résultats de recherche, **à confirmer sur l'Apify Store**.

| Acteur candidat                                      | Tarif indiqué (non vérifié)               | Remarque                                  |
| ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `scrapesage/vinted-scraper`                          | à lire sur la fiche                       | annonces, prix, vendeurs, avis            |
| `khadinakbar/vinted-scraper`                         | à lire sur la fiche                       | annonces et détail d'annonce              |
| Autres (`api-empire`, `scraper-engine`, `scrapier`…) | ~3 à 5 $ / 1 000 résultats                | entrée type `startUrls` + `maxItems`      |
| Un acteur facturé à l'événement                      | 0,005 $ / annonce + 0,00005 $ / démarrage | `maxItems` sert de plafond de facturation |

**Critères de choix** : accepte une liste d'URL d'annonces (re-vérification en lot), expose un
signal « sold » explicite, prix à l'unité plutôt qu'au temps de calcul, `maxItems` qui plafonne
la facture. **Action demandée** : autoriser `apify.com` dans le réseau de la session, ou me
donner l'ID de l'acteur retenu. J'adapterai `DEFAULT_INPUT_BUILDERS` à son schéma réel.

## 2. Périmètre : 3 catégories × 5 marques = 15 cellules

| Catégorie | Marques proposées (les 2 premières sont les tiennes, le reste est à valider) |
| --------- | ---------------------------------------------------------------------------- |
| Sneakers  | Nike, Adidas, New Balance, Asics, Veja                                       |
| Mode      | Sézane, AMI Paris, Sandro, Maje, The Kooples                                 |
| Tech      | Apple, Sony, Samsung, Nintendo, Bose                                         |

Pour la tech, la taille n'a pas de sens : les stats se feront au niveau (catégorie, marque).

## 3. Volume et budget

- **Suivi** : ~300 annonces actives, soit ~20 par cellule, re-vérifiées **1 fois par jour**
  pendant **4 semaines**, soit ~8 400 observations.
- **Découverte** : 1 recherche par cellule et par jour (15 recherches), plafonnée par `maxItems`,
  pour remplacer les annonces vendues ou disparues. Hypothèse : ~10 résultats par cellule et par
  jour, soit ~4 200 résultats sur le mois.
- **Total** : ~12 600 résultats facturés.
  - à 3 $ / 1 000 : ~38 $ ;
  - à 5 $ / 1 000 : ~63 $.
- **Écart avec ton enveloppe (20 à 40 €)** : le suivi seul (8 400 résultats) tient dedans,
  pas suivi + découverte. Options :
  - (a) découverte limitée à 5 résultats par cellule et par jour, soit ~10 500 résultats ;
  - (b) découverte tous les 2 jours seulement ;
  - (c) choisir un acteur à ≤ 3 $ / 1 000.
  - Je recommande (a) + (c).
- **Garde-fous** :
  - plafond `maxItems` sur chaque run ;
  - compteur de résultats facturés en base ;
  - arrêt automatique et alerte si on dépasse 80 % du budget mensuel.
- **Risque statistique** : 20 annonces suivies par cellule ne garantissent pas 5 ventes
  « sold » sous 30 jours. Certaines cellules resteront `insufficient_data` à la fin du mois.
  Je publierai un bilan par cellule chaque semaine.

## 4. Fréquence

- Re-vérification du parc suivi : **1×/jour**, **en lot**. On regroupe les URL dans le moins de
  runs possible, plutôt que 300 runs d'une annonce (coût de démarrage, latence).
- Découverte : 1×/jour, juste après la re-vérification.
- Pas de temps réel.

## 5. Stockage

- `ListingObservation` : **append-only**, une ligne par annonce vue active ou vendue à chaque passage.
- `SoldObservation` : contrainte unique `(externalId, plateforme)`.
  - `source = sold_status` sur un signal explicite ;
  - `source = disappeared` après 2 échecs « introuvable » espacés d'au moins 12 h (`isDisappeared`).
  - `listedAt` = première observation, pour la vitesse de vente.
- **Point à trancher (changement de schéma)** : une observation « introuvable » ne peut pas
  remplir les champs obligatoires de `ListingObservation` (titre, prix…). Je propose une table
  `TrackedListing`, une ligne par annonce suivie, avec :
  - l'identité : `externalId`, `url` ;
  - la cellule : catégorie, marque, taille ;
  - le suivi : `firstSeenAt`, `lastSeenActiveAt`, `lastCheckedAt`, `consecutiveNotFound`, `etat` (`TRACKING | SOLD | DISAPPEARED`).

  C'est elle qui pilote la re-vérification quotidienne. **À valider avant implémentation.**

## 6. Ce qui sera livré en 2b (après go)

1. Le mapping d'entrée et de sortie calé sur l'acteur choisi, avec des fixtures réelles anonymisées.
2. Le job de crawl : découverte, re-vérification, détection de vente, écriture en base, compteur de budget.
3. Un premier run limité (1 cellule, `maxItems` 20) avant le lancement des 15 cellules.
