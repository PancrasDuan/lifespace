import xaiCatalogue from '../src/shared/xai-modules.json'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const xaiModuleGroups = xaiCatalogue.groups

export function xaiEventSubStatuses(affected: ReadonlyMap<string, string> | null): AiProvider['subStatuses'] {
  const known = new Set<string>(xaiModuleGroups.flatMap(group => group.modules.map(module => module.id)))
  const groups: Array<{ id: string; name: string; modules: Array<{ id: string; name: string }> }> = xaiModuleGroups.map(group => ({ ...group, modules: [...group.modules] }))
  const extras = affected ? [...affected].filter(([id]) => !known.has(id)).map(([id, name]) => ({ id, name })) : []
  if (extras.length) groups.push({ id: 'other', name: '其他模块', modules: extras })
  return groups.map(group => {
    const components = group.modules.map(module => {
      const status = affected === null ? 'unknown' as const : affected.has(module.id) ? 'abnormal' as const : 'normal' as const
      return { ...module, status, statusLabel: status === 'unknown' ? '未知' : status === 'abnormal' ? '异常' : '可用' }
    })
    const status = affected === null ? 'unknown' as const : components.some(component => component.status === 'abnormal') ? 'abnormal' as const : 'normal' as const
    return { id: group.id, name: group.name, status, statusLabel: status === 'unknown' ? '未知' : status === 'abnormal' ? '异常' : '可用', components }
  })
}
