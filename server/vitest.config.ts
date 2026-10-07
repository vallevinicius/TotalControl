import { defineConfig } from 'vitest/config';
import { urlDoBancoDeTeste } from './tests/url-teste.js';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Um arquivo por vez: todos compartilham o mesmo banco de teste.
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: urlDoBancoDeTeste(), // só nos workers; o setup global calcula a sua própria
      JWT_SECRET: 'segredo-so-para-testes-com-mais-de-trinta-e-dois-caracteres',
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3099',
      MERCADOPAGO_ACCESS_TOKEN: 'TESTE',
      MERCADOPAGO_API_URL: 'http://localhost:4998',
      ADMIN_EMAIL: 'admin@teste.local',
      ADMIN_SENHA: 'Admin@Teste123',
    },
  },
});
