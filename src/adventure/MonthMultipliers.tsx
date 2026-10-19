import type { CycleMonth } from '../shared/adventure/model'

// 领域的 multiplier 是累计值；旧记录缺少 appliedMultiplier 时不能推断历史实际使用值。
export type MonthMultipliers = Pick<CycleMonth, 'multiplier'> & {
  appliedMultiplier?: string
}
export const cumulativeMultiplier = (month: MonthMultipliers) =>
  month.multiplier
export const appliedMultiplier = (month: MonthMultipliers) =>
  month.appliedMultiplier
export const displayMultiplier = (value: string | undefined) =>
  value ? `×${value}` : '未单独记录'

export function MonthMultiplierDetails({ month }: { month: MonthMultipliers }) {
  return (
    <>
      <p>累计长期系数 {displayMultiplier(cumulativeMultiplier(month))}</p>
      {month.appliedMultiplier ? (
        <p>本期实际适用系数 ×{month.appliedMultiplier}</p>
      ) : (
        <p>本期实际适用系数未单独记录，请以原始计算过程为准。</p>
      )}
    </>
  )
}
