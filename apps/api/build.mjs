// Construit l'API en un seul fichier : dist/server.js (et dist/cli.js).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  // sharp contient du code natif ; pg est optionnel : tous deux restent des dépendances installées.
  external: ['sharp', 'pg'],
  alias: { '@groupdeals/core': path.join(root, '../../packages/core/src/index.ts') },
  logLevel: 'info',
};
await build({ ...common, entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(root, 'dist/server.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/cli.ts')], outfile: path.join(root, 'dist/cli.js') });
