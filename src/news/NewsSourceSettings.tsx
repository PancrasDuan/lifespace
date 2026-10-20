import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Modal } from '../home/ui'
import type { NewsSource } from '../shared/news-sources'

export function NewsSourceSettings({ sources, enabled, change, unsaved, close, resetOrder, orderUnsaved }: {
  sources: readonly NewsSource[]; enabled: readonly string[]; change: (id: string, checked: boolean) => void; unsaved: boolean; close: () => void
  resetOrder: () => void; orderUnsaved: boolean
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const resetButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (confirmReset) confirmButton.current?.focus({ preventScroll: true }) }, [confirmReset])
  const finishReset = () => {
    setConfirmReset(false)
    requestAnimationFrame(() => resetButton.current?.focus({ preventScroll: true }))
  }
  return <Modal title="新闻来源设置" close={close}><div className="settings-content news-source-settings">
    <p>开关即时生效，选择保存在当前浏览器。</p>
    {unsaved && <p role="alert" className="news-error">来源选择未保存，仅在当前页面生效。</p>}
    <div className="news-source-options">{sources.map(source => <label key={source.id}>
      <img className="news-source-icon" src={'/news-icons/' + source.id.split('-')[0] + '.png'} alt="" width={24} height={24} />
      <span>{source.label}</span><input type="checkbox" role="switch" aria-label={source.label} checked={enabled.includes(source.id)} onChange={event => change(source.id, event.target.checked)} />
    </label>)}</div>
    <div className="news-order-settings"><span>卡片顺序</span>
      {confirmReset ? <div className="news-order-confirm"><p id="news-order-confirmation">恢复默认顺序？来源开关保持不变。</p>
        <div><button onClick={finishReset}>取消</button><button ref={confirmButton} className="news-order-confirm-button" aria-describedby="news-order-confirmation" onClick={() => { resetOrder(); finishReset() }}>确认恢复</button></div>
      </div> : <button ref={resetButton} onClick={() => setConfirmReset(true)}><RotateCw size={14} />恢复默认顺序</button>}
    </div>
    {orderUnsaved && <p role="alert" className="news-order-error">卡片顺序未保存，仅在当前页面生效。</p>}
  </div></Modal>
}
