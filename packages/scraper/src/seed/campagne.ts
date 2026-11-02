/**
 * Campagnes mensuelles (doc 2b, section 3) : le compteur de dépense repart à zéro chaque mois
 * civil, en heure de Paris. Seed : `seed-YYYY-MM` ; vérification du volume : `verify-YYYY-MM`.
 */

function moisParis(now: Date): { annee: number; mois: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { annee: get('year'), mois: get('month') };
}

export function campagneDuMois(prefixe: 'seed' | 'verify', now: Date): string {
  const { annee, mois } = moisParis(now);
  return `${prefixe}-${annee}-${String(mois).padStart(2, '0')}`;
}

/** Date du prochain run possible après épuisement du budget : « 01/MM » du mois suivant. */
export function premierDuMoisSuivant(now: Date): string {
  const { mois } = moisParis(now);
  return `01/${String((mois % 12) + 1).padStart(2, '0')}`;
}
