import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./src/client'),
  publicDir: r('./public'),
  plugins: [react()],
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Reachable from other devices on the network. The whole point of this
    // project is playing with somebody else, and a dev server bound to
    // localhost cannot be joined from the phone in your hand.
    host: true,
    proxy: {
      // The Fastify server owns /ws and /api in dev too, so the client code
      // never needs to know whether it is running behind Vite or not.
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
});
