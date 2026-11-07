export type AuthFailureStage =
  | 'config-fetch' | 'config-response' | 'config-parse' | 'client-create'
  | 'initialize' | 'session' | 'identity-request' | 'identity-response'
  | 'identity-parse' | 'identity-mismatch' | 'password-sign-in' | 'password-recovery'

const kinds = new Set([
  'Error', 'TypeError', 'SyntaxError', 'SecurityError', 'QuotaExceededError',
  'TimeoutError', 'AbortError', 'ZodError', 'AuthApiError', 'AuthUnknownError',
  'AuthRetryableFetchError', 'AuthSessionMissingError', 'AuthRefreshDiscardedError',
  'AuthInvalidTokenResponseError', 'AuthSessionChangedError',
])
const codes = new Set([
  'invalid_credentials', 'email_not_confirmed', 'unexpected_failure',
  'request_timeout', 'over_request_rate_limit', 'over_email_send_rate_limit',
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
  'bad_jwt', 'user_banned', 'email_provider_disabled', 'signup_disabled',
  'captcha_failed', 'validation_failed',
])

export type AuthDiagnostic = Readonly<{
  stage: AuthFailureStage
  kind: string
  status: number | null
  code: string
}>

// Keep only bounded classifications in memory. Never retain messages, causes or requests.
const failures = new WeakMap<object, AuthDiagnostic>()
export function diagnoseAuthFailure(stage: AuthFailureStage, error?: unknown, status?: number): AuthDiagnostic {
  if (typeof error === 'object' && error !== null) {
    const recorded = failures.get(error)
    if (recorded) return recorded
  }
  const fields = typeof error === 'object' && error !== null
    ? error as { name?: unknown; status?: unknown; code?: unknown }
    : undefined
  const httpStatus = status ?? fields?.status
  return {
    stage,
    kind: typeof fields?.name === 'string' && kinds.has(fields.name) ? fields.name : 'unknown',
    // SDK status 0 is a transport failure, not an HTTP response.
    status: typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    code: typeof fields?.code === 'string' && codes.has(fields.code) ? fields.code : 'unknown',
  }
}

// Preserve the original thrown value and auth control flow across shared startup promises.
export function rememberAuthFailure(stage: AuthFailureStage, error: unknown, status?: number) {
  if (typeof error === 'object' && error !== null)
    failures.set(error, diagnoseAuthFailure(stage, error, status))
}

export function authDiagnosticText(diagnostic: AuthDiagnostic) {
  return `LSAUTH/1 stage=${diagnostic.stage} kind=${diagnostic.kind} status=${diagnostic.status ?? 'none'} code=${diagnostic.code}`
}
