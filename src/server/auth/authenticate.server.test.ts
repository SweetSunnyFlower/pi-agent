import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { parseServerEnv } from '#/server/env.server'

import { authenticateRequest } from './authenticate.server'

const base = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: './data/test.sqlite',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
} as const

describe('authenticateRequest', () => {
  it('returns the configured development identity', async () => {
    const identity = await authenticateRequest(
      new Headers(),
      parseServerEnv(base),
      1_000,
    )

    expect(identity?.username).toBe('alice')
    expect(identity?.authMode).toBe('development')
  })

  it('verifies a gateway JWT and reads username', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
      AUTH_JWT_ISSUER: 'zero-trust-gateway',
      AUTH_JWT_AUDIENCE: 'multi-agent-platform',
    })
    const token = await new SignJWT({
      username: 'bob',
      name: 'Bob',
      email: 'bob@example.com',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('zero-trust-gateway')
      .setAudience('multi-agent-platform')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(env.AUTH_JWT_SECRET))

    const identity = await authenticateRequest(
      new Headers({ 'x-zt-authorization': token }),
      env,
    )

    expect(identity?.username).toBe('bob')
    expect(identity?.authMode).toBe('gateway')
  })

  it('rejects a gateway request without a JWT', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
    })

    await expect(authenticateRequest(new Headers(), env)).resolves.toBeNull()
  })

  it('rejects a JWT signed with another secret', async () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'expected-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
    })
    const token = await new SignJWT({ username: 'mallory' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('different-secret'))

    await expect(
      authenticateRequest(new Headers({ 'x-zt-authorization': token }), env),
    ).resolves.toBeNull()
  })
})
