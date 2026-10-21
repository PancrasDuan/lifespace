import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'

export function PlanningToast({ message, close }: { message: string; close: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(close, 4_000)
    return () => window.clearTimeout(timeout)
  }, [close])

  return createPortal(
    <div className="planning-toast" role="status" aria-atomic="true">
      <Check size={18} aria-hidden="true" />
      <span>{message}</span>
      <button type="button" aria-label="关闭成功提示" onClick={close}><X size={16} aria-hidden="true" /></button>
    </div>,
    document.body,
  )
}
