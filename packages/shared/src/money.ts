/**
 * Tous les montants du domaine sont exprimés en centimes entiers (Cents).
 * Aucun flottant ne doit circuler entre les couches : les calculs intermédiaires
 * peuvent produire des décimales, mais chaque montant exposé est arrondi via `roundCents`.
 */
export type Cents = number;

/**
 * Arrondi « au plus proche, demi s'éloignant de zéro » (arrondi commercial),
 * symétrique pour les montants négatifs : roundCents(-2.5) === -3.
 */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Montant non fini : ${value}`);
  }
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  // Évite le -0 qui s'afficherait « -0,00 € ».
  return rounded === 0 ? 0 : rounded;
}

/** Applique un taux (ex. 0.123) à un montant en centimes, résultat arrondi. */
export function applyRate(amount: Cents, rate: number): Cents {
  return roundCents(amount * rate);
}

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatage d'affichage uniquement (ex. 1234 → « 12,34 € »). */
export function formatEuros(amount: Cents): string {
  return euroFormatter.format(amount / 100);
}
