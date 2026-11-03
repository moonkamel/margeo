import { describe, expect, it } from 'vitest';
import { contraindre } from '../src/content/position.js';

describe('position du bouton', () => {
  it('reste entièrement visible', () => {
    expect(contraindre({ droite: -50, bas: 5000 }, 1280, 800, 32)).toEqual({ droite: 0, bas: 768 });
    expect(contraindre({ droite: 2000, bas: -3 }, 1280, 800, 32)).toEqual({ droite: 1248, bas: 0 });
  });
  it('valeur corrompue en stockage → ramenée dans l’écran', () => {
    expect(contraindre({ droite: Number.NaN, bas: 20.6 }, 1280, 800, 32)).toEqual({
      droite: 0,
      bas: 21,
    });
  });
});
