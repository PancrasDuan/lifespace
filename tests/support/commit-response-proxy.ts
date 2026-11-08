import { createServer, connect, type Socket } from 'node:net'
import { once } from 'node:events'

// Drop a real COMMIT acknowledgement after a write, while allowing the Agent's
// preceding read-only authentication transaction to complete normally.
export async function dropCommitResponse(connectionString: string) {
  const target = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1' || target.username !== 'lifespace_worker' || target.pathname !== '/postgres' || target.search || target.hash) throw new Error('提交代理仅允许 runner 的本机隔离数据库')
  const sockets = new Set<Socket>()
  let dropped = 0
  const server = createServer(client => {
    const upstream = connect(Number(target.port), target.hostname)
    client.setNoDelay(true)
    upstream.setNoDelay(true)
    sockets.add(client); sockets.add(upstream)
    client.pipe(upstream)
    let pending = Buffer.alloc(0), wrote = false
    upstream.on('data', chunk => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 5) {
        const length = pending.readInt32BE(1) + 1
        if (length < 5 || length > 32 * 1024 * 1024) { client.destroy(); upstream.destroy(); return }
        if (pending.length < length) return
        const frame = pending.subarray(0, length)
        pending = pending.subarray(length)
        if (frame[0] === 67) { // CommandComplete
          const command = frame.subarray(5, -1).toString('utf8')
          if (command === 'BEGIN') wrote = false
          if (/^(INSERT|UPDATE|DELETE)\b/.test(command)) wrote = true
          if (command === 'COMMIT' && wrote && dropped === 0) {
            dropped++
            client.destroy(); upstream.destroy(); return
          }
        }
        client.write(frame)
      }
    })
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => { sockets.delete(client); upstream.destroy() })
    upstream.on('close', () => { sockets.delete(upstream); client.destroy() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('提交代理端口未就绪')
  const proxied = new URL(target)
  proxied.port = String(address.port)
  return {
    connectionString: proxied.href,
    droppedCommits: () => dropped,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
