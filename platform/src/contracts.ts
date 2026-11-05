import { z } from 'zod';

export const browserConsentSchema = z.object({
  eventId: z.uuid().optional(),
  consentId: z.string().min(8).max(200),
  categories: z.array(z.string().min(1).max(80)).min(1),
  services: z.record(z.string(), z.array(z.string())).default({}),
  revision: z.number().int().nonnegative(),
  consentTimestamp: z.iso.datetime(),
  lastConsentTimestamp: z.iso.datetime(),
  languageCode: z.string().min(2).max(20).default('pt-BR'),
  sdkVersion: z.string().max(40).default('legacy-adapter'),
  sourceUrl: z.url().max(2048).optional(),
  referrerOrigin: z.url().max(2048).optional(),
  clientTimeZone: z.string().min(1).max(80).optional()
});

const dispatchMetadataValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const integrationDispatchSchema = z.object({
  consentEventId: z.uuid(),
  consentId: z.string().min(8).max(200),
  provider: z.enum(['meta', 'google']),
  serviceKey: z.string().min(1).max(80),
  providerEventId: z.string().min(1).max(200),
  eventName: z.string().min(1).max(120),
  status: z.enum(['sent', 'failed', 'blocked']),
  transport: z.enum(['browser', 'server']).default('browser'),
  dispatchTimestamp: z.iso.datetime(),
  providerPayloadHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  metadata: z.record(z.string().max(80), dispatchMetadataValue).default({}),
  sdkVersion: z.string().min(1).max(40)
});

export type BrowserConsent = z.infer<typeof browserConsentSchema>;
export type IntegrationDispatch = z.infer<typeof integrationDispatchSchema>;
export type ConsentAction = 'accepted' | 'updated' | 'revoked';
export type SelectionMode = 'accepted_all' | 'rejected_optional' | 'customized';

export type CanonicalConsentEvent = {
  eventId: string;
  organizationId: string;
  siteId: string;
  consentId: string;
  action: ConsentAction;
  selectionMode: SelectionMode;
  policyRevision: number;
  acceptedCategories: string[];
  rejectedCategories: string[];
  acceptedServices: Record<string, string[]>;
  rejectedServices: Record<string, string[]>;
  languageCode: string;
  consentTimestamp: string;
  lastConsentTimestamp: string;
  receivedAt: string;
  sdkVersion: string;
  sourceUrl?: string;
  referrerOrigin?: string;
  clientTimeZone?: string;
};

export type CanonicalIntegrationDispatch = {
  dispatchId: string;
  organizationId: string;
  siteId: string;
  consentEventId: string;
  consentId: string;
  provider: 'meta' | 'google';
  serviceKey: string;
  providerEventId: string;
  eventName: string;
  status: 'sent' | 'failed' | 'blocked';
  transport: 'browser' | 'server';
  dispatchTimestamp: string;
  receivedAt: string;
  providerPayloadHash?: string;
  metadata: Record<string, string | number | boolean | null>;
  sdkVersion: string;
};
