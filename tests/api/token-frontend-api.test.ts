import { beforeEach, expect, test, vi } from 'vitest'
import { authorizedFetch } from '../../src/auth/request'
import { readUsage, readDevices, readSummary, TokenError } from '../../src/token/api'
import { fixtureRows, fixtureDevices } from '../fixtures/token-dashboard/fixture'

vi.mock('../../src/auth/request', () => ({ authorizedFetch: vi.fn(), authorizedMutation: vi.fn() }))
const fetch = vi.mocked(authorizedFetch)
const signal = new AbortController().signal
beforeEach(() => fetch.mockReset())

test('usage follows all cursors with unchanged filters and verified identity', async () => {
  fetch.mockResolvedValueOnce(Response.json({ timeZone: 'Asia/Shanghai', scope: 'main', rows: [fixtureRows[0]], nextCursor: 'first' }))
    .mockResolvedValueOnce(Response.json({ timeZone: 'Asia/Shanghai', scope: 'main', rows: [fixtureRows[1]], nextCursor: 'second' }))
    .mockResolvedValueOnce(Response.json({ timeZone: 'Asia/Shanghai', scope: 'main', rows: [fixtureRows[2]], nextCursor: null }))
  const query = { startDate: '2026-01-01', endDate: '2026-12-31', deviceId: 'mac', agent: 'codex' }
  expect(await readUsage('owner', query, signal)).toHaveLength(3)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls.map(([path]) => new URL(path, 'https://test.invalid').searchParams.get('after'))).toEqual([null, 'first', 'second'])
  for (const [path, passedSignal, owner] of fetch.mock.calls) {
    expect(Object.fromEntries(new URL(path, 'https://test.invalid').searchParams)).toMatchObject(query)
    expect(passedSignal).toBe(signal); expect(owner).toBe('owner')
  }
})
test('device pagination includes the final page; repeated cursor fails closed', async () => {
  fetch.mockResolvedValueOnce(Response.json({ devices: [fixtureDevices[0]], nextCursor: 'mac', serverTime: '2026-11-15T06:32:00Z' }))
    .mockResolvedValueOnce(Response.json({ devices: [fixtureDevices[1]], nextCursor: null, serverTime: '2026-11-15T06:32:00Z' }))
  expect(await readDevices('owner', signal)).toHaveLength(2)
  fetch.mockImplementation(async () => Response.json({ devices: [], nextCursor: 'loop', serverTime: '2026-11-15T06:32:00Z' }))
  await expect(readDevices('owner', signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' })
})
test('incomplete/malformed pages never become successful empty data', async () => {
  fetch.mockResolvedValue(Response.json({ rows: [], nextCursor: null }))
  await expect(readUsage('owner', { startDate: '2026-01-01', endDate: '2026-01-01' }, signal)).rejects.toBeInstanceOf(TokenError)
})
test('query-too-broad and access errors retain actionable codes', async () => {
  for (const code of ['TOKEN_QUERY_TOO_BROAD', 'AUTH_REQUIRED', 'AUTH_DENIED']) {
    fetch.mockResolvedValue(Response.json({ error: { code } }, { status: 400 }))
    await expect(readSummary('owner', { startDate: '2026-01-01', endDate: '2026-01-01' }, signal)).rejects.toMatchObject({ code })
  }
})
