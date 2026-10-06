import { Modal } from '../home/ui'
import type { NewsSource } from '../shared/news-sources'

export function NewsSourceSettings({ sources, enabled, change, unsaved, close }: {
  sources: readonly NewsSource[]; enabled: readonly string[]; change: (id: string, checked: boolean) => void; unsaved: boolean; close: () => void
}) {
  return <Modal title="新闻来源设置" close={close}><div className="settings-content news-source-settings">
    <p>开关即时生效，选择保存在当前浏览器。</p>
    {unsaved && <p role="alert" className="news-error">来源选择未保存，仅在当前页面生效。</p>}
    <div className="news-source-options">{sources.map(source => <label key={source.id}>
      <img className="news-source-icon" src={'/news-icons/' + source.id.split('-')[0] + '.png'} alt="" width={24} height={24} />
      <span>{source.label}</span><input type="checkbox" role="switch" aria-label={source.label} checked={enabled.includes(source.id)} onChange={event => change(source.id, event.target.checked)} />
    </label>)}</div>
  </div></Modal>
}
