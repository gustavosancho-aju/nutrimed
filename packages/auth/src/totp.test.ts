import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  totpAuthUri,
} from './totp';

// Vetor RFC 6238 (SHA1): secret ASCII "12345678901234567890", T=59s.
// O 8-dígitos é 94287082 ⇒ 6-dígitos = 287082.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('base32 encode/decode é reversível', () => {
    const b = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it('reproduz o vetor da RFC (T=59 ⇒ 287082)', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(verifyTotp(RFC_SECRET, '287082', 59_000)).toBe(true);
  });

  it('código gerado agora verifica; código errado falha', () => {
    const secret = generateTotpSecret();
    const now = 1_752_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });

  it('janela ±1 tolera skew de relógio (±30s)', () => {
    const secret = generateTotpSecret();
    const now = 1_752_000_000_000;
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true); // 1 passo à frente
    expect(verifyTotp(secret, code, now - 30_000)).toBe(true); // 1 passo atrás
    expect(verifyTotp(secret, code, now + 120_000)).toBe(false); // 4 passos ⇒ fora
  });

  it('código malformado ⇒ false (sem lançar)', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abc', 1)).toBe(false);
    expect(verifyTotp(secret, '12345', 1)).toBe(false);
    expect(verifyTotp(secret, '', 1)).toBe(false);
  });

  it('otpauth URI carrega secret e issuer', () => {
    const uri = totpAuthUri('ABC234', 'medico@x.test', 'NutriMed');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=ABC234');
    expect(uri).toContain('issuer=NutriMed');
  });
});
