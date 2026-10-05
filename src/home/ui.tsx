import { useEffect, useRef, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Clock3, CloudSun, ListTodo, RotateCw, X } from 'lucide-react'

export type CardKind = 'time' | 'weather' | 'tasks' | 'calendar'
const titles = { time: '世界时间', weather: '今日天气', tasks: '今日待办', calendar: '日期与黄历' }
export function Panel({ kind, children, footer, open, refresh, loading }: { kind: CardKind; children: ReactNode; footer?: ReactNode; open: () => void; refresh?: () => void; loading?: boolean }) {
  const Icon = { time: Clock3, weather: CloudSun, tasks: ListTodo, calendar: CalendarDays }[kind]
  return <article className={`info-panel panel-${kind}`}>
    <div className="panel-heading"><span><Icon size={17} /><h2>{titles[kind]}</h2></span><ChevronRight size={15} /></div>
    <button className="panel-open" aria-label={`查看${titles[kind]}详情`} onClick={open}>{children}</button>
    {footer && <div className="panel-footer"><span>{footer}</span>{refresh && <button onClick={refresh} aria-label={`刷新${titles[kind]}`} disabled={loading}><RotateCw size={14} className={loading ? 'spinning' : ''} /></button>}</div>}
  </article>
}
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog className="modal" ref={ref} aria-label={title} onClose={close} onClick={event => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
  }}><header><div><span className="eyebrow">LifeSpace</span><h2>{title}</h2></div><button aria-label="关闭详情" onClick={close}><X size={22} /></button></header>{children}</dialog>
}
