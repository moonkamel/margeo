/** Fonctionnalité prévue mais pas encore implémentée (stubs de drivers). */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor(feature: string) {
    super(`Non implémenté : ${feature}`);
  }
}

/** Configuration de scraping invalide ou incomplète (variables d'environnement). */
export class ScraperConfigError extends Error {
  override readonly name = 'ScraperConfigError';
}
