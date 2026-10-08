// 只读取 iTab 公开日历数据模块，对照本项目已安装的 tyme4ts。
// 运行：node docs/evidence/itab-calendar/compare-public-tyme.mjs
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import * as local from 'tyme4ts'

const url = 'https://go.itab.link/assets/vendor-tyme4ts-D81ry8hI.js'
const response = await fetch(url)
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const source = await response.text()
const directory = await mkdtemp(join(tmpdir(), 'itab-calendar-'))
try {
  const file = join(directory, 'public-tyme.mjs')
  await writeFile(file, source)
  const remote = await import(pathToFileURL(file).href)
  const packageInfo = JSON.parse(await readFile('node_modules/tyme4ts/package.json', 'utf8'))
  const compareConstants = Object.fromEntries(['LegalHoliday', 'SolarFestival', 'LunarFestival', 'EventManager'].map(name => [name, {
    dataEqual: remote[name].DATA === local[name].DATA,
    namesEqual: JSON.stringify(remote[name].NAMES) === JSON.stringify(local[name].NAMES),
  }]))
  for (const library of [local, remote]) {
    library.EventManager.update('母亲节', library.Event.builder().solarWeek(5, 2, 0).name('母亲节').build())
    library.EventManager.update('父亲节', library.Event.builder().solarWeek(6, 3, 0).name('父亲节').build())
  }
  function dayData(library, year, month, day) {
    const solar = library.SolarDay.fromYmd(year, month, day)
    const lunar = solar.getLunarDay()
    const stem = lunar.getSixtyCycle().getHeavenStem()
    const holiday = library.LegalHoliday.fromYmd(year, month, day)
    return {
      lunar: lunar.toString(), yearCycle: lunar.getYearSixtyCycle().getName(),
      phase: lunar.getPhase().getName(), phenology: solar.getPhenology().getName(),
      recommends: lunar.getRecommends().map(item => item.getName()),
      avoids: lunar.getAvoids().map(item => item.getName()),
      positions: [stem.getJoyDirection(), stem.getYangDirection(), stem.getYinDirection(), stem.getMascotDirection(), stem.getWealthDirection()].map(item => item.getName()),
      constellation: solar.getConstellation().getName(),
      solarFestival: solar.getFestival()?.getName(), lunarFestival: lunar.getFestival()?.getName(),
      events: library.Event.fromSolarDay(solar).map(item => item.getName()),
      term: solar.getTermDay().getSolarTerm().getName(), termDay: solar.getTermDay().getDayIndex(),
      nine: solar.getNineDay()?.getName(), dog: solar.getDogDay()?.getName(),
      weekMonday: solar.getSolarWeek(1).getIndexInYear(), weekSunday: solar.getSolarWeek(0).getIndexInYear(),
      holiday: holiday ? { name: holiday.getName(), isWork: holiday.isWork() } : null,
    }
  }
  const differences = []
  let days = 0
  for (let date = new Date(2026, 0, 1); date.getFullYear() === 2026; date.setDate(date.getDate() + 1)) {
    const values = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    const expected = dayData(remote, ...values), actual = dayData(local, ...values)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) differences.push({ date: values.join('-'), expected, actual })
    days++
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: url, sourceSha256: createHash('sha256').update(source).digest('hex'), localVersion: packageInfo.version, localLicense: packageInfo.license, compareConstants, days, differenceCount: differences.length, differences }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
