import { useEffect, useState, type FormEvent } from 'react'
import { authClient, revokeSession, resetPendingKey, authMarker, saveAuthMarker } from './client'
import { PasswordField } from './AuthGate'

export function ResetPasswordForm({ authorized, checking, accountId }: { authorized: boolean; checking: boolean; accountId?: string }) {
  const [phase, setPhase] = useState<'form' | 'revoke' | 'done'>('form')
  useEffect(() => { if (accountId && authMarker(resetPendingKey) === accountId) setPhase('revoke') }, [accountId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  async function revoke() {
    setBusy(true); setError('')
    try { await revokeSession('global'); saveAuthMarker(resetPendingKey); setPhase('done') }
    catch { setError('密码已更新，但全部旧会话撤销尚未确认。请重试撤销。') }
    finally { setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !authorized) return
    const values = new FormData(event.currentTarget)
    if (values.get('password') !== values.get('confirmation')) { setError('两次输入的密码不一致'); return }
    setBusy(true); setError('')
    try {
      const client = await authClient()
      const result = await client.auth.updateUser({ password: String(values.get('password')) })
      if (result.error) { setError(result.error.code === 'same_password' ? '新密码不能与旧密码相同' : '未能确认密码更新，请稍后重试'); return }
      setPhase('revoke')
      if (result.data.user && !saveAuthMarker(resetPendingKey, result.data.user.id)) setStorageUnavailable(true)
      await revoke()
    } catch { setError('未能确认密码更新，请检查网络后重试') }
    finally { setBusy(false) }
  }
  if (phase === 'done') return <div className="auth-center"><h1>密码已更新</h1><p>旧会话已撤销，请使用新密码重新登录。</p><button className="auth-primary" onClick={() => window.location.assign('/')}>返回登录</button></div>
  if (phase === 'revoke') return <div className="auth-center"><h1>正在完成账户保护</h1><p>密码已更新，正在确认全部旧会话已撤销。</p>{storageUnavailable && <p role="status">本浏览器无法保存恢复状态，请在当前页面完成撤销后再离开。</p>}{error && <p role="alert" className="auth-banner">{error}</p>}<button className="auth-primary" disabled={busy} onClick={() => { void revoke() }}>{busy ? '正在撤销…' : '重试撤销旧会话'}</button></div>
  if (checking) return <div className="auth-center"><h1>正在验证重置链接</h1><p>请稍候…</p></div>
  if (!authorized) return <div className="auth-center"><h1>重置链接不可用</h1><p>链接可能已过期、已使用，或在另一浏览器打开。请重新申请重置邮件，并在发起操作的浏览器打开。</p><button className="auth-primary" onClick={() => window.location.assign('/')}>返回登录</button></div>
  return <><h1>设置新密码</h1><p className="auth-subtitle">保存后撤销所有旧会话，需要重新登录。</p>{error && <p role="alert" className="auth-banner">{error}</p>}<form onSubmit={submit}><PasswordField label="新密码" newPassword /><PasswordField label="确认密码" id="auth-confirmation" name="confirmation" newPassword /><button className="auth-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button></form></>
}
