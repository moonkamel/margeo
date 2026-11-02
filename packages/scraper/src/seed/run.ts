import { BudgetLedger, formatMilli, type BudgetConfig, type Envelope } from './budget.js';
import {
  firstObservation,
  matchesCellule,
  newTrackedFrom,
  transition,
  type Evenement,
} from './state.js';
import type {
  Cellule,
  SeedRepository,
  SeedRunStatut,
  SeedRunSummary,
  SeedSource,
} from './types.js';

export interface SeedLogger {
  (event: string, data: Record<string, unknown>): void;
}

export interface RunSeedOptions {
  campagne: string;
  cellules: readonly Cellule[];
  budget: BudgetConfig;
  source: SeedSource;
  repo: SeedRepository;
  now?: () => Date;
  log?: SeedLogger;
  /** Taille max d'un lot de re-vérification (défaut 50). */
  batchSize?: number;
  /** Résultats max de découverte par cellule et par jour (défaut 5). */
  maxDecouverteParCellule?: number;
  /**
   * Parc cible d'annonces actives par cellule (défaut 20, soit ~300 pour 15 cellules).
   * La découverte ne fait que compléter jusqu'à cette cible : sans elle, le parc suivi
   * grossirait chaque jour et le coût de re-vérification exploserait.
   */
  cibleActivesParCellule?: number;
  /** Une annonce vérifiée depuis moins longtemps n'est pas re-vérifiée (défaut 20 h). */
  intervalleVerifMs?: number;
}

export interface RunSeedResult extends SeedRunSummary {
  runId: string;
  depenseRunMilli: number;
  depenseCampagneMilli: number;
  plafondMilli: number;
  /** Message d'alerte à transmettre (arrêt dur, découverte coupée, anomalie de facturation). */
  alertes: string[];
}

interface CelluleLog {
  vues: number;
  nouvelles: number;
  ventes: number;
  disparitions: number;
  erreurs: number;
}

const cleCellule = (c: { categorie: string; marque: string | null; taille: string | null }) =>
  `${c.categorie}|${c.marque}|${c.taille ?? '*'}`;

/**
 * Exécution quotidienne du seed :
 *  1. re-vérification des annonces suivies (enveloppe « suivi », prioritaire) ;
 *  2. découverte de nouvelles annonces par cellule (enveloppe « découverte »).
 *
 * Garanties :
 *  - aucun appel n'est lancé si son coût MAXIMAL ferait dépasser le plafond ;
 *  - la dépense est persistée après chaque appel (un crash ne la fait pas oublier) ;
 *  - chaque annonce est écrite dans sa propre transaction : une erreur sur l'une
 *    n'en laisse aucune trace partielle et n'empêche pas les autres.
 */
