import { useState } from 'react'
import type { GoalAchievementPreview } from '../shared/adventure-planning'
import type { PlanningConfirmation } from './usePlanning'

export function GoalAchievement({ preview: current, confirmation, saved, cancel }: {
  preview: GoalAchievementPreview; confirmation: PlanningConfirmation; saved: () => void; cancel: () => void
}) {
  const [coefficient, setCoefficient] = useState(1)
  const [reflection, setReflection] = useState('')
  const reward = current.rewards.find(item => item.calculation.coefficient === coefficient)!
  const { blocked, stale } = confirmation
  return <form onSubmit={event => {
    event.preventDefault()
    void confirmation.confirm({ type: 'achieveGoal', id: current.goalId, coefficient, reflection }, saved)
  }}><fieldset disabled={blocked}>
    <h3>{current.title}</h3><h4>完成标准</h4><ul>{current.standards.map((item, i) => <li key={i}>{item}</li>)}</ul>
    <p>{current.message}</p><p>规划日期：{current.today} · 有效计奖行动：{reward.calculation.count} 次</p>
    <label>成就感评价<select aria-label="成就感评价" value={coefficient} onChange={event => setCoefficient(Number(event.target.value))}>
      <option value={1}>有一些成就感（默认／跳过评价）</option><option value={2}>很有成就感</option><option value={3}>成就感很强</option>
    </select></label>
    <p className="planning-achievement-reward">目标奖励：{reward.amount} 点经验</p>
    {reward.calculation.fallback && <p>无有效计奖行动，固定奖励 1 点，评价不改变奖励。</p>}
    <label>达成感想（可选）<textarea aria-label="达成感想（可选）" rows={3} maxLength={4000} value={reflection} onChange={event => setReflection(event.target.value)} /></label>
    <p>已有完成及奖励保留，达成后全部下属任务只读，当天也不能取消完成。</p>
    {stale && <p role="status">数据已变化，请重新预览后确认奖励及影响。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={cancel}>取消</button>
      <button type="button" onClick={() => { void confirmation.refresh() }}>重新预览达成</button>
      <button className="adventure-primary" type="submit" disabled={blocked || stale}>确认达成并入账</button></div>
  </fieldset></form>
}
