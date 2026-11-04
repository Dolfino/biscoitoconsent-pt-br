import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function signEvidence(payload: unknown, secret: string) {
  const canonicalPayload = canonicalJson(payload);
  const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex');
  const signature = createHmac('sha256', secret).update(payloadHash).digest('hex');
  return { canonicalPayload, payloadHash, signature };
}

export function verifyEvidence(payloadHash: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(payloadHash).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
