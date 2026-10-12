import { Activity, CalendarDays, Clock3, CloudSun, Globe, ListTodo, Search, Settings2, UserRound } from 'lucide-react'
import { AppLayout } from '../app/AppLayout'
import './home-skeleton.css'

const cards = [
  { kind: 'time', title: '世界时间', icon: Clock3 },
  { kind: 'weather', title: '今日天气', icon: CloudSun },
  { kind: 'tasks', title: '今日待办', icon: ListTodo },
  { kind: 'calendar', title: '日期与黄历', icon: CalendarDays },
  { kind: 'domains', title: 'DNSHE 域名', icon: Globe },
  { kind: 'ai', title: 'AI 服务状态', icon: Activity },
]

// Only the public page shape is rendered; Home's data and location hooks stay unmounted.
export function HomeSkeleton() {
  return <section className="auth-loading" role="status" aria-label="正在确认访问资格" aria-busy="true">
    <span className="skeleton-sr-only">正在确认访问资格，请稍候。</span>
    <div inert aria-hidden="true">
      <div className="auth-account"><button className="auth-avatar" disabled tabIndex={-1}><UserRound size={18} /></button></div>
      <AppLayout page="home"><div className="auth-home-skeleton">
        <header className="masthead">
          <div className="page-kicker"><span className="live-dot" />我的每日空间</div>
          <button className="top-settings" disabled><Settings2 size={18} /></button>
          <h1 className="wordmark">Life<span>Space</span><i /></h1><p className="header-date">把今天放在眼前</p>
          <div className="search-box"><span className="google-mark">G</span><span className="skeleton-bar skeleton-search" /><span className="search-hint">Google</span><Search size={20} /></div>
        </header>
        <div className="glass-grid">{cards.map(({ kind, title, icon: Icon }) => <article className={`info-panel panel-${kind}`} key={kind}>
          <div className="panel-heading"><span><Icon size={17} /><h2>{title}</h2></span></div>
          <div className="skeleton-card-content"><span className="skeleton-bar skeleton-value" /><span className="skeleton-bar" /><span className="skeleton-bar skeleton-short" /></div>
          <div className="panel-footer"><span className="skeleton-bar skeleton-footer" /></div>
        </article>)}</div>
        <p className="page-note">生活有自己的节奏，今天也一样。</p>
      </div></AppLayout>
    </div>
  </section>
}
