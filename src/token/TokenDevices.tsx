import { useEffect, useRef, useState } from 'react'
import { Laptop, Monitor } from 'lucide-react'
import type { TokenDevicesPage } from '../shared/token-backend-contract'
import { useVerifiedIdentity } from '../auth/identity'
import { PageLink } from '../app/navigation'
import { disableDevice, errorMessage } from './api'
import type { Resource } from './useResource'
import { receivedTime } from './dates'
import { Feedback } from './TokenDashboard'

export function TokenDevices({ resource, deviceId, refresh }: { resource: Resource<TokenDevicesPage['devices']>; deviceId: string; refresh: () => void }) {
  const identity = useVerifiedIdentity()
  const [confirm, setConfirm] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => request.current?.abort(), [])
  const devices = resource.data?.filter(device => !deviceId || device.deviceId === deviceId)
  const disable = async (id: string) => {
    if (busy) return
    const controller = new AbortController(); request.current = controller
    const signal = AbortSignal.any([controller.signal, identity.signal])
    setBusy(true); setMessage('')
    try {
      await disableDevice(identity.ownerId, id, signal)
      if (!signal.aborted) { setMessage('设备已停用，历史用量保留。'); setConfirm(undefined); refresh() }
    } catch (error) { if (!signal.aborted) setMessage(errorMessage(error)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <section className="panel devices-panel" aria-labelledby="devices-title"><div className="panel-heading"><h2 id="devices-title">设备同步</h2><span className="small-note">{devices ? `${devices.length} 台设备` : '—'}</span></div><Feedback resource={resource} retry={refresh} label="正在读取设备…" /><div className="device-list">{devices?.map(device => <div className="device-item" key={device.deviceId}><div className="device-row"><span className="device-icon">{device.platform === 'macos' ? <Laptop size={19} /> : <Monitor size={19} />}</span><div className="device-text"><strong>{device.hostname}</strong><p>{device.platform === 'macos' ? 'macOS' : 'Linux'} · 每 {device.syncHours} 小时同步<br />{device.lastReceivedAt ? `${receivedTime(device.lastReceivedAt)} 收到报告` : '尚未收到报告'}</p></div><div className="device-actions"><span className={`device-state${device.overdue ? ' overdue' : ''}`}><i />{!device.enabled ? '已停用' : device.overdue ? '同步逾期' : '同步正常'}</span>{device.enabled && <button type="button" className="text-button" onClick={() => { setConfirm(device.deviceId); setMessage('') }}>停用</button>}</div></div>{confirm === device.deviceId && <div className="device-confirm"><p>停用 {device.hostname}？此设备将不能继续上传，历史用量保留。</p><div className="token-actions"><button type="button" className="button" disabled={busy} onClick={() => void disable(device.deviceId)}>{busy ? '正在停用…' : '确认停用'}</button><button type="button" className="button" disabled={busy} onClick={() => setConfirm(undefined)}>取消</button></div></div>}</div>)}{devices?.length === 0 && <p className="small-note">暂无设备，请在已安装的采集器终端运行 register。</p>}</div>{message && <p className="token-message" role="status">{message}</p>}<PageLink className="text-button" href="/token/devices/confirm">确认设备码</PageLink></section>
}
