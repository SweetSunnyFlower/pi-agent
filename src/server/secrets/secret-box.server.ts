import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SealedSecret = {
  version: number
  algorithm: string
  iv: string
  tag: string
  ciphertext: string
}

const algorithm = 'aes-256-gcm'

export class SecretBox {
  readonly #key: Buffer

  constructor(kekBase64: string) {
    const key = Buffer.from(kekBase64, 'base64')
    if (key.length !== 32) {
      throw new Error('CHANNEL_SECRET_KEK must decode to exactly 32 bytes')
    }
    this.#key = key
  }

  seal(plaintext: string, aad: string): SealedSecret {
    const iv = randomBytes(12)
    const cipher = createCipheriv(algorithm, this.#key, iv)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])

    return {
      version: 1,
      algorithm,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  open(sealed: SealedSecret, aad: string): string {
    if (sealed.version !== 1 || sealed.algorithm !== algorithm) {
      throw new Error('Unsupported encrypted secret format')
    }

    try {
      const decipher = createDecipheriv(
        algorithm,
        this.#key,
        Buffer.from(sealed.iv, 'base64'),
      )
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw new Error('Secret decryption failed')
    }
  }
}
