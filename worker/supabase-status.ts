import { readIncidentPage } from './incident-page-status'

export const readSupabase = () => readIncidentPage('https://status.supabase.com/proxy/status.supabase.com', '官方全平台状态，覆盖产品与区域，不代表具体项目健康。')
