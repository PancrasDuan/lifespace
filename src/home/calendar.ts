import { Event, EventManager, SolarDay, SolarMonth } from 'tyme4ts'

// iTab 额外显示的按星期计算的节日；历法库负责其日期计算。
EventManager.update('母亲节', Event.builder().name('母亲节').solarWeek(5, 2, 0).build())
EventManager.update('父亲节', Event.builder().name('父亲节').solarWeek(6, 3, 0).build())

export type WeekStart = 0 | 1
// 完整黄历依赖相邻年份，避开历法库两端的内部越界。
export const calendarYearRange = { min: 3, max: 9998 }
export const solarFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return SolarDay.fromYmd(year, month, day)
}
export const solarKey = (solar: SolarDay) => `${String(solar.getYear()).padStart(4, '0')}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`

export function calendarCell(solar: SolarDay) {
  const lunar = solar.getLunarDay()
  const term = solar.getTermDay()
  const solarFestival = solar.getFestival()
  const lunarFestival = lunar.getFestival()
  const events = Event.fromSolarDay(solar)
  let label = lunar.getDay() === 1 ? lunar.getLunarMonth().getName() : lunar.getName()
  let special = false
  if (term.getDayIndex() === 0) { label = term.getSolarTerm().getName(); special = true }
  if (solarFestival) { label = solarFestival.getName(); special = true }
  else if (events.length) { label = events[0].getName(); special = true }
  if (solar.getMonth() === 10 && solar.getDay() === 31) { label = '万圣夜'; special = true }
  if (solar.getMonth() === 11 && solar.getDay() === 1) { label = '万圣节'; special = true }
  if (lunarFestival) { label = lunarFestival.getName(); special = true }
  const holiday = solar.getLegalHoliday()
  return { key: solarKey(solar), solar, label, special, holiday: holiday ? (holiday.isWork() ? '班' : '休') : null }
}

export function calendarMonth(selected: SolarDay, weekStart: WeekStart) {
  const first = selected.getSolarMonth().getFirstDay()
  const offset = (first.getWeek().getIndex() - weekStart + 7) % 7
  return Array.from({ length: 42 }, (_, index) => {
    // 完整黄历的边界月份不提供范围外的可选日期。
    const day = first.next(index - offset)
    return day.getYear() >= calendarYearRange.min && day.getYear() <= calendarYearRange.max ? calendarCell(day) : null
  })
}

export function changeCalendarMonth(year: number, month: number) {
  return SolarMonth.fromYm(year, month).getFirstDay()
}

function calendarWeek(solar: SolarDay, weekStart: WeekStart) {
  try { return solar.getSolarWeek(weekStart).getIndexInYear() + 1 }
  catch {
    // 1582 年改革月的后几周在库内越界，以真实连续日期计算周次。
    const first = SolarDay.fromYmd(solar.getYear(), 1, 1)
    const offset = (first.getWeek().getIndex() - weekStart + 7) % 7
    return Math.floor((solar.getIndexInYear() + offset) / 7) + 1
  }
}

const chineseDigits = '〇一二三四五六七八九'
const zodiacSymbols: Record<string, string> = { 白羊座: '♈', 金牛座: '♉', 双子座: '♊', 巨蟹座: '♋', 狮子座: '♌', 处女座: '♍', 天秤座: '♎', 天蝎座: '♏', 射手座: '♐', 摩羯座: '♑', 水瓶座: '♒', 双鱼座: '♓' }

export function calendarDetail(solar: SolarDay, weekStart: WeekStart, today: SolarDay) {
  const lunar = solar.getLunarDay()
  const stem = lunar.getSixtyCycle().getHeavenStem()
  const zodiac = lunar.getYearSixtyCycle().getEarthBranch().getZodiac().getName()
  const constellation = solar.getConstellation().getName() + '座'
  const festivals = [lunar.getFestival()?.getName(), solar.getFestival()?.getName(), ...Event.fromSolarDay(solar).map(event => event.getName())]
  if (solar.getTermDay().getDayIndex() === 0) festivals.push(solar.getTerm().getName())
  const nine = solar.getNineDay(), dog = solar.getDogDay()
  if (nine) festivals.push(nine.getName())
  if (dog) festivals.push(dog.getName())
  return {
    key: solarKey(solar), day: solar.getDay(), weekday: `周${solar.getWeek().getName()}`,
    lunar: `${String(solar.getYear()).split('').map(digit => chineseDigits[Number(digit)]).join('')}年${lunar.getLunarMonth().getName()}${lunar.getName()}`,
    year: `${lunar.getYearSixtyCycle().getName()}(${zodiac})年`, zodiac, constellation, constellationSymbol: zodiacSymbols[constellation] ? zodiacSymbols[constellation] + '\uFE0F' : '',
    week: calendarWeek(solar, weekStart), dayOfYear: solar.getIndexInYear() + 1,
    distance: solar.subtract(today), festivals: festivals.filter((name): name is string => Boolean(name)),
    recommends: lunar.getRecommends().map(item => item.getName()).join('，'),
    avoids: lunar.getAvoids().map(item => item.getName()).join('，'),
    phase: lunar.getPhase().getName().replace(/月$/, '').replace(/^新$/, '朔').replace(/^满$/, '望') + '月',
    phenology: solar.getPhenology().getName(),
    directions: [
      ['喜神方位', stem.getJoyDirection().getName()], ['阳贵神方位', stem.getYangDirection().getName()],
      ['阴贵神方位', stem.getYinDirection().getName()], ['福神方位', stem.getMascotDirection().getName()], ['财神方位', stem.getWealthDirection().getName()],
    ],
  }
}
