import { useState } from 'react'
import { Info } from 'lucide-react'
import type { GoalAchievementPreview, PlanningGoal } from '../shared/adventure-planning'
import type { PlanningConfirmation } from './usePlanning'
import { GoalConfirmationFacts } from './GoalConfirmationFacts'

export function GoalAchievement({ preview: current, goal, confirmation, saved, cancel }: {
  preview: GoalAchievementPreview; goal?: PlanningGoal; confirmation: PlanningConfirmation; saved: () => void; cancel: () => void
}) {
  const [coefficient, setCoefficient] = useState(1)
  const [reflection, setReflection] = useState('')
  const { blocked, stale } = confirmation
  return <form onSubmit={event => {
    event.preventDefault()
    void confirmation.confirm({ type: 'achieveGoal', id: current.goalId, coefficient, reflection }, saved)
  }} className="goal-confirmation-form"><fieldset disabled={blocked}>
    <GoalConfirmationFacts title={current.title} goal={goal} />
    <ul className="goal-confirmation-standards">{current.standards.map((item, i) => <li key={i}>{item}</li>)}</ul>
    <fieldset className="goal-coefficients"><legend>本次成就感系数</legend>
      <div className="goal-coefficient-options">{[
        [1, '按历史计奖行动次数'], [2, '更有挑战的一次成果'], [3, '值得特别记住的里程碑'],
      ].map(([value, description]) => <label key={value}>
        <input type="radio" name="coefficient" value={value} checked={coefficient === value} onChange={() => setCoefficient(Number(value))} />
        <strong>{value}×</strong><small>{description}</small>
      </label>)}</div>
    </fieldset>
    <label className="goal-reflection"><span>达成感想 <small>可选，最多 4,000 个字符</small></span><textarea aria-label="达成感想（可选）" placeholder="写一句留给未来的话" rows={3} maxLength={4000} value={reflection} onChange={event => setReflection(event.target.value)} /></label>
    <p className="goal-confirmation-note"><Info size={14} aria-hidden="true" /><span>奖励沿用现有规则：按完成时归属的有效计奖行动计算，零行动时固定 1 点；确认后冻结。</span></p>
    {stale && <p role="status">数据已变化，请重新预览后确认奖励及影响。</p>}
    <div className="adventure-form-footer"><button type="button" onClick={cancel}>取消</button>
      {stale && <button type="button" onClick={() => { void confirmation.refresh() }}>重新预览达成</button>}
      <button className="adventure-primary" type="submit" aria-label="确认达成并入账" disabled={blocked || stale}>确认达成</button></div>
  </fieldset></form>
}
