import { useEffect, useRef, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { AuthLayout } from './AuthGate'
import { authorizedFetch, authorizedMutation } from './request'
import { useVerifiedIdentity } from './identity'
import { mcpScopes, mcpScopeLabels } from '../shared/mcp-oauth'
import './mcp-authorization.css'

const consentSchema = z.object({ handle: z.string(), details: z.object({
  clientName: z.string(), clientDomain: z.string().optional(), redirectHost: z.string(),
  redirectIsLoopback: z.boolean(), scope: z.array(z.enum(mcpScopes)),
}) })
const grantsSchema = z.object({ grants: z.array(z.object({
  id: z.uuid(), clientId: z.string(), clientName: z.string(), scopes: z.array(z.enum(mcpScopes)),
  createdAt: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(),
})), nextCursor: z.object({ before: z.string(), beforeId: z.uuid() }).nullable() })
const redirectSchema = z.object({ redirectTo: z.url() })
const failureSchema = z.object({ error: z.object({ message: z.string() }) })
async function readResponse<T>(response: Response, schema: z.ZodType<T>) {
  const body: unknown = await response.json()
  if (!response.ok) {
    const failure = failureSchema.safeParse(body)
    throw new Error(failure.success ? failure.data.error.message : '暂时无法连接，请稍后重试')
  }
  return schema.parse(body)
}

export function McpAuthorization() {
  const { ownerId, email, signal } = useVerifiedIdentity()
  const [consent, setConsent] = useState<z.infer<typeof consentSchema>>()
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const errorElement = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) errorElement.current?.focus() }, [error])
  useEffect(() => {
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    void authorizedMutation('/api/oauth/consent/start', JSON.stringify({ query: window.location.search }), combined, ownerId)
      .then(response => readResponse(response, consentSchema))
      .then(value => { if (!combined.aborted) { setConsent(value); setSelected(value.details.scope) } })
      .catch(() => { if (!combined.aborted) setError('无法打开授权请求，请从客户端重新连接。') })
    return () => controller.abort()
  }, [ownerId, signal])

  async function decide(decision: 'approve' | 'deny') {
    if (!consent || pending.current) return
    if (decision === 'approve' && !selected.length) {
      setError('请至少选择一项权限，或拒绝此次授权。')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const response = await authorizedMutation('/api/oauth/consent/finish', JSON.stringify({ handle: consent.handle, decision, scopes: selected }), signal, ownerId)
      const result = await readResponse(response, redirectSchema)
      signal.throwIfAborted()
      const target = new URL(result.redirectTo)
      // The server validated the registered redirect. Keep a final safe-scheme
      // guard here; never take a redirect from the page's query string.
      if (target.protocol !== 'https:' && !(target.protocol === 'http:' && /^(localhost|127(?:\.\d+){3}|\[::1\])$/.test(target.hostname))) throw new Error('回调地址无效，请从客户端重新连接。')
      window.location.assign(target.href)
    } catch (failure) {
      if (!signal.aborted) {
        setError(failure instanceof Error && !(failure instanceof z.ZodError) ? failure.message : '授权结果未确认，请从客户端重新连接，并在授权管理中核对。')
      }
      pending.current = false
      setBusy(false)
    }
  }
  function submit(event: FormEvent) { event.preventDefault(); void decide('approve') }
  return <AuthLayout title="客户端授权">
    <div className="mcp-authorization">
      <h1 id="page-title" tabIndex={-1}>授权客户端访问账单</h1>
      <p className="auth-subtitle">当前账户：{email}</p>
      {error && <p className="auth-banner" role="alert" tabIndex={-1} ref={errorElement}>{error}</p>}
      {!consent && !error && <p>正在核对客户端信息…</p>}
      {consent && <>
        <h2>{consent.details.clientName}</h2>
        <p className="mcp-client-source">{consent.details.clientDomain ? <>客户端域名：<strong>{consent.details.clientDomain}</strong></> : '此客户端的名称由其自行注册，请核对是否是你发起的连接。'}</p>
        <p className="mcp-callback">授权将返回：<strong>{consent.details.redirectHost}</strong></p>
        {consent.details.redirectIsLoopback && <p className="auth-banner">授权将交给本机应用。只有在你刚从该应用发起连接时才继续；客户端名称不能证明本机进程的身份。</p>}
        <form onSubmit={submit} action="/api/oauth/consent/finish" method="post">
          <fieldset disabled={busy} className="mcp-permissions">
            <legend>选择允许的操作</legend>
            {mcpScopes.map(scope => <div className="mcp-permission" key={scope}>
              <input id={`permission-${scope}`} type="checkbox" name="scope" value={scope} checked={selected.includes(scope)}
                aria-describedby={`description-${scope}`} onChange={event => {
                  setSelected(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))
                  setError('')
                }} />
              <label htmlFor={`permission-${scope}`}>{mcpScopeLabels[scope].name}<span id={`description-${scope}`}>{mcpScopeLabels[scope].description}</span></label>
            </div>)}
          </fieldset>
          <p className="mcp-note">客户端可在授权有效期内保持连接，最长 30 天。新建流水和退款仍应先完整展示并取得你的确认。</p>
          <button type="submit" className="auth-primary" disabled={busy}>{busy ? '正在处理…' : '同意并返回客户端'}</button>
          <button type="button" className="auth-secondary" disabled={busy} onClick={() => void decide('deny')}>拒绝授权</button>
        </form>
      </>}
      <p className="mcp-footer"><a href="/oauth/grants">管理已授权的客户端</a> · <a href="/">返回 LifeSpace</a></p>
    </div>
  </AuthLayout>
}

