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
      // Blank the merchant credentials so tests never inherit the developer's
      // .env. With placeholder keys present, alatpayStatus() reports the provider
      // as configured and the booking tests attempt a real call to api.alatpay.com
      // instead of exercising the simulated checkout path they assert on.
      // Uploads go to a scratch directory, never the repository, and the size limit
      // is small so the oversize case can be tested without writing megabytes.
      UPLOADS_DIR: '/tmp/echoes-test-uploads',
      UPLOADS_MAX_BYTES: '4096',
      ALATPAY_PUBLIC_KEY: '',
      ALATPAY_SECRET_KEY: '',
      ALATPAY_BUSINESS_ID: '',
      ALATPAY_INIT_PATH: '',
      ALATPAY_VERIFY_PATH: '',
    },
  },
});
