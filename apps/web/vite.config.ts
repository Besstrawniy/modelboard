import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const envDir = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  return {
    plugins: [react()],
    envDir,
    server: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:' + (process.env.API_PORT || env.API_PORT || '3001'), changeOrigin: true },
        '/collab': { target: 'ws://127.0.0.1:' + (process.env.COLLAB_PORT || env.COLLAB_PORT || '1234'), ws: true, changeOrigin: true },
      },
    },
  };
});
