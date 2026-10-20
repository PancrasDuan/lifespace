// 一次性原型：在 /news 比较顶部中央手柄；示例数据与独立本地存储，不接业务 API。
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontal, RotateCw, Settings2, X, ChevronLeft, ChevronRight, UserRound } from 'lucide-react'
import { AppLayout } from '../../src/app/AppLayout'
import '../../src/home/home.css'
import '../../src/news/news.css'
import './prototype.css'

const cards = [
  { id: 'cls-hot', label: '财联社热门', items: ['半导体行业迎来新进展，多家龙头企业披露最新规划', '国家数据集团成立，产业数字化进入新阶段', '全球市场观察：科技与能源板块表现活跃', '英伟达公布新一代计算平台，加速 AI 应用落地', '每日收评：科创板指数走强，机器人概念受关注', '焦点复盘：市场热点与行业趋势一览'] },
  { id: 'bilibili-hot-search', label: '哔哩哔哩热搜', items: ['王力宏回应在梅边舞台', 'IG 全球总决赛出征片', '超强台风来了', '重庆狼队战胜深圳 DYG', '迟到时经历的生死时刻', 'A2O LITE 入驻 B 站', '歌剧老师锐评 S16 主题曲'] },
  { id: 'freebuf', label: 'Freebuf 网络安全', items: ['神器推荐｜一款高级网络监听工具', '企业如何构建更可靠的 AI 安全体系', 'Agent 捡到了没人管的钱包：开源仓库凭证安全实践', '微软发布全新安全框架，将 AI Agent 视为内部威胁', 'FreeBuf 早报：本周网络安全动态汇总', '检索授权不是数据授权：RAG 知识库安全边界'] },
  { id: 'github-trending-today', label: 'GitHub Today', items: ['MadsLorentzen / ai-job-search', 'cloudflare / security-audit-skill', 'stabilityai / orca', '社区精选：本周值得关注的开源工具', '开发者工作流的下一步', '构建可维护的小型应用'] },
  { id: 'hackernews', label: 'Hacker News', items: ['My Friend Bob Cringley', 'EMudhra Intermediate CA Compromise', '2026 is an exciting year for the Rust compiler', 'The quiet art of building useful software', 'A small tool for a better reading experience', 'What makes a good personal dashboard?'] },
  { id: 'producthunt', label: 'Product Hunt', items: ['/dev/null', 'Composio Instant', 'Harness²', 'Your next favorite developer tool', 'A calmer place to read', 'Small ideas, thoughtfully built'] },
]
const defaults = cards.map(c => c.id)
const key = 'lifespace.prototype.news-order.v1'
const variants = ['A', 'B', 'C']
const names = ['灵动岛手柄', '顶部页签', '中央拖动栏']
function load() { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(v) ? [...new Set([...v.filter(id => defaults.includes(id)), ...defaults])] as string[] : defaults } catch { return defaults } }

function Card({ id, overlay = false }: { id: string; overlay?: boolean }) {
  const c = cards.find(c => c.id === id)!
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: overlay })
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`news-card ${isDragging ? 'drag-placeholder' : ''} ${overlay ? 'floating-card' : ''}`} aria-label={c.label}>
    <div className="handle-lane"><button ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} className={`drag-handle ${isDragging || overlay ? 'is-dragging' : ''}`} aria-label={`拖动${c.label}`} title="按住拖动，调整卡片顺序"><GripHorizontal size={18}/><span>{overlay ? '移动中' : '拖动排序'}</span></button></div>
    <header className="news-card-heading"><div><img className="news-source-icon" src={`/news-icons/${id.split('-')[0]}.png`} alt="" /><h2>{c.label}</h2></div><button aria-label={`刷新${c.label}`}><RotateCw size={15}/></button></header>
    <div className="news-list" tabIndex={0}><ol>{[...c.items, ...c.items].map((title, i) => <li key={i}><span className="news-rank">{i + 1}</span><a href="#" onClick={e => e.preventDefault()}>{title}</a></li>)}</ol></div>
    <footer className="news-card-footer"><span>获取时间 10/20 23:04</span><span>示例榜单 · 仅供原型预览</span></footer>
  </article>
}

