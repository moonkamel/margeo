import { describe, expect, it } from 'vitest';
import { BudgetLedger, formatMilli, type BudgetConfig } from '../../src/seed/index.js';

/** Configuration Phase 2b : 48 € d'arrêt dur = 30 € suivi + 18 € découverte. */
const CONFIG: BudgetConfig = {
  hardStopCents: 4800,
  suiviCents: 3000,
  decouverteCents: 1800,
  coutParResultatMilli: 1000,
  coutParRunMilli: 0, // frais par run testés dans decisions-2b.test.ts
};
const EUR = 100_000; // milli par euro

describe('BudgetLedger — arrêt dur', () => {
  it('atteint exactement 48,00 € puis refuse tout nouvel appel', () => {
    const l = new BudgetLedger({ ...CONFIG, suiviCents: 4800, decouverteCents: 0 });
    let appels = 0;
    for (;;) {
      const r = l.reserve('suivi', 1);
      if (typeof r === 'string') break;
      l.commit(r, 1);
      appels++;
    }
    expect(appels).toBe(4800); // 1 centime par résultat
    expect(l.totalMilli).toBe(48 * EUR);
    expect(l.stopped).toBe(true);
    expect(l.reserve('suivi', 1)).toBe('budget_cap');
  });

  it('se déclenche à 48,00 € et pas à 48,01 € : un appel qui dépasserait d’un centime est refusé', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 2999 * 1000, decouverte: 1800 * 1000 }); // 47,99 €
    expect(l.reserve('suivi', 2)).toBe('budget_cap'); // 48,01 € → refusé
    expect(l.totalMilli).toBe(4799 * 1000);
  });

  it('un appel qui tombe pile sur 48,00 € est autorisé, puis arrêt', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 2999 * 1000, decouverte: 1800 * 1000 });
    const r = l.reserve('suivi', 1);
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    l.commit(r, 1);
    expect(l.totalMilli).toBe(48 * EUR);
    expect(l.stopped).toBe(true);
  });

  it('dépense antérieure déjà au plafond → arrêté dès l’initialisation', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 3000 * 1000, decouverte: 1800 * 1000 });
    expect(l.stopped).toBe(true);
    expect(l.affordableResultats('suivi')).toBe(0);
  });

  it('tarif non entier en centimes (2,6 c / résultat) : jamais de dépassement', () => {
    const l = new BudgetLedger({ ...CONFIG, coutParResultatMilli: 2600 });
    let total = 0;
    while (!l.stopped) {
      const n = Math.min(37, l.affordableResultats('suivi'));
      const r = l.reserve('suivi', Math.max(n, 1));
      if (typeof r === 'string') break;
      l.commit(r, n);
      total += n;
    }
    expect(l.totalMilli).toBeLessThanOrEqual(48 * EUR);
    expect(48 * EUR - l.totalMilli).toBeLessThan(2600); // reliquat < 1 résultat
    expect(total).toBe(Math.floor((48 * EUR) / 2600));
  });
});

describe('BudgetLedger — enveloppes', () => {
  it('la découverte est coupée quand son enveloppe de 18 € est pleine, le suivi continue', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 0, decouverte: 1795 * 1000 });
    expect(l.reserve('decouverte', 6)).toBe('decouverte_coupee');
    expect(l.decouverteCoupee).toMatch(/découverte/);
    expect(typeof l.reserve('suivi', 100)).toBe('object');
  });

  it('dépassement de l’enveloppe suivi : la découverte est coupée en premier, le suivi emprunte le reliquat', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 2990 * 1000, decouverte: 500 * 1000 });
    const r = l.reserve('suivi', 50); // 30,40 € > 30 € d'enveloppe suivi
    expect(typeof r).toBe('object');
    expect(l.decouverteCoupee).toMatch(/suivi/);
    expect(l.reserve('decouverte', 1)).toBe('decouverte_coupee');
    expect(l.affordableResultats('suivi')).toBe(4800 - 2990 - 500);
  });

  it('affordableResultats permet de réduire un lot plutôt que de s’arrêter', () => {
    const l = new BudgetLedger(CONFIG, { suivi: 2990 * 1000, decouverte: 1790 * 1000 });
    expect(l.affordableResultats('suivi')).toBe(20);
    expect(l.affordableResultats('decouverte')).toBe(10);
  });

  it('anomalie : facturation supérieure à la réservation signalée et comptée', () => {
    const l = new BudgetLedger(CONFIG);
    const r = l.reserve('suivi', 5);
    if (typeof r === 'string') throw new Error('réservation refusée');
    expect(l.commit(r, 8)).toEqual({ milli: 8000, anomalie: true });
    expect(l.totalMilli).toBe(8000);
  });

  it('configuration invalide refusée', () => {
    expect(() => new BudgetLedger({ ...CONFIG, suiviCents: 4000 })).toThrow(/plafond/);
    expect(() => new BudgetLedger({ ...CONFIG, coutParResultatMilli: 2.5 })).toThrow(/invalide/);
    expect(() => new BudgetLedger({ ...CONFIG, hardStopCents: -1 })).toThrow();
  });

  it('formatMilli', () => {
    expect(formatMilli(48 * EUR)).toBe('48,00 €');
    expect(formatMilli(4801 * 1000)).toBe('48,01 €');
  });
});
