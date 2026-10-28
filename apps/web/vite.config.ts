import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sharedClient = fileURLToPath(new URL('../../packages/shared/src/client.ts', import.meta.url));
// Override when another copy already uses the default ports: WEB_PORT=5180 API_PROXY=http://127.0.0.1:4100
const webPort = Number(process.env.WEB_PORT || 5173);
const apiProxy = process.env.API_PROXY || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Nest uses the CJS barrel (export *). Vite named-imports fail on that file.
      '@ethesis/shared': sharedClient,
    },
    // Prefer source .ts so leftover CommonJS *.js in packages/shared/src cannot win.
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
  },
  optimizeDeps: {
    exclude: ['@ethesis/shared'],
  },
  server: {
    host: '0.0.0.0',
    port: webPort,
    strictPort: true,
    open: '/login',
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': apiProxy,
      '/uploads': apiProxy,
    },
  },
});
