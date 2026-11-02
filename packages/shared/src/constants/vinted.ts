import type { ClasseColis, ModeVente } from '../schemas.js';

/**
 * Barème des frais Vinted (France).
 *
 * DERNIÈRE VÉRIFICATION : 2026-11-02.
 *
 * Modèle économique retenu : le revendeur est ACHETEUR puis VENDEUR.
 *  - À l'achat, il paie la « protection acheteurs » (part fixe + pourcentage du prix)
 *    et les frais de port de l'article jusqu'à lui.
 *  - À la revente, le port est payé par son propre acheteur ; il ne supporte que
 *    l'éventuelle commission vendeur, qui dépend du mode de vente (particulier / pro).
 *
 * Sources consultées le 2026-11-02 :
 *  - Protection acheteurs : 0,70 € + 5 % du prix (centre d'aide Vinted, y compris Vinted Pro).
 *  - Commission vendeur PARTICULIER : 0 € (frais supportés par l'acheteur).
 *  - Commission vendeur PRO : forfait de 5 € par vente (grille Vinted de septembre 2025),
 *    retenu par décision produit malgré des sources contradictoires (0 % / 5 %).
 *  - Les deux modes restent `verifie: false` : grille Vinted Pro à revérifier avant
 *    l'ouverture commerciale. Tant que PRO n'est pas vérifié, il n'est pas exposé dans l'UI
 *    (cf. `isModeVenteDisponible`), même si le calcul est implémenté.
 *  - Port : estimations par format de colis, À CONFIRMER sur la grille transporteurs
 *    Vinted → `portVerifie: false`.
 */

export interface BaremeMode {
  /** Part fixe de la protection acheteurs payée à l'achat, en centimes. */
  protectionAcheteurFixeCents: number;
  /** Part proportionnelle de la protection acheteurs, appliquée au prix d'achat. */
  protectionAcheteurTaux: number;
  /** Commission forfaitaire prélevée au vendeur par vente, en centimes (pas de pourcentage). */
  commissionVendeurFixeCents: number;
  /** `false` tant qu'une valeur du mode n'a pas été confirmée par une source officielle. */
  verifie: boolean;
}

export interface BaremeVinted {
  verifieLe: string;
  modes: Readonly<Record<ModeVente, BaremeMode>>;
  /** Frais de port payés à l'achat, par format de colis, en centimes. */
  portAchatCents: Readonly<Record<ClasseColis, number>>;
  portVerifie: boolean;
}

export const BAREME_VINTED: BaremeVinted = {
  verifieLe: '2026-11-02',
  modes: {
    PARTICULIER: {
      protectionAcheteurFixeCents: 70,
      protectionAcheteurTaux: 0.05,
      commissionVendeurFixeCents: 0,
      verifie: false,
    },
    PRO: {
      protectionAcheteurFixeCents: 70,
      protectionAcheteurTaux: 0.05,
      commissionVendeurFixeCents: 500,
      verifie: false,
    },
  },
  portAchatCents: {
    PETIT: 350,
    MOYEN: 500,
    GRAND: 750,
  },
  portVerifie: false,
};

/**
 * Format de colis par catégorie (clé normalisée en minuscules).
 * Toute catégorie inconnue retombe sur PETIT (le cas majoritaire : vêtements légers).
 */
const CLASSE_COLIS_PAR_CATEGORIE: Readonly<Record<string, ClasseColis>> = {
  chaussures: 'MOYEN',
  sacs: 'MOYEN',
  manteaux: 'MOYEN',
  'manteaux et vestes': 'MOYEN',
  jeans: 'PETIT',
  électronique: 'MOYEN',
  'jeux vidéo': 'PETIT',
  livres: 'PETIT',
  maison: 'GRAND',
  jouets: 'MOYEN',
};

export function classeColisPourCategorie(categorie: string): ClasseColis {
  return CLASSE_COLIS_PAR_CATEGORIE[categorie.trim().toLowerCase()] ?? 'PETIT';
}

/**
 * Un mode de vente n'est proposé dans l'UI que si son barème est vérifié.
 * Exception : PARTICULIER reste toujours disponible (mode par défaut, sans commission vendeur),
 * sinon aucun utilisateur ne pourrait utiliser le produit.
 */
export function isModeVenteDisponible(
  mode: ModeVente,
  bareme: BaremeVinted = BAREME_VINTED,
): boolean {
  return mode === 'PARTICULIER' || bareme.modes[mode].verifie;
}
