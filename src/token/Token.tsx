import { AppLayout } from '../app/AppLayout'
import { usePagePath } from '../app/navigation'
import { TokenDashboard } from './TokenDashboard'
import { DeviceConfirmation } from './DeviceConfirmation'
import './token.css'

export function Token() {
  const path = usePagePath()
  const confirming = path === '/token/devices/confirm'
  return <AppLayout page="token" className="token-page" title={confirming ? '确认采集设备' : 'Token 用量'}>{confirming ? <DeviceConfirmation /> : <TokenDashboard />}</AppLayout>
}
