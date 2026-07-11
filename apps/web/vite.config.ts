import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Import the frozen contract directly from its TS source (no build step).
      '@watson/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
      // Single source of truth for the fixture — imported via ?raw, never copied.
      '@fixtures': resolve(repoRoot, 'fixtures'),
    },
  },
  server: {
    fs: {
      // Allow importing the fixture + shared package from the monorepo root.
      allow: [repoRoot],
    },
  },
});
