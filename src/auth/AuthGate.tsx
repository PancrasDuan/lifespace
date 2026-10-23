import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react'
import { Eye, EyeOff, Clock, Sun, Leaf } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  authClient,
  currentSession,
  temporarilyUnavailable,
  isRecoveryFlow,
  sessionIdentifier,
  resetPendingKey,
  authMarker,
  saveAuthMarker,
} from './client'
import './auth.css'
import { AccountMenu } from './AccountMenu'
import { VerifiedIdentityContext } from './identity'
import { ResetPasswordForm } from './ResetPasswordForm'
import { HomeSkeleton } from './HomeSkeleton'

const identitySchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email() }),
})
type GateState =
  | {
      kind:
        | 'checking'
        | 'login'
        | 'unavailable'
        | 'denied'
        | 'callbackFailed'
        | 'callbackNeedsLogin'
    }
  | { kind: 'allowed'; email: string; id: string; sessionId?: string }

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' })
  const [accountEmail, setAccountEmail] = useState<string>()
  const queries = useQueryClient()
  const verified = useRef<
    { ownerId: string; controller: AbortController } | undefined
  >(undefined)
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let generation = 0
    let identityRequest:
      | {
          token: string
          controller: AbortController
          promise: Promise<Response>
        }
      | undefined
    const cancelIdentity = () => {
      identityRequest?.controller.abort()
      identityRequest = undefined
    }
    const verify = (token: string) => {
      if (identityRequest?.token === token) return identityRequest.promise
      cancelIdentity()
      const controller = new AbortController()
      const request: NonNullable<typeof identityRequest> = {
        token,
        controller,
        promise: fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        }).finally(() => {
          if (identityRequest === request) identityRequest = undefined
        }),
      }
      identityRequest = request
      return request.promise
    }
    const revokePage = () => {
      verified.current?.controller.abort()
      verified.current = undefined
      queries.clear()
      setState({ kind: 'checking' })
    }
    const check = async () => {
      const current = ++generation
      try {
        const client = await authClient()
        const initialized = await client.auth.initialize()
        const params = new URL(window.location.href).searchParams
        // Callback feedback is only used when no session passes the Worker gate.
        const callbackState: GateState | undefined =
          window.location.pathname === '/auth/callback'
            ? initialized.error || params.has('error')
              ? { kind: 'callbackFailed' }
              : params.has('code')
                ? { kind: 'callbackNeedsLogin' }
                : undefined
            : undefined
        const { data, error } = await currentSession()
        if (disposed || current !== generation) return
        if (temporarilyUnavailable(error)) {
          queries.clear()
          setState({ kind: 'unavailable' })
          return
        }
        if (error || !data.session) {
          queries.clear()
          setAccountEmail(undefined)
          setState(callbackState ?? { kind: 'login' })
          return
        }
        if (
          verified.current &&
          verified.current.ownerId !== data.session.user.id
        )
          revokePage()
        setAccountEmail(data.session.user.email)
        const response = await verify(data.session.access_token)
        if (disposed || current !== generation) return
        if (response.ok) {
          const identity = identitySchema.parse(await response.json())
          if (identity.user.id !== data.session.user.id) {
            revokePage()
            setState({ kind: 'unavailable' })
            return
          }
          if (!disposed && current === generation) {
            const pending = authMarker(resetPendingKey)
            if (pending && pending !== identity.user.id)
              saveAuthMarker(resetPendingKey)
            if (
              pending === identity.user.id &&
              window.location.pathname !== '/auth/reset'
            ) {
              window.history.replaceState(null, '', '/auth/reset')
              window.dispatchEvent(new PopStateEvent('popstate'))
            } else if (window.location.pathname === '/auth/callback') {
              window.history.replaceState(null, '', '/')
              window.dispatchEvent(new PopStateEvent('popstate'))
            }
            if (
              !verified.current ||
              verified.current.ownerId !== identity.user.id ||
              verified.current.controller.signal.aborted
            )
              verified.current = {
                ownerId: identity.user.id,
                controller: new AbortController(),
              }
            setState({
              kind: 'allowed',
              email: identity.user.email,
              id: identity.user.id,
              sessionId: sessionIdentifier(data.session),
            })
          }
        } else {
          queries.clear()
          setState({
            kind:
              response.status === 403
                ? 'denied'
                : response.status === 401
                  ? (callbackState?.kind ?? 'login')
                  : 'unavailable',
          })
        }
      } catch {
        if (!disposed && current === generation) {
          queries.clear()
          setState({ kind: 'unavailable' })
        }
      }
    }
    void authClient()
      .then((client) => {
        if (disposed) return
        const { data } = client.auth.onAuthStateChange((event, session) => {
          if (
            event === 'SIGNED_OUT' ||
            (identityRequest && identityRequest.token !== session?.access_token)
          ) {
            generation++
            cancelIdentity()
          }
          if (
            verified.current &&
            (!session || verified.current.ownerId !== session.user.id)
          ) {
            generation++
            cancelIdentity()
            revokePage()
          }
          if (event === 'SIGNED_OUT') {
            verified.current?.controller.abort()
            verified.current = undefined
            queries.clear()
            setAccountEmail(undefined)
            setState({ kind: 'login' })
          }
          window.setTimeout(() => {
            if (!disposed) void check()
          }, 0)
        })
        unsubscribe = () => data.subscription.unsubscribe()
      })
      .catch(() => {
        if (!disposed) setState({ kind: 'unavailable' })
      })
    void check()
    const focus = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const sessionChanged = () => {
      generation++
      cancelIdentity()
      revokePage()
      void check()
    }
    window.addEventListener('lifespace-auth-session-changed', sessionChanged)
    const rejected = (event: Event) => {
      generation++
      cancelIdentity()
      verified.current?.controller.abort()
      verified.current = undefined
      queries.clear()
      const status = (event as CustomEvent<number>).detail
      setState({
        kind:
          status === 403 ? 'denied' : status === 401 ? 'login' : 'unavailable',
      })
    }
    window.addEventListener('lifespace-auth-rejected', rejected)
    return () => {
      disposed = true
      verified.current?.controller.abort()
      verified.current = undefined
      window.removeEventListener(
        'lifespace-auth-session-changed',
        sessionChanged,
      )
      generation++
      cancelIdentity()
      unsubscribe?.()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('lifespace-auth-rejected', rejected)
    }
  }, [queries])
  if (window.location.pathname === '/auth/reset')
    return (
      <>
        <AccountMenu email={accountEmail} />
        <AuthLayout>
          <ResetPasswordForm
            authorized={
              state.kind === 'allowed' && isRecoveryFlow(state.sessionId)
            }
            checking={state.kind === 'checking'}
            accountId={state.kind === 'allowed' ? state.id : undefined}
          />
        </AuthLayout>
      </>
    )
  if (
    state.kind === 'checking' ||
    (state.kind === 'allowed' &&
      (!verified.current || verified.current.ownerId !== state.id))
  )
    return <HomeSkeleton />
  if (state.kind === 'allowed')
    return (
      <>
        <AccountMenu email={state.email} />
        <VerifiedIdentityContext
          value={{
            ownerId: state.id,
            signal: verified.current!.controller.signal,
          }}
        >
          <Fragment key={state.id}>{children}</Fragment>
        </VerifiedIdentityContext>
      </>
    )
  const callbackNeedsLogin = state.kind === 'callbackNeedsLogin'
  const callbackMessage = callbackNeedsLogin || state.kind === 'callbackFailed'
  return (
    <>
      <AccountMenu email={accountEmail} />
      <AuthLayout>
        {state.kind === 'login' ? (
          <LoginForm />
        ) : (
          <div className="auth-center">
            <h1>
              {state.kind === 'denied'
                ? '暂时无法进入'
                : callbackNeedsLogin
                  ? '请登录继续访问'
                  : state.kind === 'callbackFailed'
                    ? '验证链接不可用'
                    : '暂时无法连接'}
            </h1>
            <p>
              {state.kind === 'denied'
                ? '此账户暂未获准访问 LifeSpace。'
                : callbackNeedsLogin
                  ? '当前浏览器缺少自动登录所需的校验凭据。邮箱可能已验证，请使用邮箱和密码登录。'
                  : state.kind === 'callbackFailed'
                    ? '链接可能已过期或已使用。请返回登录页重新操作。'
                    : '认证服务暂时不可用，请稍后重试。'}
            </p>
            {
              <button
                className="auth-primary"
                onClick={() =>
                  callbackMessage
                    ? window.location.assign('/')
                    : window.location.reload()
                }
              >
                {callbackNeedsLogin
                  ? '使用邮箱密码登录'
                  : state.kind === 'callbackFailed'
                    ? '返回登录'
                    : '重试'}
              </button>
            }
          </div>
        )}
      </AuthLayout>
    </>
  )
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-screen">
      <div className="auth-columns">
        <section className="auth-story">
          <div className="auth-wordmark">
            Life<span>Space</span>.
          </div>
          <p className="auth-caption">把今天放在眼前</p>
          <h2>
            每天的小事，
            <br />
            都有归处。
          </h2>
          <p>
            时间、天气、信息与待办。
            <br />
            把日常放在一起，让今天更从容。
          </p>
          <div className="auth-tiles">
            <div>
              <Clock />
              留一点时间给自己
            </div>
            <div>
              <Sun />
              打开今天的好天气
            </div>
            <div>
              <Leaf />
              让日常慢慢有序
            </div>
          </div>
          <p className="auth-footer">LifeSpace · 你的每日工作台</p>
        </section>
        <section className="auth-card">{children}</section>
      </div>
    </main>
  )
}

