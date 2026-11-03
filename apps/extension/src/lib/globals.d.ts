/** Constantes injectées par esbuild au build (scripts/build.mjs). */
declare const __MARGEO_MOCK__: boolean;
declare const __MARGEO_API_URL__: string;
/** Uniquement dans le service worker. */
declare const __MARGEO_API_TOKEN__: string;

/**
 * Sous-ensemble des API Chrome utilisées (évite @types/chrome tant qu'aucune dépendance n'est
 * ajoutée au lockfile). À remplacer par @types/chrome lors de la mise à jour des dépendances.
 */
declare namespace chrome {
  interface MessageSender {
    tab?: { id?: number; windowId?: number };
  }
  namespace runtime {
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: MessageSender,
          reply: (r?: unknown) => void,
        ) => void | boolean,
      ): void;
    };
  }
  namespace sidePanel {
    function open(options: { tabId?: number; windowId?: number }): Promise<void>;
    function setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  }
  namespace tabs {
    function query(q: { active: boolean; currentWindow: boolean }): Promise<{ id?: number }[]>;
  }
  namespace storage {
    interface Zone {
      get(cle: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: Zone;
    const session: Zone;
    const onChanged: {
      addListener(
        cb: (changes: Record<string, { newValue?: unknown }>, zone: string) => void,
      ): void;
    };
  }
}
