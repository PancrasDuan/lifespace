import { useRef, useState, type CSSProperties } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontal } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { NewsResult } from '../shared/news-contracts'
import type { NewsSource } from '../shared/news-sources'
import { NewsCard } from './NewsCard'

type Entry = { source: NewsSource; query: UseQueryResult<NewsResult, Error> }

function SortableCard({ source, query }: Entry) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: source.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return <div ref={setNodeRef} style={style} className={'news-sortable' + (isDragging ? ' news-sortable-dragging' : '')}>
    <NewsCard source={source} query={query} dragHandle={
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1}
        className="news-drag-handle" aria-label={'拖动' + source.label} title="按住拖动，调整卡片顺序">
        <GripHorizontal size={17} /><span>拖动排序</span>
      </button>
    } />
  </div>
}

export function NewsSortableGrid({ entries, changeOrder }: { entries: Entry[]; changeOrder: (ids: string[]) => void }) {
  const [preview, setPreview] = useState<string[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const draft = useRef<string[] | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 7 } }),
  )
  const byId = new Map(entries.map(entry => [entry.source.id, entry]))
  const ids = preview ?? entries.map(entry => entry.source.id)
  const active = activeId ? byId.get(activeId) : undefined
  const finish = () => { draft.current = null; setPreview(null); setActiveId(null) }

  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: '按住卡片顶部中央手柄拖动排序，松手保存；Escape 取消。' },
      announcements: {
        onDragStart: () => '开始调整新闻卡片顺序。',
        onDragOver: ({ over }) => over ? '正在调整新闻卡片位置。' : undefined,
        onDragEnd: () => '拖动结束。',
        onDragCancel: () => '已取消调整，恢复原有顺序。',
      } }}
    onDragStart={({ active }) => {
      draft.current = entries.map(entry => entry.source.id)
      setPreview(draft.current)
      setActiveId(String(active.id))
    }}
    onDragOver={({ active, over }) => {
      if (!over || active.id === over.id || !draft.current) return
      const from = draft.current.indexOf(String(active.id))
      const to = draft.current.indexOf(String(over.id))
      if (from < 0 || to < 0) return
      draft.current = arrayMove(draft.current, from, to)
      setPreview(draft.current)
    }}
    onDragCancel={finish}
    onDragEnd={({ over }) => {
      const next = draft.current
      finish()
      if (over && next && next.some((id, index) => id !== entries[index]?.source.id)) changeOrder(next)
    }}>
    <SortableContext items={ids} strategy={rectSortingStrategy}>
      <section className="news-grid" aria-label="新闻榜单">{ids.map(id => {
        const entry = byId.get(id)
        return entry ? <SortableCard key={id} {...entry} /> : null
      })}</section>
    </SortableContext>
    <DragOverlay dropAnimation={null}>{active && <div className="news-drag-overlay" aria-hidden="true" inert>
      <NewsCard {...active} dragHandle={<div className="news-drag-handle news-drag-handle-active"><GripHorizontal size={17} /><span>移动中</span></div>} />
    </div>}</DragOverlay>
  </DndContext>
}
