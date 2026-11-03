/**
 * Notification Telegram du scan : un message de synthèse, puis une carte par affaire (photo,
 * marge, lien direct vers l'annonce). Appels HTTPS directs à l'API Bot (pas de dépendance).
 *
 * SÉCURITÉ : le token figure dans l'URL de l'API Telegram. Il n'apparaît dans AUCUN message
 * d'erreur ni log : les erreurs ne citent que la méthode, le statut HTTP et la description
 * renvoyée par Telegram.
 */
import { formatEuros, type Etat } from '@margeo/shared';
import type { Affaire, ScanResult } from './run-scan.js';

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetch?: typeof fetch;
}

export class TelegramError extends Error {
  constructor(
    readonly methode: string,
    readonly statut: number,
    description: string,
  ) {
    super(`Telegram ${methode} : HTTP ${statut} — ${description}`);
    this.name = 'TelegramError';
  }
}

const LIBELLE_ETAT: Readonly<Record<Etat, string>> = {
  NEUF_AVEC_ETIQUETTE: 'neuf avec étiquette',
  NEUF_SANS_ETIQUETTE: 'neuf sans étiquette',
  TRES_BON: 'très bon état',
  BON: 'bon état',
  SATISFAISANT: 'état satisfaisant',
};

/** Échappement HTML (parse_mode HTML de Telegram). */
export function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const tronquer = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const signe = (c: number) => `${c > 0 ? '+' : ''}${formatEuros(c)}`;

const LIBELLE_SOURCE = {
  initial: 'coefficient initial',
  mixte: 'coefficient mixte (ventes observées)',
  observe: 'ventes observées',
} as const;

/** Carte d'une affaire (légende de photo : 1 024 caractères au plus). */
export function messageAffaire(a: Affaire): string {
  const lignes = [
    `🟢 <b>${signe(a.margeNetteCents)}</b> · ${echapperHtml(a.modele)}`,
    echapperHtml(tronquer(a.titre, 100)),
    `Prix ${formatEuros(a.prixCents)} → revente estimée ${formatEuros(a.valeurReventeCents)} (${LIBELLE_ETAT[a.etat]})`,
    `${a.taille ? `Taille ${echapperHtml(a.taille)} · ` : ''}score ${a.score}/100`,
    `<i>Estimation : prix neuf × ${LIBELLE_SOURCE[a.sourceCoefficient]}${a.prixVerifie ? '' : ', prix neuf non vérifié'}. Vérifie l'authenticité avant d'acheter.</i>`,
  ];
  return tronquer(lignes.join('\n'), 1024);
}

export function messageSynthese(r: ScanResult, date: Date): string {
  const jour = date.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
  });
  const tete =
    r.affaires.length === 0
      ? `☕ <b>Margeo — ${jour}</b> : aucune affaire ce matin.`
      : `☕ <b>Margeo — ${jour}</b> : ${r.affaires.length} affaire${r.affaires.length > 1 ? 's' : ''}` +
        (r.retenues > r.affaires.length ? ` (top ${r.affaires.length} sur ${r.retenues})` : '');
  const lignes = [
    tete,
    `${r.annoncesVues} annonces vues, ${r.candidates} détaillées. Dépense ${formatEuros(Math.round(r.depenseRunMilli / 1000))}.`,
  ];
  if (r.statut !== 'COMPLETED')
    lignes.push(`⚠️ Scan ${r.statut === 'BUDGET_STOPPED' ? 'arrêté (budget)' : 'partiel'}.`);
  for (const a of r.alertes) lignes.push(`⚠️ ${echapperHtml(tronquer(a, 200))}`);
  return lignes.join('\n');
}

async function appeler(cfg: TelegramConfig, methode: string, corps: Record<string, unknown>) {
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`https://api.telegram.org/bot${cfg.token}/${methode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, ...corps }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Le message d'une erreur réseau peut contenir l'URL (donc le token) : on ne le relaie pas.
    throw new TelegramError(methode, 0, err instanceof Error ? err.name : 'erreur réseau');
  }
  if (!res.ok) {
    let description = 'réponse illisible';
    try {
      const j = (await res.json()) as { description?: unknown };
      if (typeof j.description === 'string') description = j.description;
    } catch {
      /* corps non JSON */
    }
    throw new TelegramError(methode, res.status, description.replaceAll(cfg.token, '***'));
  }
}

const bouton = (url: string) => ({ inline_keyboard: [[{ text: 'Ouvrir sur Vinted', url }]] });

/**
 * Envoie la synthèse puis les affaires. Une photo refusée par Telegram retombe sur un message
 * texte. Renvoie les identifiants effectivement notifiés (à marquer « notifiés » par l'appelant).
 */
export async function notifierScan(
  cfg: TelegramConfig,
  r: ScanResult,
  date: Date,
): Promise<{ notifies: string[] }> {
  await appeler(cfg, 'sendMessage', {
    text: messageSynthese(r, date),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  const notifies: string[] = [];
  for (const a of r.affaires) {
    const texte = messageAffaire(a);
    let envoye = false;
    if (a.photoUrl) {
      try {
        await appeler(cfg, 'sendPhoto', {
          photo: a.photoUrl,
          caption: texte,
          parse_mode: 'HTML',
          reply_markup: bouton(a.url),
        });
        envoye = true;
      } catch (err) {
        if (!(err instanceof TelegramError) || err.statut !== 400) throw err;
      }
    }
    if (!envoye) {
      await appeler(cfg, 'sendMessage', {
        text: texte,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: bouton(a.url),
      });
    }
    notifies.push(a.externalId);
  }
  return { notifies };
}
