import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238 / HOTP RFC 4226) com node:crypto — sem SDK, sem serviço externo.
 * Compatível com Google Authenticator, Authy, 1Password, etc. Base: HMAC-SHA1,
 * passo de 30s, 6 dígitos, janela ±1 para tolerar relógio dessincronizado.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32 (RFC 4648)

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue; // ignora padding/espaços/chars inválidos
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret novo (20 bytes aleatórios) em base32, para o app autenticador. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP de um contador (RFC 4226) — dynamic truncation → `digits` dígitos. */
function hotp(secretBytes: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/** Código TOTP vigente para um instante (`now` em ms). */
export function totpCode(secretB32: string, now: number, step = 30, digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(now / 1000 / step), digits);
}

/**
 * Verifica um código de 6 dígitos numa janela ±`window` passos (skew de relógio).
 * Comparação em tempo constante. Código malformado ⇒ false.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  now: number,
  window = 1,
  step = 30,
  digits = 6,
): boolean {
  const clean = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false;
  const secretBytes = base32Decode(secretB32);
  const counter = Math.floor(now / 1000 / step);
  const given = Buffer.from(clean);
  for (let w = -window; w <= window; w += 1) {
    const expected = Buffer.from(hotp(secretBytes, counter + w, digits));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

/** URI otpauth:// para QR/chave manual no app autenticador. */
export function totpAuthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
