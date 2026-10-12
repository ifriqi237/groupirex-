/**
 * Mode démonstration : le site tourne alors seul dans le navigateur, sans serveur.
 * Les réponses de l'API viennent d'enregistrements (src/demo/backend.ts) et rien n'est
 * réellement enregistré ni payé. Le mode est fixé à la construction (build-demo.mjs).
 */
declare const __DEMO__: boolean;
export const DEMO: boolean = __DEMO__;

/** Chemin d'un fichier statique : relatif à la page en démonstration, absolu sinon. */
export const asset = (path: string): string => (DEMO ? path.replace(/^\//, '') : path);

/** Stockage local tolérant : navigation privée ou stockage bloqué ne cassent rien. */
const memory = new Map<string, string>();
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : la valeur reste en mémoire */
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* idem */
    }
  },
};
