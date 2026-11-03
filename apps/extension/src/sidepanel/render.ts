/**
 * Rendu PUR du panneau (état → HTML). Tout texte venant de la page ou de l'API est échappé.
 */
import type { AnalysisResult, AnalyzeRequest, MarginLine } from '../lib/contrat.js';

export type Etat =
  | { vue: 'squelette' }
  | { vue: 'aucune-annonce' }
  | { vue: 'lecture-impossible'; manquants: string[] }
  | { vue: 'erreur'; erreur: 'reseau' | 'serveur' }
  | { vue: 'resultat'; annonce: AnalyzeRequest; resultat: AnalysisResult };

export const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const euros = (cents: number) => EUR.format(cents / 100).replace(/ /g, ' ');
const signe = (cents: number) => (cents > 0 ? `+${euros(cents)}` : euros(cents));

const STATUT = {
  VERT: { classe: 'vert', libelle: 'Bonne affaire' },
  ORANGE: { classe: 'orange', libelle: 'Marge faible' },
  ROUGE: { classe: 'rouge', libelle: 'À éviter' },
} as const;

const NIVEAU = {
  categorie_marque_taille: 'niveau taille',
  categorie_marque: 'niveau marque',
  categorie: 'niveau catégorie',
} as const;

function ligne(l: MarginLine): string {
  const cout = l.montantCents < 0;
  return `<li class="ligne">
      <span class="ligne-libelle">${echapper(l.libelle)}${l.detail ? `<small>${echapper(l.detail)}</small>` : ''}</span>
      <span class="ligne-montant ${cout ? 'cout' : ''}">${cout ? euros(l.montantCents) : euros(l.montantCents)}</span>
    </li>`;
}

function entete(a: AnalyzeRequest): string {
  const meta = [a.marque, a.taille, a.etat].filter(Boolean).map((t) => echapper(t as string));
  return `<header class="annonce">
    <p class="annonce-titre" title="${echapper(a.titre)}">${echapper(a.titre)}</p>
    <p class="annonce-meta">${meta.join(' · ')} — achat ${euros(a.prixCents)}</p>
  </header>`;
}

export function rendre(etat: Etat, maquette = false): string {
  const bandeau = maquette
    ? '<p class="bandeau-maquette">Mode maquette : résultats fictifs, aucune donnée réelle</p>'
    : '';
  switch (etat.vue) {
    case 'squelette':
      return `${bandeau}<div class="squelette" aria-busy="true" aria-label="Analyse en cours">
        <div class="os os-titre"></div><div class="os os-meta"></div>
        <div class="os os-kpi"></div><div class="os os-badge"></div>
        <div class="os os-ligne"></div><div class="os os-ligne"></div><div class="os os-ligne"></div>
      </div>`;
    case 'aucune-annonce':
      return `${bandeau}<div class="message">
        <p class="message-titre">Aucune annonce</p>
        <p>Ouvre une annonce Vinted, puis clique sur le bouton <strong>€</strong>.</p></div>`;
    case 'lecture-impossible':
      return `${bandeau}<div class="message message-erreur" role="alert">
        <p class="message-titre">Impossible de lire cette annonce</p>
        <p>Essaie sur une autre annonce.</p>
        <p class="discret">Champs introuvables : ${etat.manquants.map(echapper).join(', ')}</p></div>`;
    case 'erreur':
      return `${bandeau}<div class="message message-erreur" role="alert">
        <p class="message-titre">${etat.erreur === 'reseau' ? 'Serveur injoignable' : 'Erreur du serveur'}</p>
        <p>${etat.erreur === 'reseau' ? 'Vérifie que l’API Margeo tourne, puis réessaie.' : 'L’analyse a échoué côté serveur.'}</p>
        <button type="button" class="reessayer" data-action="reessayer">Réessayer</button></div>`;
    case 'resultat': {
      const { annonce, resultat } = etat;
      if (resultat.status === 'insufficient_data') {
        return `${bandeau}${entete(annonce)}<div class="message">
          <p class="message-titre">Données insuffisantes</p>
          <p>${echapper(resultat.message)}.</p>
          <p class="discret">${resultat.nbVentesTrouvees} vente(s) observée(s) sur ${resultat.minVentesRequis} requises. Aucune marge n’est inventée.</p></div>`;
      }
      const { margin, estimate } = resultat;
      const s = STATUT[margin.statut];
      const precision = estimate.niveau === 'categorie_marque_taille' ? '' : ' · précision moyenne';
      const confiance =
        margin.confidence === 'low'
          ? '<p class="confiance-basse">Confiance basse : vitesse de vente inconnue</p>'
          : '';
      return `${bandeau}${entete(annonce)}
        <section class="kpi kpi-${s.classe}" aria-label="Marge nette">
          <p class="kpi-libelle">Marge nette</p>
          <p class="kpi-valeur">${signe(margin.margeNetteCents)}</p>
          <span class="badge badge-${s.classe}">${s.libelle}</span>
        </section>
        <p class="base">Revente estimée ${euros(estimate.prixReventeEstimeCents)} — basé sur
          ${estimate.nbVentes} ventes en ${estimate.fenetreJours} jours (${NIVEAU[estimate.niveau]},
          multiplicateur état ${estimate.source === 'empirical' ? 'empirique' : 'estimé'})${precision}</p>
        ${confiance}
        <details class="detail">
          <summary>Détail du calcul</summary>
          <ul>${margin.lignes.map(ligne).join('')}</ul>
          <p class="discret">Fourchette des ventes : ${euros(estimate.minCents)} – ${euros(estimate.maxCents)}${
            estimate.medianJoursVente === null
              ? ''
              : ` · vendu en ${estimate.medianJoursVente} j (médiane)`
          }</p>
        </details>`;
    }
  }
}
