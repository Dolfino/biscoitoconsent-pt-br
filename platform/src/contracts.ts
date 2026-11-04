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
  sdkVersion: z.string().max(40).default('legacy-adapter')
});

export type BrowserConsent = z.infer<typeof browserConsentSchema>;
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
};
