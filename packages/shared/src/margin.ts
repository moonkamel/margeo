import { COTISATIONS_MICRO_BIC_VENTE } from './constants/defaults.js';
import { BAREME_VINTED, type BaremeVinted } from './constants/vinted.js';
import { applyRate, formatEuros, roundCents, type Cents } from './money.js';
import { computeScore, computeVitesse } from './score.js';
import type { ClasseColis, MarginLine, MarginResult, Preferences, Statut } from './schemas.js';

export interface MarginInput {
  prixAchatCents: Cents;
  prixReventeEstimeCents: Cents;
  classeColis: ClasseColis;
  preferences: Preferences;
  /** Médiane du délai de vente (jours), null si inconnue → confiance faible. */
  medianJoursVente: number | null;
  /** Injectable pour les tests ; par défaut, le barème Vinted courant. */
  bareme?: BaremeVinted;
}

export interface FraisVinted {
  protectionAcheteurCents: Cents;
  commissionVendeurCents: Cents;
  totalCents: Cents;
}

/**
 * Frais Vinted supportés par le revendeur sur un cycle achat → revente :
 * protection acheteurs payée à l'achat + commission vendeur prélevée à la revente.
 */
export function computeFraisVinted(
  prixAchatCents: Cents,
  prixReventeCents: Cents,
  preferences: Pick<Preferences, 'modeVente'>,
  bareme: BaremeVinted = BAREME_VINTED,
): FraisVinted {
  const mode = bareme.modes[preferences.modeVente];
  const protectionAcheteurCents =
    mode.protectionAcheteurFixeCents + applyRate(prixAchatCents, mode.protectionAcheteurTaux);
  // Commission vendeur forfaitaire par vente (pas de pourcentage) : 0 € en particulier.
  const commissionVendeurCents = prixReventeCents > 0 ? mode.commissionVendeurFixeCents : 0;
  return {
    protectionAcheteurCents,
    commissionVendeurCents,
    totalCents: protectionAcheteurCents + commissionVendeurCents,
  };
}

/** valorisationTemps = (temps / 60) × taux horaire. */
export function computeValorisationTemps(
  tempsEstimeMinutes: number,
  tauxHoraireCents: Cents,
): Cents {
  return roundCents((tempsEstimeMinutes / 60) * tauxHoraireCents);
}

/**
 * Moteur de marge — fonction PURE (aucune I/O), exécutable côté serveur comme côté
 * extension pour le recalcul instantané.
 *
 * margeNette = prixReventeEstime − prixAchat − fraisVinted − fraisPort
 *            − coutEmballage − cotisationsSociales − valorisationTemps
 *
 * Statut — calculé UNIQUEMENT sur margeNette :
 *  - VERT   si margeNette ≥ seuil utilisateur
 *  - ORANGE si 0 < margeNette < seuil
 *  - ROUGE  si margeNette ≤ 0
 *
 * Le temps de travail est déjà pris en compte par la soustraction de valorisationTemps :
 * il reste une ligne visible du détail (traçabilité) mais n'est jamais un critère séparé.
 */
export function computeMargin(input: MarginInput): MarginResult {
  const { prixAchatCents, prixReventeEstimeCents, classeColis, preferences } = input;
  const bareme = input.bareme ?? BAREME_VINTED;
  const { tauxHoraireCents, seuilMargeCents, tempsEstimeMinutes, coutEmballageCents } = preferences;

  const frais = computeFraisVinted(prixAchatCents, prixReventeEstimeCents, preferences, bareme);
  const fraisPortCents = bareme.portAchatCents[classeColis];
  const cotisationsCents = applyRate(prixReventeEstimeCents, COTISATIONS_MICRO_BIC_VENTE);
  const valorisationTempsCents = computeValorisationTemps(tempsEstimeMinutes, tauxHoraireCents);

  const margeNetteCents =
    prixReventeEstimeCents -
    prixAchatCents -
    frais.totalCents -
    fraisPortCents -
    coutEmballageCents -
    cotisationsCents -
    valorisationTempsCents;

  const statut = computeStatut(margeNetteCents, seuilMargeCents);
  const { vitesse, confidence } = computeVitesse(input.medianJoursVente);
  const score = computeScore(margeNetteCents, prixReventeEstimeCents, vitesse);

  const mode = bareme.modes[preferences.modeVente];
  // Un coût s'affiche en négatif ; on évite le « -0 » pour un coût nul.
  const cout = (montant: Cents): Cents => (montant === 0 ? 0 : -montant);
  const lignes: MarginLine[] = [
    {
      cle: 'prix_revente',
      libelle: 'Prix de revente estimé',
      montantCents: prixReventeEstimeCents,
    },
    { cle: 'prix_achat', libelle: "Prix d'achat", montantCents: cout(prixAchatCents) },
    {
      cle: 'frais_vinted',
      libelle: 'Frais Vinted',
      montantCents: cout(frais.totalCents),
      detail:
        `Protection acheteurs à l'achat : ${formatEuros(frais.protectionAcheteurCents)}` +
        ` · Commission vendeur (${preferences.modeVente === 'PRO' ? 'pro' : 'particulier'}) : ` +
        formatEuros(frais.commissionVendeurCents) +
        (mode.verifie ? '' : ' (barème à confirmer)'),
    },
    {
      cle: 'frais_port',
      libelle: 'Frais de port (achat)',
      montantCents: cout(fraisPortCents),
      detail: `Colis ${classeColis.toLowerCase()}${bareme.portVerifie ? '' : ' (tarif estimé)'}`,
    },
    {
      cle: 'emballage',
      libelle: 'Emballage',
      montantCents: cout(coutEmballageCents),
      editable: ['coutEmballageCents'],
    },
    {
      cle: 'cotisations',
      libelle: 'Cotisations sociales',
      montantCents: cout(cotisationsCents),
      detail: '12,3 % du prix de revente (micro-BIC, vente de marchandises)',
    },
    {
      cle: 'temps',
      libelle: 'Valorisation du temps',
      montantCents: cout(valorisationTempsCents),
      detail: `${tempsEstimeMinutes} min à ${formatEuros(tauxHoraireCents)}/h`,
      editable: ['tempsEstimeMinutes', 'tauxHoraireCents'],
    },
  ];

  return {
    margeNetteCents,
    statut,
    score,
    confidence,
    vitesse,
    lignes,
    preferences,
  };
}

export function computeStatut(margeNetteCents: Cents, seuilMargeCents: Cents): Statut {
  if (margeNetteCents <= 0) return 'ROUGE';
  if (margeNetteCents >= seuilMargeCents) return 'VERT';
  return 'ORANGE';
}
