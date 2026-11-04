import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { SecretBox } from './secret-box.server'

const key = randomBytes(32).toString('base64')

describe('SecretBox', () => {
  it('round-trips a secret bound to AAD', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(sealed.ciphertext).not.toContain('app-secret-value')
    expect(box.open(sealed, 'connection:123')).toBe('app-secret-value')
  })

  it('rejects a secret opened with different AAD', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(() => box.open(sealed, 'connection:456')).toThrow()
  })

  it('rejects tampering', () => {
    const box = new SecretBox(key)
    const sealed = box.seal('app-secret-value', 'connection:123')

    expect(() =>
      box.open(
        { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}00` },
        'connection:123',
      ),
    ).toThrow()
  })

  it('rejects keys that are not 32 bytes', () => {
    expect(
      () => new SecretBox(Buffer.from('short').toString('base64')),
    ).toThrow(/32 bytes/)
  })
})
