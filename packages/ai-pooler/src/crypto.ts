/**
 * Client-side encryption for PII (Zero-Knowledge Architecture)
 *
 * All PII (emails, usernames, file paths) is encrypted on the client
 * before being sent to Rulecatch API. We never see plaintext PII.
 *
 * The user's privacy key is derived from their password or a separate
 * key they set during setup. Without this key, the data is unreadable.
 */

import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedField {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded authentication tag (GCM) */
  tag: string;
}

export interface PrivacyConfig {
  /** User's privacy key (password-derived or standalone) */
  privacyKey: string;
  /** Salt for key derivation (stored with user account, not secret) */
  salt: string;
}

/**
 * Derive an encryption key from a password/passphrase
 * Uses PBKDF2 with 100k iterations for brute-force resistance
 */
export function deriveKey(password: string, salt: string): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Generate a random salt for new users
 */
export function generateSalt(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Encrypt a PII field (email, username, file path, etc.)
 * Returns ciphertext + IV + auth tag for storage
 */
export function encryptPII(plaintext: string, key: Buffer): EncryptedField {
  if (!plaintext) {
    return { ciphertext: '', iv: '', tag: '' };
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt a PII field
 * Used client-side in the dashboard to show actual values
 */
export function decryptPII(encrypted: EncryptedField, key: Buffer): string {
  if (!encrypted.ciphertext) {
    return '';
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encrypted.iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Create a one-way hash for indexing/grouping
 * Cannot be reversed, but same input = same hash (for deduplication)
 *
 * We use a truncated hash (16 chars) to prevent rainbow table attacks
 * while still allowing grouping by the same identifier.
 */
export function hashForIndex(plaintext: string, salt: string): string {
  if (!plaintext) {
    return '';
  }
  return createHash('sha256')
    .update(plaintext + salt)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Encrypt all PII fields in an event payload
 * Non-PII fields are passed through unchanged
 */
export function encryptEventPII(
  event: Record<string, unknown>,
  key: Buffer,
  salt: string
): Record<string, unknown> {
  const piiFields = [
    'accountEmail',
    'gitEmail',
    'gitUsername',
    'filePath',
    'cwd',
    'projectId',
  ];

  const arrayPiiFields = ['filesModified'];

  const result: Record<string, unknown> = { ...event };

  // Encrypt single PII fields
  for (const field of piiFields) {
    const value = event[field];
    if (typeof value === 'string' && value) {
      const encrypted = encryptPII(value, key);
      result[`${field}_encrypted`] = encrypted.ciphertext;
      result[`${field}_iv`] = encrypted.iv;
      result[`${field}_tag`] = encrypted.tag;
      result[`${field}_hash`] = hashForIndex(value, salt);
      delete result[field]; // Remove plaintext
    }
  }

  // Encrypt array PII fields
  for (const field of arrayPiiFields) {
    const value = event[field];
    if (Array.isArray(value)) {
      const encryptedArray = value.map((item) => {
        if (typeof item === 'string') {
          const encrypted = encryptPII(item, key);
          return {
            encrypted: encrypted.ciphertext,
            iv: encrypted.iv,
            tag: encrypted.tag,
            hash: hashForIndex(item, salt),
          };
        }
        return item;
      });
      result[`${field}_encrypted`] = encryptedArray;
      result[`${field}_hashes`] = value.map((item) =>
        typeof item === 'string' ? hashForIndex(item, salt) : ''
      );
      delete result[field]; // Remove plaintext
    }
  }

  return result;
}

/**
 * Decrypt all PII fields in an event payload
 * Used in the dashboard to display actual values
 */
export function decryptEventPII(
  event: Record<string, unknown>,
  key: Buffer
): Record<string, unknown> {
  const piiFields = [
    'accountEmail',
    'gitEmail',
    'gitUsername',
    'filePath',
    'cwd',
    'projectId',
  ];

  const arrayPiiFields = ['filesModified'];

  const result: Record<string, unknown> = { ...event };

  // Decrypt single PII fields
  for (const field of piiFields) {
    const ciphertext = event[`${field}_encrypted`];
    const iv = event[`${field}_iv`];
    const tag = event[`${field}_tag`];

    if (
      typeof ciphertext === 'string' &&
      typeof iv === 'string' &&
      typeof tag === 'string'
    ) {
      try {
        result[field] = decryptPII({ ciphertext, iv, tag }, key);
      } catch {
        result[field] = '[decryption failed]';
      }
      // Clean up encrypted fields
      delete result[`${field}_encrypted`];
      delete result[`${field}_iv`];
      delete result[`${field}_tag`];
      delete result[`${field}_hash`];
    }
  }

  // Decrypt array PII fields
  for (const field of arrayPiiFields) {
    const encryptedArray = event[`${field}_encrypted`];
    if (Array.isArray(encryptedArray)) {
      result[field] = encryptedArray.map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          'encrypted' in item &&
          'iv' in item &&
          'tag' in item
        ) {
          try {
            return decryptPII(
              {
                ciphertext: item.encrypted as string,
                iv: item.iv as string,
                tag: item.tag as string,
              },
              key
            );
          } catch {
            return '[decryption failed]';
          }
        }
        return item;
      });
      delete result[`${field}_encrypted`];
      delete result[`${field}_hashes`];
    }
  }

  return result;
}

/**
 * Verify a privacy key is correct by attempting to decrypt a test value
 */
export function verifyPrivacyKey(
  testCiphertext: EncryptedField,
  expectedPlaintext: string,
  key: Buffer
): boolean {
  try {
    const decrypted = decryptPII(testCiphertext, key);
    return decrypted === expectedPlaintext;
  } catch {
    return false;
  }
}
