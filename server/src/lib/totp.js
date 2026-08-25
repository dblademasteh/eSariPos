import crypto from 'node:crypto';

// Minimal RFC 6238 TOTP (30s step, SHA-1, 6 digits, ±1 step tolerance).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret() {
  const bits = [...crypto.randomBytes(10)]
    .map((b) => b.toString(2).padStart(8, '0'))
    .join('');
  return Array.from(
    { length: Math.ceil(bits.length / 5) },
    (_, i) => B32[parseInt(bits.slice(i * 5, i * 5 + 5).padEnd(5, '0'), 2)]
  ).join('');
}

function b32decode(secret) {
  let bits = '';
  for (const ch of secret.toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpCode(secret, offsetSteps = 0) {
  const key = b32decode(secret);
  const step = Math.floor(Date.now() / 30_000) + offsetSteps;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[off] & 0x7f) << 24) |
      (hmac[off + 1] << 16) |
      (hmac[off + 2] << 8) |
      hmac[off + 3]) %
    1_000_000;
  return String(code).padStart(6, '0');
}

export function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(code ?? '')) return false;
  return [-1, 0, 1].some((o) => totpCode(secret, o) === code);
}
