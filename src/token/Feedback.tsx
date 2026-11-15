import { errorMessage } from './api'
import type { Resource } from './useResource'

export function Feedback({ resource, retry, label = '正在读取用量…' }: { resource: Resource<unknown>; retry: () => void; label?: string }) {
  return resource.error !== undefined ? <div className="token-feedback" role="alert"><p>{errorMessage(resource.error)}</p><button className="button" type="button" onClick={retry}>重试</button></div>
    : resource.loading ? <p className="token-loading" role="status">{label}</p> : null
}
