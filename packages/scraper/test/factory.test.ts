import { describe, expect, it } from 'vitest';
import {
  ApifyDriver,
  CustomDriver,
  NotImplementedError,
  ScraperConfigError,
  createScraperDriver,
} from '../src/index.js';

const apifyEnv = { APIFY_ACTOR_ID: 'acteur-test', APIFY_TOKEN: 'jeton-test' };

describe('createScraperDriver', () => {
  it('apify par défaut', () => {
    const d = createScraperDriver(apifyEnv);
    expect(d).toBeInstanceOf(ApifyDriver);
    expect(d.name).toBe('apify');
  });

  it('lit l’identifiant d’acteur depuis l’environnement', () => {
    expect((createScraperDriver(apifyEnv) as ApifyDriver).actorId).toBe('acteur-test');
  });

  it('apify sans credentials → erreur de configuration explicite', () => {
    expect(() => createScraperDriver({})).toThrow(ScraperConfigError);
    expect(() => createScraperDriver({ APIFY_TOKEN: 'x' })).toThrow(/APIFY_ACTOR_ID/);
  });

  it('custom sélectionnable sans credentials Apify', () => {
    expect(createScraperDriver({ SCRAPER_DRIVER: 'custom' })).toBeInstanceOf(CustomDriver);
  });

  it('driver inconnu → erreur de configuration', () => {
    expect(() => createScraperDriver({ SCRAPER_DRIVER: 'selenium' })).toThrow(ScraperConfigError);
  });
});

describe('stubs Phase 1', () => {
  it.each([
    ['apify', () => new ApifyDriver({ actorId: 'a', token: 't' })],
    ['custom', () => new CustomDriver()],
  ])('%s lève NotImplementedError', async (_name, make) => {
    const d = make();
    await expect(d.fetchListing('https://www.vinted.fr/items/1')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(d.searchSoldPrices('Jeans', null, null)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
