import { AppLayout } from '../app/AppLayout'
import { usePagePath } from '../app/navigation'
import { TokenDashboard } from './TokenDashboard'
import { DeviceConfirmation } from './DeviceConfirmation'
import './token.css'

export function Token() {
  const path = usePagePath()
  return <AppLayout page="token" className="token-page">{path === '/token/devices/confirm' ? <DeviceConfirmation /> : <TokenDashboard />}</AppLayout>
}
