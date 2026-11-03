/**
 * Panneau latéral. Squelette affiché immédiatement (< 500 ms), puis lecture de l'annonce mémorisée
 * pour l'onglet actif et analyse via le service worker (seul détenteur du token).
 * Hors extension (aperçu local, captures) : ?cas=vert|orange|rouge|insuffisant|… affiche une maquette.
 */
import { maquettes } from '../lib/api.js';
import type { Lecture, ReponseAnalyse } from '../lib/contrat.js';
import { rendre, type Etat } from './render.js';

const racine = document.getElementById('app') as HTMLElement;
const enExtension = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.storage;
const maquette = enExtension ? __MARGEO_MOCK__ : true;
let derniere: Lecture | null = null;

function afficher(etat: Etat) {
  racine.innerHTML = rendre(etat, maquette);
}

async function analyser(lecture: Lecture | null) {
  derniere = lecture;
  if (!lecture) return afficher({ vue: 'aucune-annonce' });
  if (!lecture.ok) return afficher({ vue: 'lecture-impossible', manquants: lecture.manquants });
  afficher({ vue: 'squelette' });
  const r = (await chrome.runtime
    .sendMessage({ type: 'margeo:analyser', annonce: lecture.annonce })
    .catch((e: unknown) => ({ ok: false, erreur: 'reseau', detail: String(e) }))) as ReponseAnalyse;
  if (derniere !== lecture) return; // une autre annonce a été ouverte entre-temps
  afficher(
    r.ok
      ? { vue: 'resultat', annonce: lecture.annonce, resultat: r.resultat }
      : { vue: 'erreur', erreur: r.erreur },
  );
}

racine.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-action="reessayer"]')) void analyser(derniere);
});

async function demarrer() {
  afficher({ vue: 'squelette' });
  if (!enExtension) {
    const cas = new URLSearchParams(location.search).get('cas') ?? 'vert';
    if (cas === 'squelette') return;
    if (cas === 'lecture-impossible') return afficher({ vue: cas, manquants: ['prix', 'marque'] });
    const m = maquettes.find((x) => x.cle === cas) ?? maquettes[0];
    if (!m) return;
    return afficher(
      m.resultat
        ? { vue: 'resultat', annonce: m.annonce, resultat: m.resultat }
        : { vue: 'erreur', erreur: 'reseau' },
    );
  }
  const [onglet] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = onglet?.id;
  if (tabId === undefined) return afficher({ vue: 'aucune-annonce' });
  const cle = `margeo:lecture:${tabId}`;
  const stocke = await chrome.storage.session.get(cle);
  await analyser((stocke[cle] as Lecture | undefined) ?? null);
  chrome.storage.onChanged.addListener((changes, zone) => {
    const c = changes[cle];
    if (zone === 'session' && c?.newValue) void analyser(c.newValue as Lecture);
  });
}

void demarrer();
