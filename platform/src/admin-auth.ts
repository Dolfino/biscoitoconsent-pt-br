import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppConfig } from './config.js';

function constantTimeTokenMatch(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAdminAuthorizer(config: AppConfig) {
  const jwks = config.oidcIssuerUrl
    ? createRemoteJWKSet(new URL(`${config.oidcIssuerUrl}/protocol/openid-connect/certs`))
    : undefined;
  const allowedRoles = new Set(config.oidcAdminRoles);

  return async (authorization: string | undefined) => {
    if (!authorization?.startsWith('Bearer ')) return false;
    const token = authorization.slice('Bearer '.length);
    if (config.legacyAdminTokenEnabled && constantTimeTokenMatch(token, config.adminToken)) return true;
    if (!jwks) return false;

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuerUrl,
        audience: config.oidcAudience,
        algorithms: ['RS256']
      });
      const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
      const roles = Array.isArray(realmAccess?.roles)
        ? realmAccess.roles.filter((role): role is string => typeof role === 'string')
        : [];
      return roles.some((role) => allowedRoles.has(role));
    } catch {
      return false;
    }
  };
}
