// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    testTimeout: 30000,
  },
});
