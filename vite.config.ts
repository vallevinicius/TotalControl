import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Avisa no build quando os dados legais da empresa (Termos e Privacidade) ainda estão em branco. */
function avisarDadosLegaisPendentes(): Plugin {
  return {
    name: 'avisar-dados-legais-pendentes',
    buildStart() {
      const arquivo = readFileSync(fileURLToPath(new URL('./src/config/empresa.ts', import.meta.url)), 'utf8');
      const faltando = [...arquivo.matchAll(/^\s{2}(razaoSocial|cnpj|emailContato|emailDpo):\s*'',/gm)].map((m) => m[1]);
      if (faltando.length > 0) {
        this.warn(`Termos e Privacidade com dados pendentes em src/config/empresa.ts: ${faltando.join(', ')}. Preencha antes de publicar.`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), avisarDadosLegaisPendentes()],
  resolve: {
    alias: {
      // Espelha o path mapping "@/*" definido em tsconfig.json.
      // O Vite não lê tsconfig "paths" automaticamente, então o alias
      // precisa ser declarado aqui também.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3099,
    // Repassa as chamadas de API pro Express (porta 4000) por trás do mesmo
    // endereço do Vite — o navegador só enxerga localhost:3099, front e API
    // "parecem" a mesma porta (e evita CORS em dev). Ver VITE_API_URL no
    // .env, que passa a ser um caminho relativo ("/api") em vez de uma URL
    // absoluta com porta própria.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
