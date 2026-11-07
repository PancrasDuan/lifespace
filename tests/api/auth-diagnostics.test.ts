import { describe, expect, it } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { authDiagnosticText, diagnoseAuthFailure, rememberAuthFailure } from '../../src/auth/diagnostics'

describe('authentication diagnostics privacy boundary', () => {
  it('keeps only known SDK fields, never error messages, causes or credentials', () => {
    const error = new AuthApiError('private-message', 400, 'invalid_credentials')
    Object.assign(error, { email: 'private@example.com', password: 'private-password', cause: { token: 'private-token' } })
    const diagnostic = diagnoseAuthFailure('password-sign-in', error)
    expect(diagnostic).toEqual({ stage: 'password-sign-in', kind: 'AuthApiError', status: 400, code: 'invalid_credentials' })
    expect(authDiagnosticText(diagnostic)).toBe('LSAUTH/1 stage=password-sign-in kind=AuthApiError status=400 code=invalid_credentials')
    expect(JSON.stringify(diagnostic)).not.toContain('private')
  })

  it('does not echo unknown name/code even when those fields contain secrets', () => {
    expect(diagnoseAuthFailure('password-recovery', {
      name: 'private@example.com', code: 'Bearer private-token', status: '500', message: 'private-password',
    })).toEqual({ stage: 'password-recovery', kind: 'unknown', status: null, code: 'unknown' })
  })

  it.each([0, -1, 600, 503.5, NaN, Infinity])('does not present %s as an HTTP response', status => {
    expect(diagnoseAuthFailure('session', { status }).status).toBeNull()
  })

  it('separates retryable transport failures from received HTTP errors', () => {
    expect(diagnoseAuthFailure('password-sign-in', new AuthRetryableFetchError('private', 0)))
      .toEqual({ stage: 'password-sign-in', kind: 'AuthRetryableFetchError', status: null, code: 'unknown' })
    expect(diagnoseAuthFailure('password-sign-in', new AuthRetryableFetchError('private', 503)).status).toBe(503)
  })

  it('preserves the deepest startup boundary across shared promises without mutating the error', () => {
    const error = Object.freeze(new TypeError('private'))
    rememberAuthFailure('config-fetch', error)
    rememberAuthFailure('client-create', error)
    expect(diagnoseAuthFailure('initialize', error)).toEqual({ stage: 'config-fetch', kind: 'TypeError', status: null, code: 'unknown' })
    expect(Object.keys(error)).toEqual([])
    expect(diagnoseAuthFailure('client-create', new TypeError('another')).stage).toBe('client-create')
  })

  it('keeps the HTTP response status for a parsing error, without retaining its body', () => {
    const error = new SyntaxError('private body')
    rememberAuthFailure('config-parse', error, 200)
    expect(diagnoseAuthFailure('client-create', error)).toEqual({ stage: 'config-parse', kind: 'SyntaxError', status: 200, code: 'unknown' })
  })

  it.each([undefined, null, 'private text', 42])('handles non-object thrown values without echoing them', error => {
    rememberAuthFailure('config-fetch', error)
    expect(diagnoseAuthFailure('initialize', error)).toEqual({ stage: 'initialize', kind: 'unknown', status: null, code: 'unknown' })
  })
})
