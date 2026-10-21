import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleAlert, X } from 'lucide-react'

export function PlanningToast({ message, close, tone = 'success', withinDialog = false }: { message: string; close: () => void; tone?: 'success' | 'error'; withinDialog?: boolean }) {
  const [target, setTarget] = useState<Element>(document.body)
  useLayoutEffect(() => {
    setTarget(withinDialog ? document.querySelector('.planning-page [role="dialog"]') ?? document.body : document.body)
  }, [withinDialog])
  useEffect(() => {
    if (tone === 'error') return
    const timeout = window.setTimeout(close, 4_000)
    return () => window.clearTimeout(timeout)
  }, [close, tone])

  return createPortal(
    <div className={`planning-toast planning-toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
      {tone === 'error' ? <CircleAlert size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
      <span>{message}</span>
      <button type="button" aria-label={tone === 'error' ? '关闭错误提示' : '关闭成功提示'} onClick={close}><X size={16} aria-hidden="true" /></button>
    </div>,
    target,
  )
}
