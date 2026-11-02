import { randomUUID } from 'node:crypto';
import type {
  Cellule,
  NewTracked,
  ObservationInput,
  SeedRepository,
  SeedRunSummary,
  SeedTx,
  SoldProjection,
  TrackedState,
} from '../../src/seed/index.js';

interface RunRow {
  id: string;
  campagne: string;
  suivi: number;
  decouverte: number;
  resultatsFactures: number;
  summary: SeedRunSummary | null;
}

interface State {
  tracked: Map<string, TrackedState>;
  sousCategories: Map<number, { parentId: number; libelle: string }>;
  observations: ObservationInput[];
  ventes: Map<string, SoldProjection>;
}

/** Dépôt en mémoire avec vraie sémantique transactionnelle (tout ou rien) et injection de pannes. */
export class MemoryRepo implements SeedRepository {
  state: State = {
    tracked: new Map(),
    sousCategories: new Map(),
    observations: [],
    ventes: new Map(),
  };
  runs: RunRow[] = [];
  spendLog: { envelope: string; milli: number }[] = [];
  /** Panne simulée : appelée avant chaque écriture, peut lever. */
  failWrite: ((op: string, arg: unknown) => void) | null = null;
  failListToRecheck = false;
  brandAliases: { alias: string; marque: string; valide: boolean }[] = [];

  constructor(
    private readonly priorSpend: { suivi: number; decouverte: number } = {
      suivi: 0,
      decouverte: 0,
    },
  ) {}

  async loadBrandAliases() {
    return this.brandAliases.map((a) => ({ ...a }));
  }

  async campaignSpent(campagne: string) {
    const rows = this.runs.filter((r) => r.campagne === campagne);
    return {
      suivi: this.priorSpend.suivi + rows.reduce((a, r) => a + r.suivi, 0),
      decouverte: this.priorSpend.decouverte + rows.reduce((a, r) => a + r.decouverte, 0),
    };
  }

  async startRun(campagne: string) {
    const id = randomUUID();
    this.runs.push({ id, campagne, suivi: 0, decouverte: 0, resultatsFactures: 0, summary: null });
    return id;
  }

  async recordSpend(
    runId: string,
    envelope: 'suivi' | 'decouverte',
    milli: number,
    resultats: number,
  ) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error('run inconnu');
    run[envelope] += milli;
    run.resultatsFactures += resultats;
    this.spendLog.push({ envelope, milli });
  }

  async finishRun(runId: string, summary: SeedRunSummary) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.summary = summary;
  }

  async listToRecheck(before: Date, limit: number) {
    if (this.failListToRecheck) throw new Error('base indisponible');
    return [...this.state.tracked.values()]
      .filter(
        (t) => t.statut === 'ACTIVE' && t.catalogIdRecherche !== null && t.derniereVerifAt < before,
      )
      .sort((a, b) => a.derniereVerifAt.getTime() - b.derniereVerifAt.getTime())
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async countActive(c: Cellule) {
    const n = (v: string | null) => v?.trim().toLowerCase() ?? null;
    return [...this.state.tracked.values()].filter(
      (t) =>
        t.statut === 'ACTIVE' &&
        t.catalogIdRecherche === c.catalogId &&
        n(t.marque) === n(c.marque) &&
        (c.taille === null || n(t.taille) === n(c.taille)),
    ).length;
  }

  async countNonRattachees() {
    return [...this.state.tracked.values()].filter(
      (t) => t.statut === 'ACTIVE' && t.catalogIdRecherche === null,
    ).length;
  }

  async subcategoryParents(ids: readonly number[]) {
    const m = new Map<number, number>();
    for (const id of ids) {
      const v = this.state.sousCategories.get(id);
      if (v) m.set(id, v.parentId);
    }
    return m;
  }

  async trackedExternalIds(ids: readonly string[]) {
    const known = new Set([...this.state.tracked.values()].map((t) => t.externalId));
    return new Set(ids.filter((id) => known.has(id)));
  }

  async transaction<T>(fn: (tx: SeedTx) => Promise<T>): Promise<T> {
    const draft: State = {
      tracked: new Map([...this.state.tracked].map(([k, v]) => [k, { ...v }])),
      sousCategories: new Map(this.state.sousCategories),
      observations: [...this.state.observations],
      ventes: new Map(this.state.ventes),
    };
    const guard = (op: string, arg: unknown) => this.failWrite?.(op, arg);
    const tx: SeedTx = {
      async createTracked(t: NewTracked) {
        guard('createTracked', t);
        if ([...draft.tracked.values()].some((x) => x.externalId === t.externalId)) {
          throw new Error('unique (plateforme, externalId)');
        }
        const row = { ...t, id: randomUUID() };
        draft.tracked.set(row.id, row);
        return { ...row };
      },
      async updateTracked(id, patch) {
        guard('updateTracked', { id, patch });
        const cur = draft.tracked.get(id);
        if (!cur) throw new Error('annonce suivie inconnue');
        draft.tracked.set(id, { ...cur, ...patch });
      },
      async appendObservation(o) {
        guard('appendObservation', o);
        draft.observations.push(o);
      },
      async writeSoldProjection(s) {
        guard('writeSoldProjection', s);
        draft.ventes.set(s.trackedListingId, s);
      },
      async recordSubcategory(m) {
        guard('recordSubcategory', m);
        if (!draft.sousCategories.has(m.subcategoryId))
          draft.sousCategories.set(m.subcategoryId, { parentId: m.parentId, libelle: m.libelle });
      },
    };
    const result = await fn(tx); // si fn lève, le brouillon est abandonné
    this.state = draft;
    return result;
  }

  totalSpent(): number {
    return this.runs.reduce((a, r) => a + r.suivi + r.decouverte, 0);
  }

  byExternalId(id: string): TrackedState | undefined {
    return [...this.state.tracked.values()].find((t) => t.externalId === id);
  }
}
