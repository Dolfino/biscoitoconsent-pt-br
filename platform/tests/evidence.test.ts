import { describe, expect, it } from 'vitest';
import { canonicalJson, signEvidence, verifyEvidence } from '../src/evidence.js';

describe('evidência', () => {
  it('canonicaliza objetos independentemente da ordem das chaves', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('assina e detecta adulteração', () => {
    const signed = signEvidence({ consentId: 'abc', accepted: true }, 'segredo');
    expect(verifyEvidence(signed.payloadHash, signed.signature, 'segredo')).toBe(true);
    expect(verifyEvidence('0'.repeat(64), signed.signature, 'segredo')).toBe(false);
  });
});
