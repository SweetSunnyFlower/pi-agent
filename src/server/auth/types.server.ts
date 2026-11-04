export type AuthMode = 'gateway' | 'development'

export type Identity = {
  username: string
  name: string | null
  email: string | null
  expiresAt: number
  authMode: AuthMode
}
