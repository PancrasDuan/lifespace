import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  title,
  close,
  children,
}: {
  title: string
  close: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement
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
        close()
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
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', keydown)
      origin?.focus()
    }
  }, [close])
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
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="adventure-dialog"
      >
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭弹窗" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
