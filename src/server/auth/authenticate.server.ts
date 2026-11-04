import { jwtVerify } from 'jose'

import type { ServerEnv } from '#/server/env.server'

import type { Identity } from './types.server'

const headerName = 'x-zt-authorization'
const developmentSessionMs = 24 * 60 * 60 * 1000

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

async function authenticateGateway(
  headers: Headers,
  env: ServerEnv,
): Promise<Identity | null> {
  const token = headers.get(headerName)
  if (!token || !env.AUTH_JWT_SECRET) {
    return null
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.AUTH_JWT_SECRET),
      {
        algorithms: [env.AUTH_JWT_ALGORITHM],
        requiredClaims: ['exp', 'username'],
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
      },
    )
    const username = stringClaim(payload.username)
    if (!username || typeof payload.exp !== 'number') {
      return null
    }

    return {
      username,
      name: stringClaim(payload.name),
      email: stringClaim(payload.email),
      expiresAt: payload.exp * 1000,
      authMode: 'gateway',
    }
  } catch {
    return null
  }
}

function authenticateDevelopment(env: ServerEnv, now: number): Identity | null {
  if (!env.DEV_AUTH_USERNAME) return null

  return {
    username: env.DEV_AUTH_USERNAME,
    name: null,
    email: null,
    expiresAt: now + developmentSessionMs,
    authMode: 'development',
  }
}

export async function authenticateRequest(
  headers: Headers,
  env: ServerEnv,
  now = Date.now(),
): Promise<Identity | null> {
  if (env.AUTH_MODE === 'development') {
    return authenticateDevelopment(env, now)
  }

  return authenticateGateway(headers, env)
}
