import { z } from 'zod';
import { SCRAPER_DRIVERS, type ScraperDriver } from './driver.js';
import { ApifyDriver } from './drivers/apify.js';
import { CustomDriver } from './drivers/custom.js';
import { ScraperConfigError } from './errors.js';

const envSchema = z.object({
  SCRAPER_DRIVER: z.enum(SCRAPER_DRIVERS).default('apify'),
  APIFY_ACTOR_ID: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
});

/** Instancie le driver sélectionné par `SCRAPER_DRIVER` (défaut : apify). */
export function createScraperDriver(
  env: Record<string, string | undefined> = process.env,
): ScraperDriver {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ScraperConfigError(
      `SCRAPER_DRIVER invalide (valeurs acceptées : ${SCRAPER_DRIVERS.join(', ')})`,
    );
  }
  const { SCRAPER_DRIVER, APIFY_ACTOR_ID, APIFY_TOKEN } = parsed.data;
  if (SCRAPER_DRIVER === 'custom') return new CustomDriver();
  if (!APIFY_ACTOR_ID || !APIFY_TOKEN) {
    throw new ScraperConfigError('APIFY_ACTOR_ID et APIFY_TOKEN sont requis pour le driver apify');
  }
  return new ApifyDriver({ actorId: APIFY_ACTOR_ID, token: APIFY_TOKEN });
}
