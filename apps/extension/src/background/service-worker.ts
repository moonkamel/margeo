/**
 * Service worker : ouvre le panneau, mémorise la dernière lecture par onglet, et porte les appels
 * à l'API (seul contexte qui détient le token, injecté au build).
 */
import type { AnalyzeRequest, MessageContenu, ReponseAnalyse } from '../lib/contrat.js';
import { analyserViaApi } from '../lib/api.js';

const cle = (tabId: number) => `margeo:lecture:${tabId}`;

// L'icône de l'extension ouvre aussi le panneau (secours si le bouton flottant est masqué).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, reponse) => {
  const m = message as MessageContenu | { type: 'margeo:analyser'; annonce: AnalyzeRequest };
  const tabId = sender.tab?.id;

  if (m.type === 'margeo:ouvrir' && tabId !== undefined) {
    // open() d'abord, sans await préalable : l'appel doit rester dans le geste utilisateur.
    chrome.sidePanel.open({ tabId }).catch(() => {});
    chrome.storage.session.set({ [cle(tabId)]: { ...m.lecture, a: Date.now() } }).catch(() => {});
    return false;
  }
  if (m.type === 'margeo:annonce' && tabId !== undefined) {
    chrome.storage.session.set({ [cle(tabId)]: { ...m.lecture, a: Date.now() } }).catch(() => {});
    return false;
  }
  if (m.type === 'margeo:analyser') {
    analyserViaApi(m.annonce, {
      url: __MARGEO_API_URL__,
      token: __MARGEO_API_TOKEN__,
      maquette: __MARGEO_MOCK__,
    }).then((r: ReponseAnalyse) => reponse(r));
    return true; // réponse asynchrone
  }
  return false;
});
