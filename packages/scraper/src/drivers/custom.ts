import type { NormalizedListing, PriceStats } from '@margeo/shared';
import type { ScraperDriver } from '../driver.js';
import { NotImplementedError } from '../errors.js';

/**
 * Driver « custom » (Playwright + proxys) — VOLONTAIREMENT NON IMPLÉMENTÉ.
 *
 * Le MVP tourne exclusivement sur Apify. Ce stub existe pour figer l'interface et
 * documenter pourquoi nous ne construisons pas notre propre collecte à ce stade.
 *
 * Limites légales et éthiques identifiées :
 *  - CGU Vinted : elles encadrent strictement l'extraction automatisée de données de la
 *    plateforme. Un scraping maison engage directement notre responsabilité contractuelle.
 *  - RGPD / CNIL : les annonces contiennent des données personnelles (pseudo, note,
 *    ancienneté du vendeur). La CNIL rappelle que la collecte par moissonnage doit reposer
 *    sur une base légale, être minimisée, et respecter l'opposition exprimée par le site
 *    (CGU, robots.txt, mesures techniques). Nous ne conservons que ce qui sert au calcul.
 *  - DAC7 : Vinted déclare les vendeurs actifs à l'administration fiscale ; nos utilisateurs
 *    revendeurs sont concernés. Cela ne change pas le scraping, mais renforce l'exigence de
 *    données exactes (cotisations, chiffre d'affaires) et de transparence sur les estimations.
 *
 * Pourquoi aucune évasion anti-bot : rotation d'IP résidentielles pour ne jamais être
 * détecté, falsification d'empreinte navigateur ou contournement de captchas reviennent à
 * neutraliser des mesures de protection mises en place par Vinted. C'est contraire à la
 * règle produit « rester sur des drivers légaux » et exposerait l'entreprise à des risques
 * juridiques (contournement de mesures techniques, accès frauduleux à un système).
 *
 * Si ce dossier est rouvert (coût ou fiabilité d'Apify), l'implémentation devra rester
 * défensive : débit limité, backoff, arrêt sur signal de blocage, respect de robots.txt,
 * et validation juridique préalable.
 */
export class CustomDriver implements ScraperDriver {
  readonly name = 'custom' as const;

  async fetchListing(_url: string): Promise<NormalizedListing> {
    throw new NotImplementedError('CustomDriver.fetchListing (hors périmètre MVP)');
  }

  async searchSoldPrices(
    _category: string,
    _brand: string | null,
    _size: string | null,
  ): Promise<PriceStats> {
    throw new NotImplementedError('CustomDriver.searchSoldPrices (hors périmètre MVP)');
  }
}
