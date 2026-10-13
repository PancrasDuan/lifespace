import { z } from 'zod'
import { upstream } from './upstream'
import type { AiProvider } from '../src/shared/ai-status-contracts'

const regionSchema = z.object({ RegionId: z.string().regex(/^[a-z0-9-]+$/), RegionName: z.string().min(1) })
const regionsSchema = z.object({ Response: z.object({ Data: z.object({ AreaDetailList: z.array(z.object({ RegionList: z.array(regionSchema).min(1) })).min(1) }) }) })
const productSchema = z.object({ ProductId: z.string().min(1), ProductName: z.string().min(1), CurrentStatus: z.string(), ProductEventTitle: z.string() })
const snapshotSchema = z.object({ Response: z.object({ Data: z.object({
  Summary: z.object({ NormalCount: z.number().int().nonnegative(), NotifyCount: z.number().int().nonnegative(), AbnormalCount: z.number().int().nonnegative() }),
  CategoryList: z.array(z.object({ CategoryName: z.string(), ProductList: z.array(productSchema) })).min(1),
}).superRefine((data, ctx) => {
  const products = data.CategoryList.flatMap(category => category.ProductList)
  const total = data.Summary.NormalCount + data.Summary.NotifyCount + data.Summary.AbnormalCount
  if (!products.length || products.length !== total || new Set(products.map(product => product.ProductId)).size !== products.length) ctx.addIssue({ code: 'custom', message: '产品快照不完整' })
}) }) })
const labels: Record<string, string> = { NORMAL: '正常', NOTIFY: '服务提示', ABNORMAL: '异常' }
const state = (value: string): AiProvider['status'] => value === 'NORMAL' ? 'normal' : Object.hasOwn(labels, value) ? 'abnormal' : 'unknown'
const aggregate = (values: AiProvider['status'][]): AiProvider['status'] => values.includes('abnormal') ? 'abnormal' : values.includes('unknown') || !values.length ? 'unknown' : 'normal'

export async function readTencent(): Promise<Omit<AiProvider, 'id' | 'name' | 'statusUrl'>> {
  // 全地域共用截止时间，避免串行阶段各自延长请求预算。
  const signal = AbortSignal.timeout(10000)
  const init = { signal }
  const base = 'https://status.cloud.tencent.com'
  const metadata = await upstream(new URL('/v1/api/status/DescribeRegions', base), regionsSchema, init)
  const regions = metadata.Response.Data.AreaDetailList.flatMap(area => area.RegionList)
  if (regions.length > 40 || new Set(regions.map(region => region.RegionId)).size !== regions.length) throw new Error('地域目录无效')
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const checkedAt = new Date().toISOString()
  const snapshots = await Promise.all(regions.map(async region => {
    const url = new URL('/v1/api/status/DescribeProductEventForRegionInPeriod', base)
    url.search = new URLSearchParams({ RegionId: region.RegionId, EndDate: date, NumOfDay: '7' }).toString()
    const { Response } = await upstream(url, snapshotSchema, init)
    return { region, products: Response.Data.CategoryList.flatMap(category => category.ProductList) }
  }))
  const subStatuses = snapshots.map(({ region, products }) => {
    const components = products.map(product => ({ id: `${region.RegionId}:${product.ProductId}`, name: product.ProductName, status: state(product.CurrentStatus), statusLabel: Object.hasOwn(labels, product.CurrentStatus) ? labels[product.CurrentStatus] : '未知' }))
    const status = aggregate(components.map(component => component.status))
    return { id: region.RegionId, name: region.RegionName, status, statusLabel: status === 'normal' ? '正常' : status === 'abnormal' ? '存在提示或异常' : '未知', components }
  })
  const notices = snapshots.flatMap(({ region, products }) => products.filter(product => state(product.CurrentStatus) === 'abnormal').map(product => ({
    id: `${region.RegionId}:${product.ProductId}`, kind: 'component-status' as const, title: `${region.RegionName} / ${product.ProductName}`,
    status: product.CurrentStatus, description: product.ProductEventTitle.trim() || `官方当前状态：${labels[product.CurrentStatus]}；具体说明请查看腾讯云健康看板。`,
    affectedServices: [`${region.RegionName} / ${product.ProductName}`], updatedAt: null, updates: [],
  })))
  const status = aggregate(subStatuses.map(group => group.status))
  return { statusBasis: 'official-components', checkedAt, status, description: '官方全地域、全产品当前状态；服务提示计入异常，不代表个人主机健康。', incidents: notices,
    affectedServices: notices.flatMap(notice => notice.affectedServices), error: status === 'unknown' ? '部分官网产品状态无法识别' : null, subStatuses, subStatusError: null }
}
