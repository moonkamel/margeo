import { describe, expect, it } from 'vitest';
import { etatSchema, modeVenteSchema, planSchema } from '@margeo/shared';
import { Etat, ModeVente, Plan } from '../src/index.js';

/** Garde-fou : les enums Prisma et les enums Zod partagés doivent rester alignés. */
describe('alignement enums Prisma ↔ Zod', () => {
  it('Etat', () => expect(Object.values(Etat).sort()).toEqual([...etatSchema.options].sort()));
  it('ModeVente', () =>
    expect(Object.values(ModeVente).sort()).toEqual([...modeVenteSchema.options].sort()));
  it('Plan', () => expect(Object.values(Plan).sort()).toEqual([...planSchema.options].sort()));
});
