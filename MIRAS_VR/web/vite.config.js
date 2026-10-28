import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev` serves plain http://localhost (WebXR treats localhost as secure).
// `npm run dev:https` adds a self-signed certificate and listens on the LAN so a
// Quest on the same Wi-Fi can open https://<mac-ip>:5173 — immersive-vr needs HTTPS.
export default defineConfig(({ mode }) => ({
  base: './', // relative asset URLs: the built dist/ works from any static HTTPS host or sub-path
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { port: 5173 },
  // three.js alone is ~700 kB minified (~200 kB gzipped); one chunk is fine here.
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 1000 },
}));
