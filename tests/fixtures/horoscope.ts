// 独立测试数据，不进入正式服务回退逻辑。
export const alapiDay = (date = '2026-10-22') => ({
  date, all: '85%', love: '87%', work: '88%', money: '70%', health: '71%',
  lucky_color: '墨绿色', lucky_number: '9', lucky_star: '狮子座',
  notice: '保持现有的节奏', yi: '整理计划', ji: '熬夜',
  all_text: '稳住节奏，踏实推进。', love_text: '认真倾听身边的人。',
  work_text: '把注意力放在当前目标。', money_text: '保持理性，按计划消费。', health_text: '适当休息和运动。',
})
export const alapiSuccess = (date = '2026-10-22') => ({ success: true, code: 200, data: { day: alapiDay(date) } })
