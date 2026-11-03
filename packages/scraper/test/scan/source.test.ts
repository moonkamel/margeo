import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lireModelesCibles } from '@margeo/shared';
import type { ActorRunner, LimitesRun } from '../../src/drivers/apify-async.js';
import { ApifyScanSource } from '../../src/scan/index.js';
import { buildModelSearchUrl } from '../../src/url.js';

const MODELES = lireModelesCibles(
  JSON.parse(
    readFileSync(new URL('../../../shared/data/target-models.json', import.meta.url), 'utf8'),
  ),
);
const DETROIT = MODELES[0] as (typeof MODELES)[number];

function runner() {
  const appels: { input: unknown; limites: LimitesRun }[] = [];
  const r: ActorRunner = {
    run: async (input, limites) => {
      appels.push({ input, limites });
      return { runId: 'r', statut: 'SUCCEEDED', coupe: false, items: [], usageTotalUsd: 0.05 };
    },
  };
  return { r, appels };
}

describe('ApifyScanSource', () => {
  it('recherche : texte du modèle, catalogue, plus récentes d’abord, SANS détails', async () => {
    const { r, appels } = runner();
    const res = await new ApifyScanSource(r).rechercher(DETROIT, 100, { maxTotalChargeUsd: 0.4 });
    expect(appels[0]).toEqual({
      input: {
        mode: 'search',
        queries: ['Carhartt Detroit'],
        categoryId: '2052',
        maxItems: 100,
        fetchDetails: false,
        sortBy: 'newest_first',
      },
      limites: { maxItems: 100, maxTotalChargeUsd: 0.4 },
    });
    expect(res.coutReelMilli).toBeGreaterThan(4500); // 0,05 $ convertis (taux EUR_PAR_USD)
  });

  it('détails : un seul run en mode URL, plafond = nombre d’annonces', async () => {
    const { r, appels } = runner();
    await new ApifyScanSource(r).details(
      ['https://www.vinted.fr/items/101-a?ref=x', 'https://www.vinted.fr/items/102-b'],
      { maxTotalChargeUsd: 0.2 },
    );
    expect(appels).toHaveLength(1);
    expect(appels[0]?.input).toMatchObject({ mode: 'url', maxItems: 2, fetchDetails: true });
    expect(appels[0]?.limites).toEqual({ maxItems: 2, maxTotalChargeUsd: 0.2 });
  });

  it('détails sans annonce : aucun run', async () => {
    const { r, appels } = runner();
    await new ApifyScanSource(r).details([], { maxTotalChargeUsd: 0.2 });
    expect(appels).toHaveLength(0);
  });
});

describe('buildModelSearchUrl', () => {
  it('catalogue exact, texte et tri', () => {
    expect(buildModelSearchUrl(2052, ' Carhartt Detroit ')).toBe(
      'https://www.vinted.fr/catalog?catalog%5B%5D=2052&search_text=Carhartt+Detroit&order=newest_first',
    );
  });
  it('refuse un catalogue ou un texte invalide', () => {
    expect(() => buildModelSearchUrl(0, 'x')).toThrow();
    expect(() => buildModelSearchUrl(2052, '  ')).toThrow();
  });
});