export function PasswordField({
  label = '密码',
  id = 'auth-password',
  name = 'password',
  newPassword = false,
}: {
  label?: string
  id?: string
  name?: string
  newPassword?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-box">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 8 : undefined}
          required
          placeholder="请输入密码"
        />
        <button
          type="button"
          className="auth-eye"
          aria-label={`${visible ? '隐藏' : '显示'}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  )
}

function LoginForm() {
  const [view, setView] = useState<
    'login' | 'register' | 'verify' | 'forgot' | 'sent'
  >('login')
  const [registeredEmail, setRegisteredEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    )
    return () => window.clearTimeout(timer)
  }, [cooldown])
  async function resend() {
    if (busy || cooldown) return
    setBusy(true)
    setError('')
    try {
      const client = await authClient()
      const result = await client.auth.resend({
        type: 'signup',
        email: registeredEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (result.error)
        setError(
          result.error.status === 429
            ? '邮件发送过于频繁，请稍后重试'
            : '邮件暂时无法发送，请稍后重试',
        )
      else setCooldown(60)
    } catch {
      setError('连接失败，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const values = new FormData(event.currentTarget)
    if (
      view === 'register' &&
      values.get('password') !== values.get('confirmation')
    ) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      const client = await authClient()
      const email = String(values.get('email')).trim().toLowerCase()
      if (view === 'forgot') {
        const result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        })
        if (result.error)
          setError(
            result.error.status === 429
              ? '操作过于频繁，请稍后重试'
              : '邮件暂时无法发送，请稍后重试',
          )
        else {
          setRegisteredEmail(email)
          setView('sent')
        }
        return
      }
      const credentials = { email, password: String(values.get('password')) }
      const { error: failure } =
        view === 'register'
          ? await client.auth.signUp({
              ...credentials,
              options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
              },
            })
          : await client.auth.signInWithPassword(credentials)
      if (failure)
        setError(
          failure.code === 'invalid_credentials'
            ? '邮箱或密码不正确，请重试'
            : failure.code === 'email_not_confirmed'
              ? '请先完成邮箱验证，再登录'
              : failure.status === 429
                ? '操作过于频繁，请稍后重试'
                : view === 'register'
                  ? '无法注册，请确认邮箱已获准访问后重试'
                  : '登录暂时失败，请稍后重试',
        )
      else if (view === 'register') {
        setRegisteredEmail(email)
        setView('verify')
      }
    } catch {
      setError('连接失败，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }
  const changeView = (next: 'login' | 'register' | 'forgot') => {
    setView(next)
    setError('')
  }
  if (view === 'verify')
    return (
      <div className="auth-center">
        <h1>请验证你的邮箱</h1>
        <p>
          请打开 {registeredEmail}{' '}
          收到的验证邮件，点击链接完成验证。请在发起注册的浏览器打开链接。
        </p>
        {error && (
          <p className="auth-banner" role="alert">
            {error}
          </p>
        )}
        <button className="auth-primary" onClick={() => changeView('login')}>
          返回登录
        </button>
        <button
          className="auth-secondary"
          disabled={busy || cooldown > 0}
          onClick={() => {
            void resend()
          }}
        >
          {busy
            ? '正在发送…'
            : cooldown
              ? `${cooldown} 秒后可重新发送`
              : '重新发送验证邮件'}
        </button>
      </div>
    )
  if (view === 'sent')
    return (
      <div className="auth-center">
        <h1>请查看你的邮箱</h1>
        <p>如果 {registeredEmail} 对应可用账户，你将收到密码重置邮件。</p>
        <button className="auth-primary" onClick={() => changeView('login')}>
          返回登录
        </button>
      </div>
    )
  return (
    <>
      {view !== 'forgot' && (
        <div className="auth-tabs">
          <button
            type="button"
            disabled={busy}
            className={view === 'login' ? 'active' : ''}
            onClick={() => changeView('login')}
          >
            登录
          </button>
          <button
            type="button"
            disabled={busy}
            className={view === 'register' ? 'active' : ''}
            onClick={() => changeView('register')}
          >
            注册
          </button>
        </div>
      )}
      <h1>
        {view === 'login'
          ? '欢迎回来'
          : view === 'forgot'
            ? '找回你的账户'
            : '为日常留个位置'}
      </h1>
      <p className="auth-subtitle">
        {view === 'login'
          ? '登录后，把今天重新放在眼前。'
          : view === 'forgot'
            ? '输入注册邮箱，接收密码重置链接。'
            : '使用已获准的邮箱，创建你的 LifeSpace 账户。'}
      </p>
      {error && (
        <p className="auth-banner" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="auth-email">邮箱</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="请输入邮箱"
          />
        </div>
        {view === 'login' && (
          <button
            className="auth-link auth-forgot"
            type="button"
            disabled={busy}
            onClick={() => changeView('forgot')}
          >
            忘记密码？
          </button>
        )}
        {view !== 'forgot' && (
          <PasswordField newPassword={view === 'register'} />
        )}
        {view === 'register' && (
          <PasswordField
            label="确认密码"
            id="auth-confirmation"
            name="confirmation"
            newPassword
          />
        )}
        <button className="auth-primary" type="submit" disabled={busy}>
          {busy
            ? '正在处理…'
            : view === 'login'
              ? '登录 LifeSpace'
              : view === 'forgot'
                ? '发送重置邮件'
                : '创建账户'}
        </button>
      </form>
      <p className="auth-fine-print">仅向已获准的邮箱开放访问</p>
      {view === 'forgot' && (
        <button
          type="button"
          className="auth-link"
          onClick={() => changeView('login')}
        >
          返回登录
        </button>
      )}
    </>
  )
}
