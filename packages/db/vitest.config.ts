import { defineConfig } from 'vitest/config';
import { sharedVitestConfig } from '../../vitest.shared';

// Charge le .env racine s'il existe : les tests de migration s'activent avec DATABASE_URL.
try {
  process.loadEnvFile('../../.env');
} catch {
  // Pas de .env : les tests d'intégration sont ignorés.
}

export default defineConfig({
  ...sharedVitestConfig,
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
