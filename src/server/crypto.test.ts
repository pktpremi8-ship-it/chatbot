import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  maskApiKey,
  verifyPassword,
} from './crypto.ts';

test('hashPassword and verifyPassword validate matching passwords and reject wrong ones', () => {
  const hash = hashPassword('StrongPass2026!');
  assert.equal(verifyPassword('StrongPass2026!', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);
});

test('encryptSecret and decryptSecret round-trip API keys without exposing plaintext', () => {
  const secret = 'AIzaSyDemoSecretKeyValue123456';
  const encrypted = encryptSecret(secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptSecret(encrypted), secret);
});

test('maskApiKey keeps prefix and suffix only', () => {
  assert.equal(maskApiKey('AIzaSy1234567890ABCD'), 'AIza••••ABCD');
  assert.equal(maskApiKey('short'), '••••••••');
});

test('session token hashing is deterministic', () => {
  const token = generateSessionToken();
  assert.equal(token.length, 64);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
});
