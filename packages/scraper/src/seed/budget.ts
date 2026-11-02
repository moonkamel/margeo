/**
 * Compteur de budget du crawl de seed — logique PURE.
 *
 * Unité : millième de centime d'euro (« milli »), entier. 1 € = 100 000 milli.
 * Un tarif de X centimes pour 1 000 résultats vaut exactement X milli par résultat,
 * ce qui évite tout flottant dans le suivi de la dépense.
 *
 * Règles :
 *  1. Avant chaque appel facturable, on RÉSERVE son coût maximal (nombre max de résultats
 *     × coût unitaire). La réservation est refusée si elle ferait dépasser le plafond total :
 *     la dépense peut atteindre exactement le plafond (48,00 €), jamais le dépasser (48,01 €).
 *  2. Deux enveloppes : suivi (re-vérification) et découverte. La découverte est coupée dès
 *     que SON enveloppe est pleine.
 *  3. Si le suivi épuise son enveloppe, on coupe la découverte EN PREMIER et le suivi peut
 *     utiliser le reliquat du plafond total.
 *  4. Plus aucune réservation possible → arrêt dur (`stopped`), motif `budget_cap`.
 */

export const MILLI_PAR_CENTIME = 1000;
export type Envelope = 'suivi' | 'decouverte';

export interface BudgetConfig {
  /** Plafond total d'arrêt dur, en centimes (ex. 4800 = 48 €). */
  hardStopCents: number;
  suiviCents: number;
  decouverteCents: number;
  /** Coût d'un résultat facturé, en milli (= centimes pour 1 000 résultats). */
  coutParResultatMilli: number;
}

export interface BudgetSpent {
  suivi: number;
  decouverte: number;
}

export type ReserveRefusal = 'decouverte_coupee' | 'budget_cap';

export interface Reservation {
  envelope: Envelope;
  maxMilli: number;
}

export class BudgetLedger {
  private readonly capMilli: number;
  private readonly envelopeCap: Readonly<Record<Envelope, number>>;
  private readonly spent: Record<Envelope, number>;
  private decouverteCoupeeMotif: string | null = null;
  private stopMotif: ReserveRefusal | null = null;

  constructor(
    private readonly config: BudgetConfig,
    alreadySpent: BudgetSpent = { suivi: 0, decouverte: 0 },
  ) {
    for (const [k, v] of Object.entries(config)) {
      if (!Number.isInteger(v) || v < 0) throw new RangeError(`Budget invalide : ${k} = ${v}`);
    }
    if (config.suiviCents + config.decouverteCents > config.hardStopCents) {
      throw new RangeError('La somme des enveloppes dépasse le plafond total');
    }
    this.capMilli = config.hardStopCents * MILLI_PAR_CENTIME;
    this.envelopeCap = {
      suivi: config.suiviCents * MILLI_PAR_CENTIME,
      decouverte: config.decouverteCents * MILLI_PAR_CENTIME,
    };
    this.spent = { ...alreadySpent };
    if (this.totalMilli >= this.capMilli) this.stopMotif = 'budget_cap';
    if (this.spent.decouverte >= this.envelopeCap.decouverte) {
      this.decouverteCoupeeMotif = 'enveloppe découverte épuisée';
    }
  }

  get totalMilli(): number {
    return this.spent.suivi + this.spent.decouverte;
  }

  get remainingMilli(): number {
    return Math.max(0, this.capMilli - this.totalMilli);
  }

  get stopped(): boolean {
    return this.stopMotif !== null;
  }

  get decouverteCoupee(): string | null {
    return this.decouverteCoupeeMotif;
  }

  snapshot(): BudgetSpent & { totalMilli: number; capMilli: number } {
    return { ...this.spent, totalMilli: this.totalMilli, capMilli: this.capMilli };
  }

  /**
   * Nombre maximal de résultats qu'un appel peut encore facturer dans cette enveloppe
   * (permet de réduire un lot plutôt que de s'arrêter alors qu'un lot plus petit tiendrait).
   */
  affordableResultats(envelope: Envelope): number {
    if (this.stopMotif) return 0;
    if (envelope === 'decouverte' && this.decouverteCoupeeMotif) return 0;
    const unit = this.config.coutParResultatMilli;
    const room =
      envelope === 'decouverte'
        ? Math.min(this.remainingMilli, this.envelopeCap.decouverte - this.spent.decouverte)
        : this.remainingMilli;
    if (unit === 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.floor(room / unit));
  }

