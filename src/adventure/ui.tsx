import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  title,
  close,
  children,
  restoreFocus,
  className = '',
  id,
  subtitle,
}: {
  title: string
  close: () => void
  children: ReactNode
  restoreFocus?: HTMLElement
  className?: string
  id?: string
  subtitle?: string
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : undefined
    const focusable = () =>
      [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:enabled, input:enabled, select:enabled, textarea:enabled, a[href], [tabindex="0"]:not(:disabled)',
        ) || []),
      ].filter(
        (element) =>
          !element.hidden &&
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0,
      )
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key === 'Tab') {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1)
        if (!dialog.current?.contains(document.activeElement)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
          return
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.current?.contains(document.activeElement))
        ) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    const opener = origin
    const recordSummary = restoreFocus ?? origin?.closest('article')?.querySelector<HTMLElement>(':scope > .record-summary')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', keydown)
      // Restore the actual opener after the overlay is gone. The fallback is
      // only for an opener that React replaced during an inline create step.
      requestAnimationFrame(() => {
        const target = restoreFocus?.isConnected ? restoreFocus : opener?.isConnected ? opener : recordSummary?.isConnected ? recordSummary : document.querySelector<HTMLElement>('.heading-actions .new-button:last-child')
        if (target && document.contains(target)) target.focus()
      })
    }
  }, [])
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(
        'button:enabled, input:enabled, select:enabled, textarea:enabled',
      )
      ?.focus()
  }, [title])
  return (
    <div
      className="adventure-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={dialog}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`adventure-dialog${className ? ` ${className}` : ''}`}
      >
        <header>
          {subtitle ? <div><h2>{title}</h2><p>{subtitle}</p></div> : <h2>{title}</h2>}
          <button type="button" aria-label="关闭弹窗" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
