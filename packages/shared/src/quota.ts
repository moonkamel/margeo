import {
  FREE_MONTHLY_QUOTA,
  FREE_REANALYSIS_WINDOW_MS,
  QUOTA_TIMEZONE,
} from './constants/defaults.js';
import type { AnalysisResult, Plan } from './schemas.js';

export interface PreviousAnalysis {
  url: string;
  createdAt: Date;
  consommeQuota: boolean;
  served: boolean;
}

/**
 * Règle de consommation du quota freemium pour une NOUVELLE analyse :
 *  - une analyse `insufficient_data` n'est pas servie → ne consomme jamais ;
 *  - une réanalyse de la même URL déjà servie dans les 24 h précédentes est gratuite.
 */
export function analysisConsumesQuota(
  result: Pick<AnalysisResult, 'status'>,
  url: string,
  previous: readonly PreviousAnalysis[],
  now: Date,
): boolean {
  if (result.status !== 'ok') return false;
  const cible = normalizeListingUrl(url);
  const limite = now.getTime() - FREE_REANALYSIS_WINDOW_MS;
  const dejaServie = previous.some(
    (p) =>
      p.served &&
      normalizeListingUrl(p.url) === cible &&
      p.createdAt.getTime() > limite &&
      p.createdAt.getTime() <= now.getTime(),
  );
  return !dejaServie;
}

/** Normalise une URL d'annonce (sans query string, fragment ni slash final) pour comparaison. */
export function normalizeListingUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.trim();
  }
}

/** Quota restant ; null = illimité (abonnés). */
export function remainingQuota(plan: Plan, usedThisMonth: number): number | null {
  if (plan !== 'FREE') return null;
  return Math.max(0, FREE_MONTHLY_QUOTA - usedThisMonth);
}

/** Décalage (ms) entre l'heure locale d'un fuseau et UTC à un instant donné. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant UTC correspondant à minuit le 1er du mois (année, mois 1–12) dans le fuseau. */
function startOfMonthInZone(year: number, month: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, 1);
  // Deux passes pour absorber un éventuel changement d'heure autour de l'instant estimé.
  let ts = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  ts = guess - timeZoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/**
 * Bornes [start, end[ du mois civil courant à l'heure de Paris, en instants UTC,
 * pour le COUNT des analyses consommant du quota.
 */
export function quotaPeriod(
  now: Date,
  timeZone: string = QUOTA_TIMEZONE,
): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const start = startOfMonthInZone(year, month, timeZone);
  const end =
    month === 12
      ? startOfMonthInZone(year + 1, 1, timeZone)
      : startOfMonthInZone(year, month + 1, timeZone);
  return { start, end };
}
