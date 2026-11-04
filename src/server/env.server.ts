import { config } from 'dotenv'
import { z } from 'zod'

import {
  DEFAULT_CHAT_MAX_IMAGES_PER_MESSAGE,
  MAX_CHAT_MAX_IMAGES_PER_MESSAGE,
} from '#/lib/chat/limits'

const jwtAlgorithms = ['HS256', 'HS384', 'HS512'] as const

const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_ORIGIN: z.string().url(),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
    AUTH_MODE: z.enum(['gateway', 'development']),
    DEV_AUTH_USERNAME: z.string().trim().min(1).optional(),
    AUTH_JWT_SECRET: z.string().min(1).optional(),
    AUTH_JWT_ALGORITHM: z.enum(jwtAlgorithms).default('HS256'),
    AUTH_JWT_ISSUER: z.string().trim().min(1).optional(),
    AUTH_JWT_AUDIENCE: z.string().trim().min(1).optional(),
    OPEN_API_JWT_SECRET: z.string().min(32).optional(),
    APP_DATABASE_PATH: z.string().trim().min(1),
    APP_SKILLS_PATH: z.string().trim().min(1).default('./data/skills'),
    CHANNEL_SECRET_KEK: z.string().trim().min(1),
    CHAT_MAX_IMAGES_PER_MESSAGE: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CHAT_MAX_IMAGES_PER_MESSAGE)
      .default(DEFAULT_CHAT_MAX_IMAGES_PER_MESSAGE),
    AI_TOKEN: z.string().trim().min(1).optional(),
    AI_BASE_URL: z.string().url().optional(),
    INFOFLOW_API_BASE_URL: z
      .string()
      .url()
      .default('https://apiin.im.baidu.com/api/v1'),
    INFOFLOW_WS_GATEWAY: z
      .string()
      .trim()
      .min(1)
      .default('infoflow-open-gateway.weiyun.baidu.com'),
    INFOFLOW_WS_CONNECT_DOMAIN: z
      .string()
      .trim()
      .min(1)
      .default('infoflow-open-gateway.weiyun.baidu.com:8869'),
  })
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === 'development' && value.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'development authentication is forbidden in production',
      })
    }

    if (value.AUTH_MODE === 'development') {
      if (!value.DEV_AUTH_USERNAME) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_AUTH_USERNAME'],
          message: 'DEV_AUTH_USERNAME is required in development mode',
        })
      }
    }

    if (value.AUTH_MODE === 'gateway') {
      if (!value.AUTH_JWT_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWT_SECRET'],
          message: 'AUTH_JWT_SECRET is required in gateway mode',
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  return serverEnvSchema.parse(source)
}

let cachedEnv: ServerEnv | undefined
let loadedEnvFiles = false

export function envFilesForNodeEnv(nodeEnv = process.env.NODE_ENV): string[] {
  return nodeEnv === 'production' ? ['.env'] : ['.env.local']
}

function loadEnvFiles(): void {
  if (loadedEnvFiles) return
  loadedEnvFiles = true
  config({ path: envFilesForNodeEnv(), override: false })
}

export function getServerEnv(): ServerEnv {
  loadEnvFiles()
  cachedEnv ??= parseServerEnv(process.env)
  return cachedEnv
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined
}