function Prototype() {
  const [order, setOrder] = useState(load)
  const [hidden, setHidden] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [fail, setFail] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const [variant, setVariant] = useState(() => {
    const requested = new URLSearchParams(location.search).get('variant') || 'A'
    return variants.includes(requested) ? requested : 'A'
  })
  const before = useRef(order)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 7 } }))
  const visible = order.filter(id => !hidden.includes(id))
  function save(next: string[]) {
    setOrder(next)
    try { if (fail) throw new Error(); localStorage.setItem(key, JSON.stringify(next)); setUnsaved(false) }
    catch { setUnsaved(true) }
  }
  function switchVariant(delta: number) {
    const next = variants[(variants.indexOf(variant) + delta + 3) % 3]
    setVariant(next); const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState({}, '', url)
  }
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && settings) { setSettings(false); return }
      const target = event.target as HTMLElement
      if (active || settings || target.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        switchVariant(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, settings, variant])
  return <div className={`variant-${variant}`}><AppLayout page="news" openSettings={() => setSettings(true)}><div className="news-page">
    <button className="prototype-avatar" aria-label="示例账户"><UserRound size={19}/></button>
    <header className="masthead"><div className="page-kicker"><span className="live-dot"/>LifeSpace · 每日阅读</div><h1>热点新闻</h1><p>把值得关注的消息放在一起</p></header>
    <div className="news-toolbar"><span>按来源浏览 · {visible.length} 个榜单</span><div className="news-toolbar-actions"><button><RotateCw size={15}/>全部刷新</button><button onClick={() => setSettings(true)}><Settings2 size={15}/>来源设置</button></div></div>
    {unsaved && <div className="sort-alert" role="alert">卡片顺序未保存，仅在当前页面生效</div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll onDragStart={({ active }) => { before.current = order; setActive(String(active.id)) }} onDragOver={({ active, over }) => {
      if (!over || active.id === over.id) return
      setOrder(prev => {
        const displayed = prev.filter(id => !hidden.includes(id))
        const next = arrayMove(displayed, displayed.indexOf(String(active.id)), displayed.indexOf(String(over.id)))
        let index = 0
        return prev.map(id => hidden.includes(id) ? id : next[index++])
      })
    }} onDragCancel={() => { setOrder(before.current); setActive(null) }} onDragEnd={() => { setActive(null); save(order) }}>
      <SortableContext items={visible} strategy={rectSortingStrategy}><section className="news-grid" aria-label="新闻榜单">{visible.map(id => <Card id={id} key={id}/>)}</section></SortableContext>
      <DragOverlay dropAnimation={null}>{active && <Card id={active} overlay/>}</DragOverlay>
    </DndContext>
    <p className="prototype-footnote">本地交互原型 · 示例新闻 · 排序使用独立原型存储</p>
    {settings && <div className="prototype-backdrop" onClick={() => setSettings(false)}><section className="prototype-dialog" role="dialog" aria-modal="true" aria-label="新闻来源设置" onClick={e => e.stopPropagation()}>
      <header><h2>新闻来源设置</h2><button aria-label="关闭设置" onClick={() => setSettings(false)}><X size={19}/></button></header>
      <p>开关即时生效。关闭来源后，再开启将回到原来的位置。</p>
      <div className="prototype-options">{cards.map(c => <label key={c.id}><img src={`/news-icons/${c.id.split('-')[0]}.png`} alt=""/><span>{c.label}</span><input type="checkbox" checked={!hidden.includes(c.id)} onChange={e => setHidden(prev => e.target.checked ? prev.filter(id => id !== c.id) : [...prev, c.id])}/></label>)}</div>
      <div className="reset-row"><div><strong>卡片顺序</strong><p>{confirmReset ? '确认恢复？当前卡片顺序将被覆盖。' : '恢复来源的默认顺序，保留当前来源开关。'}</p></div>{confirmReset ? <div className="reset-confirm"><button onClick={() => setConfirmReset(false)}>取消</button><button className="danger" onClick={() => { save(defaults); setConfirmReset(false) }}>确认恢复</button></div> : <button onClick={() => setConfirmReset(true)}><RotateCw size={14}/>恢复默认顺序</button>}</div>
      <details><summary>原型演示选项</summary><label className="failure-option"><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)}/>模拟本地保存失败</label></details>
      {unsaved && <p className="failed">卡片顺序未保存，仅在当前页面生效</p>}
      <button className="prototype-done" onClick={() => setSettings(false)}>完成</button>
    </section></div>}
    <div className="prototype-switcher"><span>原型</span><button aria-label="上个方案" onClick={() => switchVariant(-1)}><ChevronLeft size={17}/></button><strong>{variant} · {names[variants.indexOf(variant)]}</strong><button aria-label="下个方案" onClick={() => switchVariant(1)}><ChevronRight size={17}/></button><button className="state-toggle" onClick={() => setStateOpen(!stateOpen)}>状态</button></div>
    {stateOpen && <pre className="prototype-state">{JSON.stringify({ variant, order, hidden, active, unsaved, simulatedSaveFailure: fail }, null, 2)}</pre>}
  </div></AppLayout></div>
}
createRoot(document.getElementById('root')!).render(<Prototype/>)
