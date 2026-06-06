/**
 * Unit tests for the admin basic-auth helpers.
 *
 * The proxy itself is exercised in tests/proxy.test.ts; these tests
 * isolate the credential comparison so failure modes (missing env,
 * wrong creds, length-mismatch attacks) are easy to read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expectedBasicAuthHeader, isValidBasicAuth, adminUsername } from '@/lib/admin-auth';

const VALID_USER = 'adro';
const VALID_PASS = 'super-secret-password-1234';
const VALID_HEADER = `Basic ${Buffer.from(`${VALID_USER}:${VALID_PASS}`).toString('base64')}`;

describe('admin-auth', () => {
  const originalUsername = process.env.ADMIN_USERNAME;
  const originalPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_USERNAME = VALID_USER;
    process.env.ADMIN_PASSWORD = VALID_PASS;
  });
  afterEach(() => {
    process.env.ADMIN_USERNAME = originalUsername;
    process.env.ADMIN_PASSWORD = originalPassword;
  });

  describe('expectedBasicAuthHeader', () => {
    it('builds the Basic header from env creds', () => {
      expect(expectedBasicAuthHeader()).toBe(VALID_HEADER);
    });

    it('returns null when ADMIN_USERNAME is missing', () => {
      delete process.env.ADMIN_USERNAME;
      expect(expectedBasicAuthHeader()).toBeNull();
    });

    it('returns null when ADMIN_PASSWORD is missing', () => {
      delete process.env.ADMIN_PASSWORD;
      expect(expectedBasicAuthHeader()).toBeNull();
    });

    it('returns null when either env var is the empty string', () => {
      process.env.ADMIN_USERNAME = '';
      expect(expectedBasicAuthHeader()).toBeNull();
      process.env.ADMIN_USERNAME = VALID_USER;
      process.env.ADMIN_PASSWORD = '';
      expect(expectedBasicAuthHeader()).toBeNull();
    });
  });

  describe('isValidBasicAuth', () => {
    it('accepts the exact configured header', () => {
      expect(isValidBasicAuth(VALID_HEADER)).toBe(true);
    });

    it('rejects a header with the wrong password', () => {
      const wrong = `Basic ${Buffer.from(`${VALID_USER}:wrong`).toString('base64')}`;
      expect(isValidBasicAuth(wrong)).toBe(false);
    });

    it('rejects a header with the wrong username', () => {
      const wrong = `Basic ${Buffer.from(`other:${VALID_PASS}`).toString('base64')}`;
      expect(isValidBasicAuth(wrong)).toBe(false);
    });

    it('rejects null or undefined headers (browser sent no Authorization)', () => {
      expect(isValidBasicAuth(null)).toBe(false);
      expect(isValidBasicAuth(undefined)).toBe(false);
    });

    it('rejects when env vars are missing (fail-closed)', () => {
      delete process.env.ADMIN_USERNAME;
      expect(isValidBasicAuth(VALID_HEADER)).toBe(false);
    });

    it('rejects a header that is the wrong length without reaching timingSafeEqual', () => {
      // Shorter than expected — must not throw, must return false.
      expect(isValidBasicAuth('Basic short')).toBe(false);
      // Longer than expected.
      expect(isValidBasicAuth(`${VALID_HEADER}x`)).toBe(false);
    });

    it('rejects a Bearer-style header (wrong scheme)', () => {
      expect(isValidBasicAuth('Bearer abc')).toBe(false);
    });
  });

  describe('adminUsername', () => {
    it('returns the configured username', () => {
      expect(adminUsername()).toBe(VALID_USER);
    });

    it('returns null when not configured', () => {
      delete process.env.ADMIN_USERNAME;
      expect(adminUsername()).toBeNull();
    });
  });
});
