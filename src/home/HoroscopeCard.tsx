import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { api } from './api'
import { Modal, Panel } from './ui'
import { beijingDate, horoscopeDeadline, fortuneDimensions, isCurrentHoroscope, zodiacSigns, type HoroscopeResult, type ZodiacSign } from '../shared/horoscope-contracts'
import './horoscope.css'

export function HoroscopeCard({ now }: { now: Date }) {
  const [selected, select] = useState<ZodiacSign | null>(null)
  return <><Panel kind="horoscope"><div className="zodiac-grid">{zodiacSigns.map(sign => <button key={sign.id} type="button" onClick={() => select(sign.id)} aria-label={sign.name}><span aria-hidden="true">{sign.icon}</span>{sign.name}</button>)}</div></Panel>
    {selected && <HoroscopeDialog key={selected} sign={selected} now={now.getTime()} close={() => select(null)} />}</>
}

function HoroscopeDialog({ sign, now, close }: { sign: ZodiacSign; now: number; close: () => void }) {
  const [back, showBack] = useState(false)
  const [wakeTime, setWakeTime] = useState(now)
  useEffect(() => {
    const wake = () => setWakeTime(Date.now())
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => { window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake) }
  }, [])
  const effectiveNow = Math.max(now, wakeTime)
  const date = beijingDate(effectiveNow)
  useEffect(() => {
    const timer = window.setTimeout(() => setWakeTime(Date.now()), Math.max(0, horoscopeDeadline(date) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [date])
  const selected = zodiacSigns.find(item => item.id === sign)!
  const query = useQuery({ queryKey: ['horoscope', sign, date], queryFn: ({ signal }) => api.horoscope(sign, signal),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const data = query.data && isCurrentHoroscope(query.data, sign, effectiveNow) ? query.data : undefined
  const frontButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  function flip(next: boolean) {
    showBack(next)
    requestAnimationFrame(() => (next ? backButton : frontButton).current?.focus({ preventScroll: true }))
  }
  useEffect(() => { showBack(false) }, [date])
  return <Modal title={`${selected.name} · 今日运势`} close={close} className="horoscope-modal">
    {!data ? <div className="horoscope-state" role="status"><p>{query.isFetching ? '正在读取今日运势…' : query.error instanceof Error ? query.error.message : '今日运势暂未更新'}</p>{!query.isFetching && <button className="horoscope-action" onClick={() => { void query.refetch() }}>重新读取</button>}</div>
      : <div className={`fortune-stage${back ? ' is-back' : ''}`}><div className="fortune-turn">
        <section className="fortune-face fortune-front" aria-hidden={back} inert={back}>
          <div className="fortune-scroll"><div className="fortune-identity"><div><span className="eyebrow">DAILY HOROSCOPE</span><h3>{selected.name}</h3><p>{date} · 北京时间</p></div><span className="fortune-symbol" aria-hidden="true">{selected.icon}</span></div>
            <div className="fortune-overall"><span>综合指数</span><strong>{data.scores.all ?? '—'}<small>{data.scores.all === null ? '暂无指标' : '/ 100'}</small></strong></div>
            <div className="fortune-scores">{fortuneDimensions.filter(item => item.id !== 'all').map(item => <div key={item.id}><span>{item.id === 'work' ? '事业' : item.name}</span><strong>{data.scores[item.id] ?? '—'}</strong><meter aria-label={`${item.name}指数`} min="0" max="100" value={data.scores[item.id] ?? 0} /><small>{data.scores[item.id] === null ? '暂无指标' : '/ 100'}</small></div>)}</div>
            <dl className="fortune-lucky"><div><dt>幸运色</dt><dd>{data.lucky.color ?? '暂无内容'}</dd></div><div><dt>幸运数字</dt><dd>{data.lucky.number ?? '暂无内容'}</dd></div><div><dt>幸运星座</dt><dd>{data.lucky.sign ?? '暂无内容'}</dd></div></dl>
          </div><FortuneFooter data={data}><button ref={frontButton} className="horoscope-action" onClick={() => flip(true)}>查看详情<ArrowUpRight size={15} aria-hidden="true" /></button></FortuneFooter>
        </section>
        <section className="fortune-face fortune-back" aria-hidden={!back} inert={!back}>
          <div className="fortune-scroll" tabIndex={back ? 0 : -1} aria-label="运势文字解读"><div className="fortune-reading-title"><span aria-hidden="true">{selected.icon}</span><div><h3>{selected.name} · 文字解读</h3><p>{date} · 北京时间</p></div></div>
            {data.notice && <p className="fortune-notice">{data.notice}</p>}
            {fortuneDimensions.map(item => <section className="fortune-text" key={item.id}><h4>{item.name}</h4><p>{data.texts[item.id] ?? '暂无内容'}</p></section>)}
            <div className="fortune-almanac"><p><b>宜</b>{data.yi ?? '暂无内容'}</p><p><b>忌</b>{data.ji ?? '暂无内容'}</p></div>
          </div><FortuneFooter data={data}><button ref={backButton} className="horoscope-action" onClick={() => flip(false)}><ArrowLeft size={15} aria-hidden="true" />返回</button></FortuneFooter>
        </section>
      </div></div>}
  </Modal>
}
function FortuneFooter({ data, children }: { data: HoroscopeResult; children: React.ReactNode }) {
  return <footer className="fortune-footer"><div>{data.warning && <small>{data.warning}</small>}</div>{children}</footer>
}
