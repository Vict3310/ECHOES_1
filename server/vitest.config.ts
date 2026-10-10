import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    env: {
      NODE_ENV: 'test',
      // Tests never call a live model. The offline retrieval path is exercised
      // explicitly, and provider behaviour is covered with mocks.
      GEMMA_PROVIDER: 'none',
      DATABASE_URL: '',
      ADMIN_API_TOKEN: 'test-admin-token',
      ALATPAY_ENV: 'sandbox',
    },
  },
});
