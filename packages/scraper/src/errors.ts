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

export type ScraperErrorCode =
  | 'invalid_url'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'auth'
  | 'upstream_error'
  | 'invalid_response'
  | 'normalization_failed';

/**
 * Messages destinés à l'utilisateur final : français clair, jamais de détail technique.
 * Le détail technique reste dans `message` / `cause` pour les logs.
 */
const USER_MESSAGES: Readonly<Record<ScraperErrorCode, string>> = {
  invalid_url: 'Ce lien ne correspond pas à une annonce Vinted.',
  not_found: 'Cette annonce n’existe plus ou a été retirée par son vendeur.',
  rate_limited: 'Le service est très sollicité. Réessayez dans quelques instants.',
  upstream_unavailable:
    'Impossible de récupérer l’annonce pour le moment. Réessayez dans quelques instants.',
  timeout: 'La récupération de l’annonce a pris trop de temps. Réessayez.',
  auth: 'Le service d’analyse est temporairement indisponible.',
  upstream_error: 'Impossible de récupérer l’annonce pour le moment.',
  invalid_response: 'Les informations de l’annonce sont illisibles pour le moment.',
  normalization_failed:
    'Certaines informations essentielles de l’annonce (prix, état) sont illisibles.',
};

const RETRYABLE: ReadonlySet<ScraperErrorCode> = new Set([
  'rate_limited',
  'upstream_unavailable',
  'timeout',
]);

export class ScraperError extends Error {
  override readonly name = 'ScraperError';
  readonly userMessage: string;
  /** L'appelant (UI, worker) peut proposer « Réessayer ». */
  readonly retryable: boolean;

  constructor(
    readonly code: ScraperErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.userMessage = USER_MESSAGES[code];
    this.retryable = RETRYABLE.has(code);
  }
}
