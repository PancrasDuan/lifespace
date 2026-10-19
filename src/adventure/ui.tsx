import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Temporal } from '@js-temporal/polyfill'
import type { AdventureState, Goal, Task } from '../shared/adventure/model'

export const addDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString()
export const goalLabel = (state: AdventureState, goal: Goal) => {
  const owner = state.containers.find((value) => value.id === goal.containerId)
  return `${owner?.name || '原归属'} ${owner?.kind === 'main' ? '主线' : '支线'} · ${goal.title} 目标`
}
export const goalWritable = (state: AdventureState, goal: Goal) =>
  !goal.archived &&
  !goal.completion &&
  !state.containers.find((value) => value.id === goal.containerId)?.archived &&
  !state.containers.find((value) => value.id === goal.containerId)?.convertedTo
export const taskWritable = (state: AdventureState, task: Task) => {
  const goal = state.goals.find((value) => value.id === task.goalId)
  const owner = state.containers.find((value) => value.id === goal?.containerId)
  return (
    !!goal &&
    !goal.archived &&
    !owner?.archived &&
    !owner?.convertedTo &&
    (!goal.completion || !!task.cycleId) &&
    !task.stopped &&
    !task.rescheduledTo
  )
}
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
export function Empty({ children }: { children: ReactNode }) {
  return <p className="adventure-empty">{children}</p>
}
export function More({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  return (
    <details className="adventure-more">
      <summary aria-label={`${name}的更多操作`}>•••</summary>
      <div
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('button'))
            event.currentTarget.parentElement?.removeAttribute('open')
        }}
      >
        {children}
      </div>
    </details>
  )
}
export function OwnerSelect({
  state,
  value,
  change,
}: {
  state: AdventureState
  value: string
  change: (value: string) => void
}) {
  return (
    <label>
      所属主线或支线
      <select
        required
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        <option value="" disabled hidden>
          选择主线或支线
        </option>
        {state.containers
          .filter(
            (value) =>
              !value.archived &&
              !value.convertedTo &&
              !(
                value.kind === 'side' &&
                state.goals.some((goal) => goal.containerId === value.id)
              ),
          )
          .map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name} {owner.kind === 'main' ? '主线' : '支线'}
            </option>
          ))}
      </select>
    </label>
  )
}
export function GoalSelect({
  state,
  value,
  change,
}: {
  state: AdventureState
  value: string
  change: (value: string) => void
}) {
  return (
    <label>
      所属目标
      <select
        required
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        <option value="" disabled hidden>
          选择任务所属的目标
        </option>
        {state.goals
          .filter((goal) => goalWritable(state, goal))
          .map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goalLabel(state, goal)}
            </option>
          ))}
      </select>
    </label>
  )
}

// 勾选立即反馈，正式经验和统计仍只接收服务端确认；失败恢复原值。
export function CommandCheckbox({
  checked,
  disabled,
  label,
  execute,
}: {
  checked: boolean
  disabled: boolean
  label: string
  execute: () => Promise<boolean>
}) {
  const [pending, setPending] = useState<boolean | undefined>(undefined)
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={pending ?? checked}
      disabled={disabled || pending !== undefined}
      onChange={() => {
        setPending(!checked)
        void execute().finally(() => setPending(undefined))
      }}
    />
  )
}