  /** Coût maximal d'un appel pouvant facturer jusqu'à `maxResultats` résultats. */
  costFor(maxResultats: number): number {
    return maxResultats * this.config.coutParResultatMilli;
  }

  reserve(envelope: Envelope, maxResultats: number): Reservation | ReserveRefusal {
    if (this.stopMotif) return this.stopMotif;
    const maxMilli = this.costFor(maxResultats);

    if (this.totalMilli + maxMilli > this.capMilli) {
      // Le suivi a priorité : si c'est la découverte qui ne passe plus, on la coupe d'abord.
      if (envelope === 'decouverte') {
        this.decouverteCoupeeMotif ??= 'plafond total atteint';
        return 'decouverte_coupee';
      }
      // Plus aucun appel de suivi ne tient sous le plafond : arrêt dur.
      this.stopMotif = 'budget_cap';
      return 'budget_cap';
    }

    if (envelope === 'decouverte') {
      if (this.decouverteCoupeeMotif) return 'decouverte_coupee';
      if (this.spent.decouverte + maxMilli > this.envelopeCap.decouverte) {
        this.decouverteCoupeeMotif = 'enveloppe découverte épuisée';
        return 'decouverte_coupee';
      }
      return { envelope, maxMilli };
    }

    if (this.spent.suivi + maxMilli > this.envelopeCap.suivi && !this.decouverteCoupeeMotif) {
      // Dépassement de l'enveloppe de suivi : on coupe la découverte et le suivi emprunte
      // sur le reliquat du plafond total (déjà vérifié ci-dessus).
      this.decouverteCoupeeMotif = 'enveloppe suivi dépassée, reliquat réservé au suivi';
    }
    return { envelope, maxMilli };
  }

  /**
   * Enregistre la dépense réelle d'un appel. Si la source a facturé plus que réservé
   * (anomalie : `maxItems` non respecté), la dépense réelle est enregistrée telle quelle
   * et l'arrêt dur est déclenché si le plafond est atteint.
   */
  commit(
    reservation: Reservation,
    resultatsFactures: number,
  ): { milli: number; anomalie: boolean } {
    const milli = this.costFor(resultatsFactures);
    this.spent[reservation.envelope] += milli;
    if (this.totalMilli >= this.capMilli) this.stopMotif = 'budget_cap';
    return { milli, anomalie: milli > reservation.maxMilli };
  }
}

export function formatMilli(milli: number): string {
  return `${(milli / (100 * MILLI_PAR_CENTIME)).toFixed(2).replace('.', ',')} €`;
}

/** Part du plafond réellement dépensable : l'arrêt dur tombe à 80 % (doc 2b, 8.9). */
export const ARRET_DUR_RATIO = 0.8;
/** Part de l'arrêt dur réservée au suivi ; le reste va à la découverte, coupée en premier. */
export const PART_SUIVI = 0.85;

/**
 * Budget mensuel déduit du PLAFOND (`--budget-max`) :
 * arrêt dur = 80 % du plafond, puis 85 % suivi / 15 % découverte appliqués à l'arrêt dur.
 * Exemple : plafond 10 000 c → arrêt dur 8 000 c, suivi 6 800 c, découverte 1 200 c.
 * Les 20 % restants sont une marge contre les écarts de facturation Apify : jamais dépensés.
 */
export function budgetDepuisPlafond(
  plafondCents: number,
  coutParResultatMilli: number,
): BudgetConfig {
  if (!Number.isInteger(plafondCents) || plafondCents <= 0) {
    throw new RangeError(`Plafond invalide : ${plafondCents}`);
  }
  const hardStopCents = Math.floor(plafondCents * ARRET_DUR_RATIO);
  const suiviCents = Math.floor(hardStopCents * PART_SUIVI);
  return {
    hardStopCents,
    suiviCents,
    decouverteCents: hardStopCents - suiviCents,
    coutParResultatMilli,
  };
}
