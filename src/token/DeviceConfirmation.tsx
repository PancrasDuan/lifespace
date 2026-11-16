import { useEffect, useRef, useState } from 'react'
import { PageLink } from '../app/navigation'
import { useVerifiedIdentity } from '../auth/identity'
import { tokenCodeSchema } from '../shared/token-backend-contract'
import { inspectRegistration, decideRegistration, TokenError, errorMessage, type Inspection } from './api'
import { receivedTime } from './dates'
import { clearTokenConfirmation, rememberTokenConfirmation } from '../auth/token-confirmation-return'

function initialCode() {
  const value = new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? ''
  return tokenCodeSchema.safeParse(value).success ? value : ''
}
export function DeviceConfirmation() {
  const identity = useVerifiedIdentity()
  const [code, setCode] = useState(initialCode)
  const [inspection, setInspection] = useState<Inspection>()
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!inspection) return
    const update = () => setExpired(Date.parse(inspection.expiresAt) <= Date.now())
    update(); const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [inspection])
  const inspect = async () => {
    if (busy) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const signal = AbortSignal.any([controller.signal, identity.signal])
    setBusy(true); setInspection(undefined); setError(''); setReplace(false); setExpired(false)
    // Only the short user code is retained in the same-origin URL across login/reload.
    window.history.replaceState(null, '', `/token/devices/confirm?${new URLSearchParams({ code })}`)
    rememberTokenConfirmation(code)
    try { const result = await inspectRegistration(identity.ownerId, code, signal); if (!signal.aborted) { setInspection(result); if (result.status !== 'pending') clearTokenConfirmation() } }
    catch (error) { if (!signal.aborted) setError(errorMessage(error)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const decide = async (approve: boolean) => {
    if (busy || !inspection || expired || (approve && inspection.replacesExisting && !replace)) return
    const controller = new AbortController(); request.current = controller
    const signal = AbortSignal.any([controller.signal, identity.signal])
    setBusy(true); setError('')
    try {
      const result = await decideRegistration(identity.ownerId, { requestId: inspection.requestId, code, approve, replaceExisting: approve && replace }, signal)
      if (!signal.aborted) { setInspection({ ...inspection, status: result.status }); clearTokenConfirmation() }
    } catch (error) {
      if (!signal.aborted) {
        setError(errorMessage(error)); setReplace(false)
        // A competing registration requires a fresh inspect and explicit decision.
        if (error instanceof TokenError && ['TOKEN_STATE_CONFLICT', 'TOKEN_REBIND_REQUIRED'].includes(error.code)) setInspection(undefined)
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  const terminalStatus = inspection?.superseded ? '此设备授权已停用或被新授权替换，请在终端重新登记。' : inspection?.status && ({ approved: '已批准，请返回终端继续领取。', denied: '已拒绝。若需连接，请在终端重新登记。', claimed: '此申请已领取；若已停用或被替换，请在终端重新登记。', pending: '' })[inspection.status]
  return <>
    <div className="page-heading"><h1 id="page-title" tabIndex={-1}>确认采集设备</h1></div>
    <section className="panel registration-panel" aria-labelledby="registration-title"><h2 id="registration-title">核对终端设备码</h2><form action="/api/token/registrations/inspect" method="post" onSubmit={event => { event.preventDefault(); void inspect() }}><label htmlFor="token-device-code">设备码（8 位字母或数字）</label><input id="token-device-code" name="code" value={code} required pattern="[A-Z2-9]{8}" minLength={8} maxLength={8} autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="done" onChange={event => { request.current?.abort(); setBusy(false); setCode(event.target.value.toUpperCase()); setInspection(undefined); setError(''); setReplace(false) }} /><button className="button" type="submit" disabled={busy}>{busy ? '正在核对…' : '核对设备'}</button></form>
      {error && <p className="token-message" role="alert">{error}</p>}
      {inspection && <div className="registration-result"><h2>确认设备信息</h2><dl><dt>设备名称</dt><dd>{inspection.hostname}</dd><dt>平台</dt><dd>{inspection.platform === 'macos' ? 'macOS' : 'Linux'}</dd><dt>设备标识</dt><dd>{inspection.deviceId}</dd><dt>有效至（北京时间）</dt><dd>{receivedTime(inspection.expiresAt)}</dd></dl>{expired ? <p role="status">申请已过期，请在终端重新登记。</p> : terminalStatus ? <p role="status">{terminalStatus}</p> : <>{inspection.replacesExisting && <label className="replacement"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /><span>确认替换此设备的现有授权。领取后旧凭据立即失效，历史用量保留。</span></label>}<div className="token-actions"><button type="button" className="button" disabled={busy || (inspection.replacesExisting && !replace)} onClick={() => void decide(true)}>批准连接</button><button type="button" className="button" disabled={busy} onClick={() => void decide(false)}>拒绝连接</button></div></>}</div>}
    </section><PageLink className="text-button" href="/token">返回 Token 用量</PageLink>
  </>
}
