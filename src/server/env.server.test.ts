import { describe, expect, it } from 'vitest'

import {
  envFilesForNodeEnv,
  getServerEnv,
  parseServerEnv,
  resetServerEnvForTests,
} from './env.server'

const base = {
  NODE_ENV: 'development',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_MODE: 'development',
  DEV_AUTH_USERNAME: 'alice',
  APP_DATABASE_PATH: './data/test.sqlite',
  CHANNEL_SECRET_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  INFOFLOW_API_BASE_URL: 'https://apiin.im.baidu.com/api/v1',
  INFOFLOW_WS_GATEWAY: 'infoflow-open-gateway.weiyun.baidu.com',
  INFOFLOW_WS_CONNECT_DOMAIN: 'infoflow-open-gateway.weiyun.baidu.com:8869',
} as const

describe('parseServerEnv', () => {
  it('uses one environment file per runtime mode', () => {
    expect(envFilesForNodeEnv('development')).toEqual(['.env.local'])
    expect(envFilesForNodeEnv('test')).toEqual(['.env.local'])
    expect(envFilesForNodeEnv('production')).toEqual(['.env'])
  })

  it('accepts development authentication without gateway JWT settings', () => {
    const env = parseServerEnv(base)

    expect(env.AUTH_MODE).toBe('development')
    expect(env.DEV_AUTH_USERNAME).toBe('alice')
    expect(env).not.toHaveProperty('DEV_WORKSPACE_SLUG')
    expect(env.CHAT_MAX_IMAGES_PER_MESSAGE).toBe(10)
  })

  it('parses the chat image limit from the environment', () => {
    const env = parseServerEnv({
      ...base,
      CHAT_MAX_IMAGES_PER_MESSAGE: '6',
    })

    expect(env.CHAT_MAX_IMAGES_PER_MESSAGE).toBe(6)
  })

  it('requires gateway settings in gateway mode', () => {
    expect(() =>
      parseServerEnv({
        ...base,
        AUTH_MODE: 'gateway',
        DEV_AUTH_USERNAME: undefined,
      }),
    ).toThrow(/AUTH_JWT_SECRET/)
  })

  it('accepts gateway mode with only the JWT secret', () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      DEV_AUTH_USERNAME: undefined,
      AUTH_JWT_SECRET: 'zero-trust-secret',
    })

    expect(env.AUTH_MODE).toBe('gateway')
    expect(env.AUTH_JWT_ALGORITHM).toBe('HS256')
    expect(env).not.toHaveProperty('AUTH_JWT_ISSUER')
    expect(env).not.toHaveProperty('AUTH_JWT_AUDIENCE')
  })

  it('accepts gateway settings when all required fields are present', () => {
    const env = parseServerEnv({
      ...base,
      AUTH_MODE: 'gateway',
      AUTH_JWT_SECRET: 'a-long-development-only-secret',
      AUTH_JWT_ALGORITHM: 'HS256',
      AUTH_JWT_ISSUER: 'zero-trust-gateway',
      AUTH_JWT_AUDIENCE: 'multi-agent-platform',
    })

    expect(env.AUTH_MODE).toBe('gateway')
    expect(env.AUTH_JWT_ALGORITHM).toBe('HS256')
  })

  it('rejects development authentication in production', () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: 'production',
      }),
    ).toThrow(/development.*production/i)
  })

  it('does not require InfoFlow bot credentials', () => {
    const env = parseServerEnv(base)

    expect(env).not.toHaveProperty('INFOFLOW_APP_KEY')
    expect(env).not.toHaveProperty('INFOFLOW_APP_SECRET')
    expect(env).not.toHaveProperty('INFOFLOW_AGENT_ID')
  })

  it('parses the OpenAI-compatible model gateway configuration', () => {
    const env = parseServerEnv({
      ...base,
      AI_TOKEN: 'test-token',
      AI_BASE_URL: 'https://oneapi-comate.baidu-int.com/v1',
    })

    expect(env.AI_TOKEN).toBe('test-token')
    expect(env.AI_BASE_URL).toBe('https://oneapi-comate.baidu-int.com/v1')
    expect(env).not.toHaveProperty('AI_MODEL')
  })

  it('loads local development defaults from .env.local', () => {
    const managedKeys = [
      'AUTH_MODE',
      'DEV_AUTH_USERNAME',
      'APP_ORIGIN',
      'APP_DATABASE_PATH',
      'CHANNEL_SECRET_KEK',
    ] as const
    const previous = new Map(
      managedKeys.map((key) => [key, process.env[key]] as const),
    )

    try {
      for (const key of managedKeys) delete process.env[key]
      resetServerEnvForTests()
      const env = getServerEnv()

      expect(env.AUTH_MODE).toBe('development')
      expect(env.DEV_AUTH_USERNAME).toBeTruthy()
      expect(env.APP_DATABASE_PATH).toBeTruthy()
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      resetServerEnvForTests()
    }
  })
})