export async function runSeed(opts: RunSeedOptions): Promise<RunSeedResult> {
  const now = opts.now ?? (() => new Date());
  const log: SeedLogger = opts.log ?? (() => {});
  const batchSize = opts.batchSize ?? 50;
  const maxDecouverte = opts.maxDecouverteParCellule ?? 5;
  const intervalle = opts.intervalleVerifMs ?? 20 * 60 * 60 * 1000;
  const cible = opts.cibleActivesParCellule ?? 20;
  const { repo, source, campagne } = opts;

  const dejaDepense = await repo.campaignSpent(campagne);
  const ledger = new BudgetLedger(opts.budget, dejaDepense);
  const startedAt = now();
  const runId = await repo.startRun(campagne, opts.budget.hardStopCents, startedAt);
  const depenseAvant = ledger.totalMilli;
  const alertes: string[] = [];
  const parCellule: Record<string, CelluleLog> = {};
  const compteurs = {
    annoncesVerifiees: 0,
    nouvellesAnnonces: 0,
    ventesDetectees: 0,
    disparitions: 0,
    erreurs: 0,
  };
  let arretMotif: string | null = null;

  const celluleLog = (key: string): CelluleLog =>
    (parCellule[key] ??= { vues: 0, nouvelles: 0, ventes: 0, disparitions: 0, erreurs: 0 });

  log('seed.start', {
    runId,
    campagne,
    dejaDepense: formatMilli(depenseAvant),
    plafond: formatMilli(ledger.snapshot().capMilli),
  });

  /** Réserve, appelle, enregistre la dépense. Retourne null si le budget refuse l'appel. */
  async function billed<T extends { resultatsFactures: number }>(
    envelope: Envelope,
    maxResultats: number,
    call: () => Promise<T>,
  ): Promise<T | null> {
    const r = ledger.reserve(envelope, maxResultats);
    if (typeof r === 'string') return null;
    let result: T;
    try {
      result = await call();
    } catch (err) {
      // Appel en échec : on compte prudemment le coût maximal (la source a pu facturer).
      ledger.commit(r, maxResultats);
      await repo.recordSpend(runId, envelope, r.maxMilli, maxResultats);
      throw err;
    }
    const { milli, anomalie } = ledger.commit(r, result.resultatsFactures);
    await repo.recordSpend(runId, envelope, milli, result.resultatsFactures);
    if (anomalie) {
      alertes.push(
        `Anomalie de facturation : ${result.resultatsFactures} résultats facturés pour ${maxResultats} max (${envelope}).`,
      );
    }
    return result;
  }

  const count = (key: string, e: Evenement) => {
    const c = celluleLog(key);
    if (e === 'vue') c.vues++;
    if (e === 'vendue') {
      c.ventes++;
      compteurs.ventesDetectees++;
    }
    if (e === 'disparue') {
      c.disparitions++;
      compteurs.disparitions++;
    }
  };

  try {
    // 1. Re-vérification --------------------------------------------------------------------
    const avant = new Date(now().getTime() - intervalle);
    const aVerifier = await repo.listToRecheck(avant, 100_000);
    for (let i = 0; i < aVerifier.length && !ledger.stopped;) {
      const taille = Math.min(batchSize, aVerifier.length - i, ledger.affordableResultats('suivi'));
      if (taille <= 0) {
        ledger.reserve('suivi', 1); // déclenche l'arrêt dur
        break;
      }
      const lot = aVerifier.slice(i, i + taille);
      i += taille;
      let reponse;
      try {
        reponse = await billed('suivi', lot.length, () => source.recheck(lot.map((t) => t.url)));
      } catch (err) {
        compteurs.erreurs++;
        log('seed.recheck.error', { runId, lot: lot.length, error: String(err) });
        continue;
      }
      if (!reponse) break;

      const parUrl = new Map(reponse.results.map((r) => [r.url, r]));
      for (const t of lot) {
        const resultat = parUrl.get(t.url) ?? { url: t.url, outcome: 'not_found' as const };
        // Journal rattaché à la cellule d'origine (et non à la taille réelle de l'annonce).
        const cellule = opts.cellules.find((c) => matchesCellule(t, c));
        const key = cellule ? cleCellule(cellule) : 'hors-cellule';
        const tr = transition(t, resultat, now());
        if (tr.evenement === 'illisible') {
          compteurs.erreurs++;
          celluleLog(key).erreurs++;
          continue;
        }
        try {
          await repo.transaction(async (tx) => {
            await tx.updateTracked(t.id, tr.patch);
            if (tr.observation)
              await tx.appendObservation({ ...tr.observation, trackedListingId: t.id });
            if (tr.vente) await tx.writeSoldProjection({ ...tr.vente, trackedListingId: t.id });
          });
          compteurs.annoncesVerifiees++;
          count(key, tr.evenement);
        } catch (err) {
          compteurs.erreurs++;
          celluleLog(key).erreurs++;
          log('seed.recheck.write_error', { runId, externalId: t.externalId, error: String(err) });
        }
      }
    }
    if (ledger.stopped) arretMotif = 'budget_cap';

    // 2. Découverte ------------------------------------------------------------------------
    for (const cellule of opts.cellules) {
      if (ledger.stopped || ledger.decouverteCoupee) break;
      const key = cleCellule(cellule);
      const manquantes = cible - (await repo.countActive(cellule));
      if (manquantes <= 0) continue; // parc complet : aucune découverte, aucune dépense
      const max = Math.min(maxDecouverte, manquantes, ledger.affordableResultats('decouverte'));
      if (max <= 0) {
        ledger.reserve('decouverte', maxDecouverte); // enregistre le motif de coupure
        break;
      }
      let reponse;
      try {
        reponse = await billed('decouverte', max, () => source.discover(cellule, max));
      } catch (err) {
        compteurs.erreurs++;
        celluleLog(key).erreurs++;
        log('seed.discover.error', { runId, cellule: key, error: String(err) });
        continue;
      }
      if (!reponse) break;

      const candidates = reponse.listings.filter(
        (d) => d.listing.statut === 'active' && matchesCellule(d.listing, cellule),
      );
      const dejaSuivies = await repo.trackedExternalIds(
        candidates.map((d) => d.listing.externalId),
      );
      let ajoutees = 0;
      for (const d of candidates) {
        if (ajoutees >= manquantes) break;
        if (dejaSuivies.has(d.listing.externalId)) continue;
        dejaSuivies.add(d.listing.externalId);
        try {
          await repo.transaction(async (tx) => {
            const t = await tx.createTracked(newTrackedFrom(d.listing, now()));
            await tx.appendObservation({
              ...firstObservation(d.listing, d.payload, now()),
              trackedListingId: t.id,
            });
          });
          compteurs.nouvellesAnnonces++;
          celluleLog(key).nouvelles++;
          ajoutees++;
        } catch (err) {
          compteurs.erreurs++;
          celluleLog(key).erreurs++;
          log('seed.discover.write_error', {
            runId,
            externalId: d.listing.externalId,
            error: String(err),
          });
        }
      }
    }
  } catch (err) {
    // Erreur inattendue (base indisponible…) : le run est marqué FAILED, la dépense déjà
    // enregistrée appel par appel reste comptée, puis l'erreur remonte à l'appelant.
    const snap = ledger.snapshot();
    log('seed.failed', {
      runId,
      error: String(err),
      depenseCampagne: formatMilli(snap.totalMilli),
    });
    await repo
      .finishRun(
        runId,
        { statut: 'FAILED', ...compteurs, details: { cellules: parCellule, erreur: String(err) } },
        now(),
      )
      .catch(() => {});
    throw err;
  }

  if (ledger.stopped) arretMotif = 'budget_cap';
  const snap = ledger.snapshot();
  if (arretMotif === 'budget_cap') {
    alertes.unshift(
      `ARRÊT DUR : plafond de ${formatMilli(snap.capMilli)} atteint (dépense campagne ${formatMilli(snap.totalMilli)}). Crawler coupé.`,
    );
  }
  if (ledger.decouverteCoupee) alertes.push(`Découverte coupée : ${ledger.decouverteCoupee}.`);

  const statut: SeedRunStatut =
    arretMotif === 'budget_cap'
      ? 'BUDGET_STOPPED'
      : compteurs.erreurs > 0
        ? 'PARTIAL'
        : 'COMPLETED';
  const summary: SeedRunSummary = {
    statut,
    ...compteurs,
    details: {
      cellules: parCellule,
      arret: arretMotif,
      decouverteCoupee: ledger.decouverteCoupee,
      depense: { suivi: snap.suivi, decouverte: snap.decouverte, total: snap.totalMilli },
      alertes,
    },
  };
  await repo.finishRun(runId, summary, now());
  log('seed.end', {
    runId,
    statut,
    ...compteurs,
    depenseRun: formatMilli(snap.totalMilli - depenseAvant),
    depenseCampagne: formatMilli(snap.totalMilli),
    alertes,
  });

  return {
    ...summary,
    runId,
    depenseRunMilli: snap.totalMilli - depenseAvant,
    depenseCampagneMilli: snap.totalMilli,
    plafondMilli: snap.capMilli,
    alertes,
  };
}
