import { useEffect, useRef, useState } from 'react'
import { UserRound, LogOut } from 'lucide-react'
import { revokeSession } from './client'

export function AccountMenu({ email }: { email?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  async function logout() {
    if (busy || !email) return
    setBusy(true); setError('')
    try {
      await revokeSession('local')
      window.dispatchEvent(new CustomEvent('lifespace-auth-rejected', { detail: 401 })); setOpen(false)
    } catch { setError('退出未完成，请重试') }
    finally { setBusy(false) }
  }
  return <div className="auth-account" ref={root}><button ref={trigger} className="auth-avatar" aria-label="账户菜单" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><UserRound size={20} /></button>
    {open && <div className="auth-account-menu" role="menu" aria-label="账户">
      <p>{email ?? '尚未登录'}</p><button role="menuitem" disabled={!email || busy} onClick={() => { void logout() }}><LogOut size={16} />{busy ? '正在退出…' : '退出登录'}</button>
      {error && <p className="auth-menu-error" role="alert">{error}</p>}
    </div>}
  </div>
}
