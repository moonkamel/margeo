import type { AnalysisResult, AnalyzeRequest, ReponseAnalyse } from './contrat.js';
import MAQUETTES from './mocks.json' with { type: 'json' };

export interface Maquette {
  cle: string;
  libelle: string;
  annonce: AnalyzeRequest;
  resultat: AnalysisResult | null;
  erreur: 'reseau' | null;
}

export const maquettes = MAQUETTES as unknown as Maquette[];

/** Maquette déterministe pour une annonce (mode maquette) : même annonce → même cas. */
export function maquettePour(annonce: AnalyzeRequest): Maquette {
  const n = Number(annonce.externalId.slice(-6)) || 0;
  return maquettes[n % maquettes.length] as Maquette;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /analyze sur l'API personnelle (token fixe), ou maquette locale. Jamais d'appel Apify ici :
 * l'annonce a déjà été lue sur la page.
 */
export async function analyserViaApi(
  annonce: AnalyzeRequest,
  cfg: { url: string; token: string; maquette: boolean; fetch?: typeof fetch },
): Promise<ReponseAnalyse> {
  if (cfg.maquette) {
    await attendre(700); // laisse voir le squelette, comme un vrai aller-retour
    const m = maquettePour(annonce);
    return m.resultat
      ? { ok: true, resultat: m.resultat }
      : { ok: false, erreur: 'reseau', detail: 'Maquette : API injoignable' };
  }
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${cfg.url.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(annonce),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, erreur: 'reseau', detail: String(err) };
  }
  if (!res.ok) return { ok: false, erreur: 'serveur', detail: `HTTP ${res.status}` };
  const corps = (await res.json().catch(() => null)) as AnalysisResult | null;
  if (!corps || (corps.status !== 'ok' && corps.status !== 'insufficient_data'))
    return { ok: false, erreur: 'serveur', detail: 'Réponse illisible' };
  return { ok: true, resultat: corps };
}
