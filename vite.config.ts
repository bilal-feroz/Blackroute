/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { devApi } from './server/devApi';

export default defineConfig(({ mode }) => {
  // Make .env values (API keys) visible to the /api handlers in dev,
  // without ever exposing them to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

  return {
    plugins: [react(), devApi(process.cwd())],
    server: { port: 5173 },
    build: { chunkSizeWarningLimit: 1400 },
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  };
});
