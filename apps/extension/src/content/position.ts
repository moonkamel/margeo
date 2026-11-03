/** Position du bouton, en distances au coin bas-droit (px). */
export interface Position {
  droite: number;
  bas: number;
}

export const POSITION_DEFAUT: Position = { droite: 16, bas: 96 };

/** Garde le bouton entièrement visible, quelle que soit la taille de la fenêtre. */
export function contraindre(
  p: Position,
  largeur: number,
  hauteur: number,
  taille: number,
): Position {
  const borne = (v: number, max: number) => Math.min(Math.max(Number.isFinite(v) ? v : 0, 0), max);
  return {
    droite: Math.round(borne(p.droite, Math.max(0, largeur - taille))),
    bas: Math.round(borne(p.bas, Math.max(0, hauteur - taille))),
  };
}
