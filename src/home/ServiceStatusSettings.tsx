import { Modal } from './ui'
import { serviceStatusOptions, type ServiceStatusId } from './service-status-settings'

export function ServiceStatusSettings({ enabled, change, unsaved, close }: {
  enabled: readonly ServiceStatusId[]; change: (id: ServiceStatusId, checked: boolean) => void; unsaved: boolean; close: () => void
}) {
  return <Modal title="设置服务" close={close}><div className="settings-content service-status-settings">
    <p>勾选的服务同时显示在一级卡片和二级详情，整体状态只汇总这些服务。选择即时生效并保存在当前浏览器。</p>
    {unsaved && <p role="alert" className="service-preference-error">选择未保存，仅在当前页面生效。</p>}
    <div className="service-selection-options">{serviceStatusOptions.map(option => <label key={option.id}>
      <span>{option.name}</span><input type="checkbox" role="switch" aria-label={option.name} checked={enabled.includes(option.id)} onChange={event => change(option.id, event.target.checked)} />
    </label>)}</div>
    {!enabled.length && <p className="service-selection-empty">尚未选择服务，卡片将显示空态。</p>}
  </div></Modal>
}
