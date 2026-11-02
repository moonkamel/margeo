import { ScraperError } from '../errors.js';

/**
 * Runs Apify ASYNCHRONES pour le seed (décision du 2026-11-04) : l'endpoint synchrone est
 * plafonné à 300 s, or `fetchDetails` prend ~1 s par annonce avec des pics à 35 s.
 *
 *  1. POST /v2/acts/{acteur}/runs?timeout&memory&maxItems&maxTotalChargeUsd — plafonds imposés
 *     par la PLATEFORME (respectés même si l'acteur ignore notre input) ;
 *  2. GET  /v2/actor-runs/{id}?waitForFinish=60 jusqu'à un statut terminal ;
 *  3. GET  /v2/datasets/{id}/items — y compris pour un run coupé (ses annonces sont payées).
 *
 * Le token passe uniquement dans l'en-tête Authorization, jamais dans une URL ni un log.
 */

export interface LimitesRun {
  /** Nombre exact d'items attendus : plafond de facturation côté plateforme. */
  maxItems: number;
  /** Plafond de coût du run côté plateforme, en dollars. */
  maxTotalChargeUsd: number;
}

export type StatutRun = 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED';

export interface RunActeur {
  runId: string;
  statut: StatutRun;
  /** Run interrompu avant sa fin normale (timeout, abandon, échec) : résultats partiels. */
  coupe: boolean;
  items: unknown[];
  /** Coût facturé du run, en dollars, tel qu'Apify le rapporte à la fin (peut être en retard). */
  usageTotalUsd: number | null;
}

/** Port : tout ce dont la source du seed a besoin pour lancer un run. */
export interface ActorRunner {
  run(input: unknown, limites: LimitesRun): Promise<RunActeur>;
}

export interface ApifyAsyncConfig {
  actorId: string;
  token: string;
  baseUrl?: string;
  /** Timeout du run côté Apify, en secondes. */
  timeoutSecs: number;
  /** Mémoire du run : le démarrage est facturé par Go (1 024 Mo = 1 démarrage). */
  memoryMbytes?: number;
  /** Long-polling par requête (Apify plafonne à 60 s). */
  waitSecs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const TERMINAUX: ReadonlySet<string> = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
const NB_ESSAIS_LECTURE = 3;

export class ApifyAsyncRunner implements ActorRunner {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly config: ApifyAsyncConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.apify.com').replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = config.now ?? Date.now;
  }

  async run(input: unknown, limites: LimitesRun): Promise<RunActeur> {
    if (!Number.isInteger(limites.maxItems) || limites.maxItems <= 0)
      throw new ScraperError('invalid_response', `maxItems invalide : ${limites.maxItems}`);
    if (!(limites.maxTotalChargeUsd > 0))
      throw new ScraperError('invalid_response', 'maxTotalChargeUsd obligatoire et > 0');

    const actor = encodeURIComponent(this.config.actorId.replace('/', '~'));
    const qs = new URLSearchParams({
      timeout: String(this.config.timeoutSecs),
      memory: String(this.config.memoryMbytes ?? 1024),
      maxItems: String(limites.maxItems),
      maxTotalChargeUsd: limites.maxTotalChargeUsd.toFixed(2),
    });
    // Démarrage : JAMAIS relancé automatiquement (un second POST = un second run facturé),
    // sauf refus explicite de la plateforme (429), qui garantit qu'aucun run n'a démarré.
    let demarre: Record<string, unknown> | undefined;
    for (let essai = 0; essai < NB_ESSAIS_LECTURE && demarre === undefined; essai++) {
      const res = await this.appel('POST', `/v2/acts/${actor}/runs?${qs.toString()}`, input);
      if (res.status === 429 && essai < NB_ESSAIS_LECTURE - 1) {
        await this.sleep(1000 * 2 ** essai);
        continue;
      }
      demarre = await this.lireData(res, 'démarrage du run');
    }
    const runId = String(demarre?.['id'] ?? '');
    if (runId === '') throw new ScraperError('invalid_response', 'Run Apify sans identifiant');

    // Attente : marge de 120 s au-delà du timeout du run, puis abandon explicite.
    const limite = this.now() + (this.config.timeoutSecs + 120) * 1000;
    let run = demarre as Record<string, unknown>;
    while (!TERMINAUX.has(String(run['status']))) {
      if (this.now() > limite) {
        await this.appel('POST', `/v2/actor-runs/${runId}/abort`).catch(() => undefined);
        run = await this.lireRun(runId, 0);
        if (!TERMINAUX.has(String(run['status']))) run = { ...run, status: 'ABORTED' };
        break;
      }
      run = await this.lireRun(runId, this.config.waitSecs ?? 60);
    }

    const statut = String(run['status']) as StatutRun;
    const datasetId = String(run['defaultDatasetId'] ?? '');
    const items =
      datasetId === ''
        ? []
        : await this.avecEssais(async () => {
            const res = await this.appel(
              'GET',
              `/v2/datasets/${datasetId}/items?clean=true&format=json&limit=${limites.maxItems}`,
            );
            if (!res.ok) throw this.erreurHttp(res.status, 'lecture du dataset');
            const body: unknown = await res.json();
            if (!Array.isArray(body))
              throw new ScraperError('invalid_response', 'Le dataset Apify n’est pas un tableau');
            return body;
          });
    // Coût relu en dernier : Apify le finalise parfois quelques secondes après la fin du run.
    const final = await this.lireRun(runId, 0).catch(() => run);
    const usage = final['usageTotalUsd'];
    return {
      runId,
      statut,
      coupe: statut !== 'SUCCEEDED',
      items,
      usageTotalUsd: typeof usage === 'number' && Number.isFinite(usage) ? usage : null,
    };
  }

  private lireRun(runId: string, waitSecs: number): Promise<Record<string, unknown>> {
    return this.avecEssais(async () => {
      const res = await this.appel('GET', `/v2/actor-runs/${runId}?waitForFinish=${waitSecs}`);
      return this.lireData(res, 'suivi du run');
    });
  }

  /** Lectures (GET) relançables sans risque de double facturation. */
  private async avecEssais<T>(f: () => Promise<T>): Promise<T> {
    let derniere: unknown;
    for (let essai = 0; essai < NB_ESSAIS_LECTURE; essai++) {
      try {
        return await f();
      } catch (err) {
        derniere = err;
        if (err instanceof ScraperError && !err.retryable) throw err;
        await this.sleep(1000 * 2 ** essai);
      }
    }
    throw derniere;
  }

  private async lireData(res: Response, quoi: string): Promise<Record<string, unknown>> {
    if (!res.ok) throw this.erreurHttp(res.status, quoi);
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const data = body?.data;
    if (typeof data !== 'object' || data === null)
      throw new ScraperError('invalid_response', `Réponse Apify illisible (${quoi})`);
    return data as Record<string, unknown>;
  }

  private erreurHttp(status: number, quoi: string): ScraperError {
    if (status === 401 || status === 403)
      return new ScraperError('auth', `Authentification Apify refusée (${status})`);
    if (status === 429) return new ScraperError('rate_limited', `Limite de débit Apify (${quoi})`);
    if (status >= 500)
      return new ScraperError('upstream_unavailable', `Apify indisponible (${status}, ${quoi})`);
    return new ScraperError('upstream_error', `Réponse Apify inattendue (${status}, ${quoi})`);
  }

  private async appel(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new ScraperError('upstream_unavailable', `Erreur réseau vers Apify (${method})`, {
        cause: err,
      });
    }
  }
}
