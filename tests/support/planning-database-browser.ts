import { expect, type BrowserContext } from '@playwright/test'
import { planningReceiptSchema } from '../../src/shared/adventure-planning'
import { growthPageSchema } from '../../src/shared/adventure-growth'
import { localPlanningRpc, planningDatabase } from './planning-database'
import { adventureClientVersionHeader } from '../../src/shared/adventure-client-version'

export { localPlanningRpc }

// Only identity is controlled; all business requests use the real Worker and local RPC.
export function planningDatabaseBrowser() {
  const database = planningDatabase('actions@example.invalid')
  let owner = crypto.randomUUID()
  const request = (path: string, body?: unknown) => database.request(owner, path, body)
  const snapshot = (query = '') => database.read(owner, query)
  return {
    request, snapshot,
    createHistoricalTask: (command: Parameters<typeof database.createHistoricalTask>[1], completedOn?: string) => database.createHistoricalTask(owner, command, completedOn),
    async install(context: BrowserContext, options?: { afterCommand?: () => Promise<void> }) {
      owner = crypto.randomUUID()
      database.install({ browserOwner: owner })
      await context.route('**/api/adventure**', async route => {
        const input = route.request(), url = new URL(input.url())
        const response = await database.request(owner, url.pathname + url.search, input.method() === 'GET' ? undefined : input.postDataJSON(), input.headers()[adventureClientVersionHeader.toLowerCase()] ?? null)
        if (url.pathname === '/api/adventure/commands') await options?.afterCommand?.()
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
      })
    },
    restore: database.restore,
    async write(command: unknown) {
      const response = await request('/api/adventure/commands', { expectedVersion: (await snapshot()).version, requestId: crypto.randomUUID(), command })
      expect(response.status).toBe(200)
      return planningReceiptSchema.parse(await response.json())
    },
    async growth() {
      const response = await request('/api/adventure/growth')
      expect(response.status).toBe(200)
      return growthPageSchema.parse(await response.json())
    },
  }
}
