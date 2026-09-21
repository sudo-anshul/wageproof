import { defineConfig } from 'vite';
export default defineConfig({ server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/.data/**','**/work/**','**/evaluation/**','**/media/**'] }, proxy: { '/api': 'http://127.0.0.1:4318' } }, build: { target: 'es2022' } });
