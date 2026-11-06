import path from 'node:path';

export type AppConfig = {
  port: number;
  databasePath: string;
  databaseUrl?: string;
  hmacKey: string;
  hmacKeyId: string;
  adminToken: string;
  legacyAdminTokenEnabled: boolean;
  oidcIssuerUrl: string;
  oidcAudience: string;
  oidcAdminRoles: string[];
};

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config: AppConfig = {
    port: Number(process.env.PORT || 3333),
    databasePath: process.env.DATABASE_PATH || path.resolve('.data/consent-pg'),
    databaseUrl: process.env.DATABASE_URL || undefined,
    hmacKey: process.env.CONSENT_HMAC_KEY || 'local-development-key-change-me',
    hmacKeyId: process.env.CONSENT_HMAC_KEY_ID || 'local-v1',
    adminToken: process.env.ADMIN_TOKEN || 'centro-fashion-local-admin',
    legacyAdminTokenEnabled: process.env.LEGACY_ADMIN_TOKEN_ENABLED !== undefined
      ? process.env.LEGACY_ADMIN_TOKEN_ENABLED === 'true'
      : process.env.NODE_ENV !== 'production',
    oidcIssuerUrl: (process.env.OIDC_ISSUER_URL || '').replace(/\/$/, ''),
    oidcAudience: process.env.OIDC_AUDIENCE || 'consent-admin',
    oidcAdminRoles: (process.env.OIDC_ADMIN_ROLES || 'platform-superadmin,privacy-manager,analyst,operator')
      .split(',').map((role) => role.trim()).filter(Boolean),
    ...overrides
  };

  if (process.env.NODE_ENV === 'production') {
    const required = [
      ['DATABASE_URL', config.databaseUrl],
      ['CONSENT_HMAC_KEY', config.hmacKey],
      ['CONSENT_HMAC_KEY_ID', config.hmacKeyId],
      ['OIDC_ISSUER_URL', config.oidcIssuerUrl]
    ].filter(([, value]) => !value || String(value).includes('local-'));

    if (required.length) {
      throw new Error(`Configuração de produção ausente ou insegura: ${required.map(([name]) => name).join(', ')}`);
    }
  }

  return config;
}
