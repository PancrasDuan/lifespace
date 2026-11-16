import type { AuthEnv } from '../../worker/auth'

const authAllowedEmailsKey = 'AUTH_ALLOWED_EMAILS'

// Local KV stand-in: each request reads the current value, and tests can change it or force failures.
export class AuthTestKv {
  value: string | null
  failReads = false
  reads = 0

  constructor(value: string | null = null) {
    this.value = value
  }

  async get(key: string) {
    this.reads++
    if (this.failReads) throw new Error('synthetic KV failure')
    return key === authAllowedEmailsKey ? this.value : null
  }

  binding() {
    return this as unknown as KVNamespace
  }
}

export function authEnv<T extends Partial<CloudflareEnv>>(emails: string | string[], extra: T): T & AuthEnv & { AUTH_KV: KVNamespace } {
  const value = Array.isArray(emails) ? emails.join(',') : emails
  return { ...extra, AUTH_KV: new AuthTestKv(value).binding() }
}

export function failingKv(value: string) {
  const kv = new AuthTestKv(value)
  kv.failReads = true
  return kv.binding()
}
