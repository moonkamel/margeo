/**
 * Script de contenu (vinted.fr) : bouton flottant discret sur les pages d'annonce, lecture de
 * l'annonce sur la page, ouverture du panneau. Aucune donnée vendeur, description ni photo lue.
 */
import type { Lecture, MessageContenu } from '../lib/contrat.js';
import { idAnnonce, lireAnnonce, pageDepuisDocument } from './extract.js';
import { contraindre, POSITION_DEFAUT, type Position } from './position.js';

const CLE_POSITION = 'margeo:position-bouton';
const TAILLE = 32;

function lire(): Lecture {
  return lireAnnonce(pageDepuisDocument(document), location.href);
}

function envoyer(message: MessageContenu) {
  chrome.runtime.sendMessage(message).catch(() => {
    /* panneau ou service worker indisponible : sans conséquence */
  });
}

/** Bouton dans un Shadow DOM fermé : aucun style de Vinted ne fuit dedans, et inversement. */
function creerBouton(): HTMLElement {
  const hote = document.createElement('div');
  hote.id = 'margeo-bouton';
  const ombre = hote.attachShadow({ mode: 'closed' });
  ombre.innerHTML = `
    <style>
      button {
        position: fixed; width: ${TAILLE}px; height: ${TAILLE}px; border-radius: 50%;
        border: none; padding: 0; cursor: grab; z-index: 2147483646;
        background: #0f766e; color: #fff; font: 600 15px/1 system-ui, sans-serif;
        box-shadow: 0 1px 4px rgba(0,0,0,.25); opacity: .45; transition: opacity .15s;
        touch-action: none; user-select: none;
      }
      button:hover, button:focus-visible { opacity: 1; }
      button:focus-visible { outline: 2px solid #0f766e; outline-offset: 2px; }
      button.glisse { cursor: grabbing; opacity: 1; }
    </style>
    <button type="button" aria-label="Margeo : analyser cette annonce" title="Margeo : analyser cette annonce">€</button>`;
  const bouton = ombre.querySelector('button') as HTMLButtonElement;

  let position: Position = POSITION_DEFAUT;
  const appliquer = () => {
    bouton.style.right = `${position.droite}px`;
    bouton.style.bottom = `${position.bas}px`;
  };
  appliquer();
  chrome.storage.local
    .get(CLE_POSITION)
    .then((r) => {
      const p = r[CLE_POSITION] as Position | undefined;
      if (p) {
        position = contraindre(p, innerWidth, innerHeight, TAILLE);
        appliquer();
      }
    })
    .catch(() => {});

  // Glisser-déposer : au-delà de 4 px de déplacement, c'est un glissement, pas un clic.
  let depart: { x: number; y: number; pos: Position } | null = null;
  let glisse = false;
  bouton.addEventListener('pointerdown', (e) => {
    depart = { x: e.clientX, y: e.clientY, pos: position };
    glisse = false;
    bouton.setPointerCapture(e.pointerId);
  });
  bouton.addEventListener('pointermove', (e) => {
    if (!depart) return;
    const dx = e.clientX - depart.x;
    const dy = e.clientY - depart.y;
    if (!glisse && Math.hypot(dx, dy) < 4) return;
    glisse = true;
    bouton.classList.add('glisse');
    position = contraindre(
      { droite: depart.pos.droite - dx, bas: depart.pos.bas - dy },
      innerWidth,
      innerHeight,
      TAILLE,
    );
    appliquer();
  });
  bouton.addEventListener('pointerup', () => {
    if (glisse) chrome.storage.local.set({ [CLE_POSITION]: position }).catch(() => {});
    bouton.classList.remove('glisse');
    depart = null;
  });
  // Clic (et clavier) : ouverture du panneau. Message envoyé DANS le geste utilisateur, condition
  // requise par chrome.sidePanel.open().
  bouton.addEventListener('click', () => {
    if (glisse) return;
    envoyer({ type: 'margeo:ouvrir', lecture: lire() });
  });
  return hote;
}

let bouton: HTMLElement | null = null;
let derniereUrl = '';

/** Vinted change d'annonce sans recharger la page : on suit l'URL. */
function synchroniser() {
  if (location.href === derniereUrl) return;
  derniereUrl = location.href;
  const surAnnonce = idAnnonce(location.href) !== null;
  if (surAnnonce && !bouton) {
    bouton = creerBouton();
    document.documentElement.append(bouton);
  } else if (!surAnnonce && bouton) {
    bouton.remove();
    bouton = null;
  }
  // Panneau éventuellement ouvert : il reçoit la nouvelle annonce une fois la page rendue.
  if (surAnnonce) setTimeout(() => envoyer({ type: 'margeo:annonce', lecture: lire() }), 800);
}

synchroniser();
new MutationObserver(synchroniser).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
addEventListener('popstate', synchroniser);
