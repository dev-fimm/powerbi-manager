import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Proxy opcional: com isso o front pode chamar "/api/..." sem CORS.
    // Se VITE_API_URL estiver definido, o cliente usa a URL absoluta e ignora o proxy.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173, host: true },
});
