import crypto from 'node:crypto';

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const digest = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, saltHex, expectedHex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{64}$/i.test(expectedHex || '')) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}
