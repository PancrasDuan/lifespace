import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Activity, CalendarDays, ChevronRight, Clock3, CloudSun, Globe, ListTodo, RotateCw, X } from 'lucide-react'

export type CardKind = 'time' | 'weather' | 'tasks' | 'calendar' | 'domains' | 'ai'
const titles = { time: '世界时间', weather: '今日天气', tasks: '今日待办', calendar: '日期与黄历', domains: 'DNSHE 域名', ai: 'AI 服务状态' }
export function Panel({ kind, children, footer, open, refresh, loading, description }: { kind: CardKind; children: ReactNode; footer?: ReactNode; open: () => void; refresh?: () => void; loading?: boolean; description?: string }) {
  const descriptionId = useId()
  const Icon = { time: Clock3, weather: CloudSun, tasks: ListTodo, calendar: CalendarDays, domains: Globe, ai: Activity }[kind]
  return <article className={`info-panel panel-${kind}`}>
    <div className="panel-heading"><span><Icon size={17} /><h2>{titles[kind]}</h2></span><ChevronRight size={15} /></div>
    {description && <p className="panel-description" id={descriptionId}>{description}</p>}
    <button aria-describedby={description ? descriptionId : undefined} className="panel-open" aria-label={`查看${titles[kind]}详情`} onClick={open}>{children}</button>
    {footer && <div className="panel-footer"><span>{footer}</span>{refresh && <button onClick={refresh} aria-label={`刷新${titles[kind]}`} disabled={loading}><RotateCw size={14} className={loading ? 'spinning' : ''} /></button>}</div>}
  </article>
}
export function Modal({ title, children, close, description }: { title: string; children: ReactNode; close: () => void; description?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const descriptionId = useId()
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const position = { left: window.scrollX, top: window.scrollY }
    const pagePath = window.location.pathname
    if (!dialog?.open) dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener?.isConnected && window.location.pathname === pagePath) {
        opener.focus({ preventScroll: true })
        window.scrollTo({ ...position, behavior: 'instant' })
      }
    }
  }, [])
  return <dialog className="modal" ref={ref} aria-label={title} aria-describedby={description ? descriptionId : undefined} onClose={close} onClick={event => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
  }}><header><div><span className="eyebrow">LifeSpace</span><h2>{title}</h2>{description && <p className="modal-description" id={descriptionId}>{description}</p>}</div><button aria-label="关闭详情" onClick={close}><X size={22} /></button></header>{children}</dialog>
}
