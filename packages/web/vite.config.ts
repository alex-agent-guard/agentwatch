import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Vercel / 自有域名用 '/'；GitHub Pages 子路径可设 VITE_BASE=/agentwatch/ */
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base,
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
});
