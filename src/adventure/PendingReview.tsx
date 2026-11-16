import { useId, useState } from 'react'
import type { PendingReviewState } from './usePlanning'

export function PendingReview({ review, inspect, release }: {
  review: PendingReviewState
  inspect: () => Promise<boolean>; release: () => Promise<boolean>
}) {
  const [checked, setChecked] = useState(false)
  const id = useId()
  const command = review.envelope.command
  return <div className="pending-review">
    <h2>核对上次操作</h2>
    <p id={`${id}-reason`}>{review.reason}</p>
    <p>原操作：{'title' in command ? command.title : 'id' in command ? command.id : command.type}</p>
    <p id={`${id}-warning`}>解除仅移除本机的待确认记录，不会撤销服务端结果，也不会重新提交。请核对当前目标、行动和经验，避免重复记录。</p>
    <button type="button" onClick={() => { setChecked(false); void inspect() }}>重新读取当前事实</button>
    {review.read && <p role="status">当前页面已重新读取，请核对后决定。</p>}
    <label htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} disabled={!review.read} aria-describedby={`${id}-reason ${id}-warning`} onChange={event => setChecked(event.target.checked)} />
      我已核对当前页面事实，确认解除本地待确认状态
    </label>
    <button type="button" disabled={!review.read || !checked} onClick={() => { void release() }}>解除本地待确认状态</button>
  </div>
}
