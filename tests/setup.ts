/**
 * Global test setup for Vitest
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.WORK_DIR = '/tmp/test-workdir';
  process.env.STORAGE_TYPE = 'memory';
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Cleanup
afterAll(() => {
  vi.resetAllMocks();
});

// Global test utilities
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
