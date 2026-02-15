import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveKey,
  generateSalt,
  encryptPII,
  decryptPII,
  hashForIndex,
  encryptEventPII,
  decryptEventPII,
  verifyPrivacyKey,
  type EncryptedField,
} from '../src/crypto.js';

describe('crypto', () => {
  describe('deriveKey', () => {
    it('returns a 32-byte Buffer', () => {
      const password = 'test-password';
      const salt = 'test-salt';
      const key = deriveKey(password, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('is deterministic (same password + salt = same key)', () => {
      const password = 'my-secure-password';
      const salt = 'fixed-salt-value';

      const key1 = deriveKey(password, salt);
      const key2 = deriveKey(password, salt);

      expect(key1.equals(key2)).toBe(true);
    });

    it('produces different keys for different passwords', () => {
      const salt = 'same-salt';
      const key1 = deriveKey('password1', salt);
      const key2 = deriveKey('password2', salt);

      expect(key1.equals(key2)).toBe(false);
    });

    it('produces different keys for different salts', () => {
      const password = 'same-password';
      const key1 = deriveKey(password, 'salt1');
      const key2 = deriveKey(password, 'salt2');

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('generateSalt', () => {
    it('returns base64 string', () => {
      const salt = generateSalt();

      expect(typeof salt).toBe('string');
      // Base64 strings have specific character set
      expect(salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('generates different salts on each call', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      expect(salt1).not.toBe(salt2);
    });

    it('generates salts of reasonable length', () => {
      const salt = generateSalt();
      // 32 bytes in base64 is ~44 characters
      expect(salt.length).toBeGreaterThan(40);
    });
  });

  describe('encryptPII', () => {
    let key: Buffer;

    beforeEach(() => {
      key = deriveKey('test-password', 'test-salt');
    });

    it('encrypts and decrypts plaintext correctly (roundtrip)', () => {
      const plaintext = 'sensitive-email@example.com';
      const encrypted = encryptPII(plaintext, key);
      const decrypted = decryptPII(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('returns empty fields for empty string', () => {
      const encrypted = encryptPII('', key);

      expect(encrypted.ciphertext).toBe('');
      expect(encrypted.iv).toBe('');
      expect(encrypted.tag).toBe('');
    });

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'test@example.com';
      const encrypted1 = encryptPII(plaintext, key);
      const encrypted2 = encryptPII(plaintext, key);

      // Different IVs
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Different ciphertexts
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      // But both decrypt to same plaintext
      expect(decryptPII(encrypted1, key)).toBe(plaintext);
      expect(decryptPII(encrypted2, key)).toBe(plaintext);
    });

    it('returns ciphertext, iv, and tag as base64 strings', () => {
      const encrypted = encryptPII('test-data', key);

      expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encrypted.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encrypted.tag).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe('decryptPII', () => {
    let key: Buffer;

    beforeEach(() => {
      key = deriveKey('test-password', 'test-salt');
    });

    it('returns empty string for empty ciphertext', () => {
      const emptyEncrypted: EncryptedField = {
        ciphertext: '',
        iv: '',
        tag: '',
      };
      const decrypted = decryptPII(emptyEncrypted, key);

      expect(decrypted).toBe('');
    });

    it('throws error for wrong key (GCM auth tag mismatch)', () => {
      const plaintext = 'secret-data';
      const correctKey = deriveKey('correct-password', 'salt');
      const wrongKey = deriveKey('wrong-password', 'salt');

      const encrypted = encryptPII(plaintext, correctKey);

      expect(() => decryptPII(encrypted, wrongKey)).toThrow();
    });

    it('throws error for corrupted ciphertext', () => {
      const plaintext = 'test-data';
      const encrypted = encryptPII(plaintext, key);

      // Corrupt the ciphertext
      const corrupted = {
        ...encrypted,
        ciphertext: 'AAAAAAAAAA==', // Invalid ciphertext
      };

      expect(() => decryptPII(corrupted, key)).toThrow();
    });
  });

  describe('hashForIndex', () => {
    it('is deterministic', () => {
      const plaintext = 'test@example.com';
      const salt = 'test-salt';

      const hash1 = hashForIndex(plaintext, salt);
      const hash2 = hashForIndex(plaintext, salt);

      expect(hash1).toBe(hash2);
    });

    it('returns 16-char hex string', () => {
      const hash = hashForIndex('test-value', 'salt');

      expect(hash.length).toBe(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('returns empty for empty input', () => {
      const hash = hashForIndex('', 'salt');

      expect(hash).toBe('');
    });

    it('produces different hashes for different inputs', () => {
      const salt = 'same-salt';
      const hash1 = hashForIndex('value1', salt);
      const hash2 = hashForIndex('value2', salt);

      expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes for different salts', () => {
      const plaintext = 'same-value';
      const hash1 = hashForIndex(plaintext, 'salt1');
      const hash2 = hashForIndex(plaintext, 'salt2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('encryptEventPII', () => {
    let key: Buffer;
    const salt = 'test-salt';

    beforeEach(() => {
      key = deriveKey('test-password', salt);
    });

    it('removes plaintext PII fields and adds _encrypted, _iv, _tag, _hash', () => {
      const event = {
        type: 'tool_call',
        accountEmail: 'user@example.com',
        filePath: '/home/user/project/file.ts',
        toolName: 'Read',
      };

      const encrypted = encryptEventPII(event, key, salt);

      // Plaintext removed
      expect(encrypted.accountEmail).toBeUndefined();
      expect(encrypted.filePath).toBeUndefined();

      // Encrypted versions added
      expect(encrypted.accountEmail_encrypted).toBeDefined();
      expect(encrypted.accountEmail_iv).toBeDefined();
      expect(encrypted.accountEmail_tag).toBeDefined();
      expect(encrypted.accountEmail_hash).toBeDefined();

      expect(encrypted.filePath_encrypted).toBeDefined();
      expect(encrypted.filePath_iv).toBeDefined();
      expect(encrypted.filePath_tag).toBeDefined();
      expect(encrypted.filePath_hash).toBeDefined();

      // Non-PII fields unchanged
      expect(encrypted.type).toBe('tool_call');
      expect(encrypted.toolName).toBe('Read');
    });

    it('handles array PII fields (filesModified)', () => {
      const event = {
        type: 'session_end',
        filesModified: ['/home/user/file1.ts', '/home/user/file2.ts'],
      };

      const encrypted = encryptEventPII(event, key, salt);

      // Plaintext array removed
      expect(encrypted.filesModified).toBeUndefined();

      // Encrypted array added
      expect(Array.isArray(encrypted.filesModified_encrypted)).toBe(true);
      expect(Array.isArray(encrypted.filesModified_hashes)).toBe(true);

      const encryptedArray = encrypted.filesModified_encrypted as Array<{
        encrypted: string;
        iv: string;
        tag: string;
        hash: string;
      }>;

      expect(encryptedArray.length).toBe(2);
      expect(encryptedArray[0].encrypted).toBeDefined();
      expect(encryptedArray[0].iv).toBeDefined();
      expect(encryptedArray[0].tag).toBeDefined();
      expect(encryptedArray[0].hash).toBeDefined();
    });

    it('skips empty or missing PII fields', () => {
      const event = {
        type: 'tool_call',
        accountEmail: '',
        toolName: 'Bash',
      };

      const encrypted = encryptEventPII(event, key, salt);

      // Empty field not encrypted (but field is kept as empty string per implementation)
      expect(encrypted.accountEmail_encrypted).toBeUndefined();
      // encryptEventPII preserves empty strings in the result
      expect(encrypted.accountEmail).toBe('');
    });

    it('preserves non-PII fields', () => {
      const event = {
        type: 'tool_call',
        sessionId: 'session-123',
        timestamp: '2026-02-07T10:00:00Z',
        accountEmail: 'user@example.com',
        toolName: 'Read',
        inputTokens: 1000,
      };

      const encrypted = encryptEventPII(event, key, salt);

      expect(encrypted.type).toBe('tool_call');
      expect(encrypted.sessionId).toBe('session-123');
      expect(encrypted.timestamp).toBe('2026-02-07T10:00:00Z');
      expect(encrypted.toolName).toBe('Read');
      expect(encrypted.inputTokens).toBe(1000);
    });
  });

  describe('decryptEventPII', () => {
    let key: Buffer;
    const salt = 'test-salt';

    beforeEach(() => {
      key = deriveKey('test-password', salt);
    });

    it('roundtrips with encryptEventPII', () => {
      const originalEvent = {
        type: 'tool_call',
        accountEmail: 'user@example.com',
        gitEmail: 'git@example.com',
        filePath: '/home/user/file.ts',
        projectId: 'my-project',
        toolName: 'Read',
      };

      const encrypted = encryptEventPII(originalEvent, key, salt);
      const decrypted = decryptEventPII(encrypted, key);

      expect(decrypted.accountEmail).toBe('user@example.com');
      expect(decrypted.gitEmail).toBe('git@example.com');
      expect(decrypted.filePath).toBe('/home/user/file.ts');
      expect(decrypted.projectId).toBe('my-project');
      expect(decrypted.toolName).toBe('Read');

      // Encrypted fields removed
      expect(decrypted.accountEmail_encrypted).toBeUndefined();
      expect(decrypted.accountEmail_iv).toBeUndefined();
      expect(decrypted.accountEmail_tag).toBeUndefined();
      expect(decrypted.accountEmail_hash).toBeUndefined();
    });

    it('roundtrips array PII fields', () => {
      const originalEvent = {
        type: 'session_end',
        filesModified: ['/home/user/file1.ts', '/home/user/file2.ts'],
      };

      const encrypted = encryptEventPII(originalEvent, key, salt);
      const decrypted = decryptEventPII(encrypted, key);

      expect(decrypted.filesModified).toEqual([
        '/home/user/file1.ts',
        '/home/user/file2.ts',
      ]);

      // Encrypted fields removed
      expect(decrypted.filesModified_encrypted).toBeUndefined();
      expect(decrypted.filesModified_hashes).toBeUndefined();
    });

    it('returns "[decryption failed]" for wrong key', () => {
      const originalEvent = {
        type: 'tool_call',
        accountEmail: 'user@example.com',
      };

      const correctKey = deriveKey('correct-password', salt);
      const wrongKey = deriveKey('wrong-password', salt);

      const encrypted = encryptEventPII(originalEvent, correctKey, salt);
      const decrypted = decryptEventPII(encrypted, wrongKey);

      expect(decrypted.accountEmail).toBe('[decryption failed]');
    });

    it('handles missing encrypted fields gracefully', () => {
      const event = {
        type: 'tool_call',
        toolName: 'Read',
      };

      const decrypted = decryptEventPII(event, key);

      expect(decrypted.type).toBe('tool_call');
      expect(decrypted.toolName).toBe('Read');
    });
  });

  describe('verifyPrivacyKey', () => {
    it('returns true for correct key', () => {
      const plaintext = 'test-verification-value';
      const password = 'correct-password';
      const salt = 'test-salt';
      const key = deriveKey(password, salt);

      const encrypted = encryptPII(plaintext, key);
      const isValid = verifyPrivacyKey(encrypted, plaintext, key);

      expect(isValid).toBe(true);
    });

    it('returns false for wrong key', () => {
      const plaintext = 'test-verification-value';
      const correctPassword = 'correct-password';
      const wrongPassword = 'wrong-password';
      const salt = 'test-salt';

      const correctKey = deriveKey(correctPassword, salt);
      const wrongKey = deriveKey(wrongPassword, salt);

      const encrypted = encryptPII(plaintext, correctKey);
      const isValid = verifyPrivacyKey(encrypted, plaintext, wrongKey);

      expect(isValid).toBe(false);
    });

    it('returns false for wrong expected plaintext', () => {
      const actualPlaintext = 'actual-value';
      const wrongPlaintext = 'wrong-value';
      const key = deriveKey('password', 'salt');

      const encrypted = encryptPII(actualPlaintext, key);
      const isValid = verifyPrivacyKey(encrypted, wrongPlaintext, key);

      expect(isValid).toBe(false);
    });

    it('returns false for corrupted ciphertext', () => {
      const plaintext = 'test-value';
      const key = deriveKey('password', 'salt');

      const corrupted: EncryptedField = {
        ciphertext: 'invalid-base64',
        iv: 'invalid-base64',
        tag: 'invalid-base64',
      };

      const isValid = verifyPrivacyKey(corrupted, plaintext, key);

      expect(isValid).toBe(false);
    });
  });
});
