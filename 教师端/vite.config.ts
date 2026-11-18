import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'TEACHER_');
  const target = env.TEACHER_API_PROXY_TARGET?.trim();
  return {
    base: './',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: false,
      proxy: target ? { '/api/teacher': { target, changeOrigin: true } } : undefined,
    },
  };
});
