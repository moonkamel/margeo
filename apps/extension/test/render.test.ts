import { describe, expect, it } from 'vitest';
import { maquettes } from '../src/lib/api.js';
import { echapper, rendre } from '../src/sidepanel/render.js';

const m = (cle: string) => {
  const x = maquettes.find((y) => y.cle === cle);
  if (!x?.resultat) throw new Error(cle);
  return { vue: 'resultat' as const, annonce: x.annonce, resultat: x.resultat };
};

describe('rendu du panneau', () => {
  it('VERT : KPI signé, badge, base de l’estimation, détail en accordéon', () => {
    const html = rendre(m('vert'));
    expect(html).toContain('+26,00');
    expect(html).toContain('badge-vert');
    expect(html).toContain('Bonne affaire');
    expect(html).toMatch(/basé sur\s+6 ventes en 30 jours \(niveau taille/);
    expect(html).toContain('<details class="detail">');
    expect(html).not.toContain('précision moyenne');
  });

  it('ORANGE et ROUGE', () => {
    expect(rendre(m('orange'))).toContain('Marge faible');
    const rouge = rendre(m('rouge'));
    expect(rouge).toContain('À éviter');
    expect(rouge).toMatch(/-20,83/);
    expect(rouge).toContain('précision moyenne'); // niveau marque
  });

  it('confiance basse signalée', () => {
    expect(rendre(m('confiance-basse'))).toContain('Confiance basse');
    expect(rendre(m('vert'))).not.toContain('Confiance basse');
  });

  it('données insuffisantes : aucune marge affichée', () => {
    const html = rendre(m('insuffisant'));
    expect(html).toContain('Données insuffisantes');
    expect(html).toContain('2 vente(s) observée(s) sur 5 requises');
    expect(html).not.toContain('kpi-valeur');
  });

  it('erreur réseau : bouton Réessayer ; lecture impossible : champs listés', () => {
    expect(rendre({ vue: 'erreur', erreur: 'reseau' })).toContain('data-action="reessayer"');
    expect(rendre({ vue: 'lecture-impossible', manquants: ['prix'] })).toContain(
      'Champs introuvables : prix',
    );
  });

  it('squelette et bandeau maquette', () => {
    expect(rendre({ vue: 'squelette' })).toContain('aria-busy="true"');
    expect(rendre({ vue: 'squelette' }, true)).toContain('Mode maquette');
    expect(rendre({ vue: 'squelette' }, false)).not.toContain('Mode maquette');
  });

  it('textes de la page échappés (pas d’injection HTML)', () => {
    const base = m('vert');
    const piege = '<img src=x onerror=alert(1)>"';
    const html = rendre({ ...base, annonce: { ...base.annonce, titre: piege, marque: piege } });
    expect(html).not.toContain('<img');
    expect(html).toContain(echapper(piege));
  });
});