export function McpGrants() {
  const { ownerId, signal } = useVerifiedIdentity()
  const [grants, setGrants] = useState<z.infer<typeof grantsSchema>['grants']>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState<string>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [revision, setRevision] = useState(0)
  const [cursor, setCursor] = useState<z.infer<typeof grantsSchema>['nextCursor']>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const resultElement = useRef<HTMLParagraphElement>(null)
  const errorElement = useRef<HTMLParagraphElement>(null)
  const revokeButtons = useRef(new Map<string, HTMLButtonElement>())
  const previousConfirmation = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (confirming) confirmButton.current?.focus()
    else if (previousConfirmation.current) {
      const trigger = revokeButtons.current.get(previousConfirmation.current)
      if (trigger) trigger.focus()
      else if (message) resultElement.current?.focus()
    }
    previousConfirmation.current = confirming
  }, [confirming, message])
  useEffect(() => { if (error) errorElement.current?.focus() }, [error])
  useEffect(() => {
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    setError('')
    void authorizedFetch('/api/oauth/grants', combined, ownerId).then(response => readResponse(response, grantsSchema))
      .then(result => { if (!combined.aborted) { setGrants(result.grants); setCursor(result.nextCursor) } })
      .catch(() => { if (!combined.aborted) setError('暂时无法读取授权，请重试。') })
    return () => controller.abort()
  }, [signal, ownerId, revision])
  async function loadMore() {
    if (!cursor || pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const result = await readResponse(await authorizedFetch('/api/oauth/grants?' + new URLSearchParams(cursor), signal, ownerId), grantsSchema)
      if (!signal.aborted) { setGrants(current => [...(current ?? []), ...result.grants]); setCursor(result.nextCursor) }
    } catch { if (!signal.aborted) setError('暂时无法读取更早的授权，请重试。') }
    finally { pending.current = false; setBusy(false) }
  }
  async function revoke(id: string) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await readResponse(await authorizedMutation('/api/oauth/grants/revoke', JSON.stringify({ id }), signal, ownerId), z.object({ revoked: z.literal(true) }))
      if (!signal.aborted) {
        setGrants(current => current?.map(grant => grant.id === id ? { ...grant, revokedAt: new Date().toISOString() } : grant))
        setConfirming(undefined)
        setMessage('授权已撤销，后续调用和续期将被拒绝；已在处理的请求不会自动回滚。')
      }
    } catch { if (!signal.aborted) setError('撤销结果未确认，请刷新核对后重试。') }
    finally { pending.current = false; setBusy(false) }
  }
  return <AuthLayout title="客户端授权管理">
    <div className="mcp-authorization">
      <h1 id="page-title" tabIndex={-1}>已授权的客户端</h1>
      <p className="auth-subtitle">每次连接单独管理；退出网页不会撤销客户端授权。</p>
      {error && <p className="auth-banner" role="alert" tabIndex={-1} ref={errorElement}>{error} <button type="button" className="auth-link" onClick={() => setRevision(value => value + 1)}>刷新授权</button></p>}
      <p role="status" className="mcp-note" tabIndex={-1} ref={resultElement}>{message}</p>
      {!grants && !error && <p>正在读取授权…</p>}
      {grants?.length === 0 && <p className="mcp-empty">还没有授权客户端。从 MCP 客户端连接 LifeSpace 后，可在这里管理。</p>}
      {grants && <ul className="mcp-grants">{grants.map(grant => {
        const active = !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now()
        return <li key={grant.id}>
          <h2>{grant.clientName || '未命名客户端'}</h2>
          <p className="mcp-client-source">{grant.clientId}</p>
          <p>{grant.scopes.map(scope => mcpScopeLabels[scope].name).join('、')}</p>
          <p className="mcp-note">{grant.revokedAt ? '已撤销' : !active ? '已到期' : '已授权'} · 授权于 {new Date(grant.createdAt).toLocaleString('zh-CN')}</p>
          {active && (confirming === grant.id ? <div className="mcp-revoke-confirm">
            <p>撤销后，此连接需要重新征得你的同意。</p>
            <button className="auth-secondary" type="button" disabled={busy} ref={confirmButton} onClick={() => void revoke(grant.id)}>{busy ? '正在撤销…' : '确认撤销'}</button>
            <button className="auth-link" type="button" disabled={busy} onClick={() => setConfirming(undefined)}>保留授权</button>
          </div> : <button className="auth-secondary" type="button" disabled={busy} ref={node => { if (node) revokeButtons.current.set(grant.id, node); else revokeButtons.current.delete(grant.id) }} aria-label={`撤销 ${grant.clientName || '未命名客户端'} 于 ${new Date(grant.createdAt).toLocaleString('zh-CN')} 的授权`} onClick={() => setConfirming(grant.id)}>撤销授权</button>)}
        </li>
      })}</ul>}
      {cursor && <button type="button" className="auth-secondary" disabled={busy} onClick={() => void loadMore()}>加载更早的授权</button>}
      <p className="mcp-footer"><a href="/">返回 LifeSpace</a></p>
    </div>
  </AuthLayout>
}
