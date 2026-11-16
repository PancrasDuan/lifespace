// Child process: late stream errors must fail the test, without a global handler.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { syncBuiltinESMExports } from 'node:module'
import zlib, { zstdCompressSync } from 'node:zlib'
const { inventory, assessCoverage } = await import(process.argv[2] ?? new URL('../../tools/token-collector/dist/tools/token-collector/coverage.js', import.meta.url).href)

const root = await mkdtemp(join(tmpdir(), 'token-coverage-stream-'))
const sessions = join(root, '.codex/sessions')
await mkdir(sessions, { recursive: true })
const source = join(sessions, 'synthetic.jsonl.zst')
const envelope = index => JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'synthetic', index } }) + '\n'
try {
  const descriptorsBefore = (await readdir('/dev/fd')).length
  for (let index = 0; index < 100; index++) {
    const original = envelope(index)
    await writeFile(source, zstdCompressSync(Buffer.from(original)))
    const initial = await inventory(root)
    const prior = initial.files.map(({ path, hash, size, dates }) => ({ path, hash, size, dates, coverageVersion: 1 }))
    await writeFile(source, zstdCompressSync(Buffer.from(original + envelope(index + 1))))
    const current = await inventory(root)
    assert.deepEqual([...(await assessCoverage(prior, current, current, ['2026-01-01'])).blocked], [])
    const wrong = prior.map(proof => ({ ...proof, hash: '0'.repeat(64) }))
    assert.deepEqual([...(await assessCoverage(wrong, current, current, ['2026-01-01'])).blocked], ['2026-01-01'])
    await setImmediate()
  }
  const prefix = envelope(0), large = prefix + envelope(1).repeat(100000)
  await writeFile(source, zstdCompressSync(Buffer.from(prefix)))
  const prior = (await inventory(root)).files.map(({ path, hash, size, dates }) => ({ path, hash, size, dates, coverageVersion: 1 }))
  await writeFile(source, zstdCompressSync(Buffer.from(large)))
  const current = await inventory(root)
  const createDecompress = zlib.createZstdDecompress
  const factoryDescriptor = Object.getOwnPropertyDescriptor(zlib, 'createZstdDecompress')
  let decodedBytes = 0
  Object.defineProperty(zlib, 'createZstdDecompress', { ...factoryDescriptor, value: (...args) => {
    const decoder = createDecompress(...args), push = decoder.push
    // Observe actual output without changing chunks, backpressure or errors.
    decoder.push = function (chunk, ...rest) { if (chunk) decodedBytes += chunk.length; return push.call(this, chunk, ...rest) }
    return decoder
  } })
  syncBuiltinESMExports()
  try {
    assert.deepEqual([...(await assessCoverage(prior, current, current, ['2026-01-01'])).blocked], [])
    assert(decodedBytes > 0 && decodedBytes < Buffer.byteLength(large), 'A short prefix check decoded the entire archive')
  } finally { Object.defineProperty(zlib, 'createZstdDecompress', factoryDescriptor); syncBuiltinESMExports() }
  assert.equal((await readdir('/dev/fd')).length, descriptorsBefore, 'Prefix checks leaked file descriptors')
  await writeFile(source, Buffer.from('invalid zstd'))
  assert.equal((await inventory(root)).uncertain, true)
  const valid = zstdCompressSync(Buffer.from(envelope(0)))
  await writeFile(source, valid.subarray(0, valid.length - 2))
  assert.equal((await inventory(root)).uncertain, true)
  await writeFile(source, valid)
  await chmod(source, 0o000)
  try { assert.equal((await inventory(root)).uncertain, true, 'Real filesystem read failure must remain unconfirmed') }
  finally { await chmod(source, 0o600) }
  await setImmediate()
  assert.equal((await readdir('/dev/fd')).length, descriptorsBefore, 'Failed reads leaked file descriptors')
  console.log(JSON.stringify({ iterations: 100, appendAccepted: true, wrongPrefixRejected: true, prefixReadBounded: true, malformedCompressedSourceRejected: true, truncatedCompressedSourceRejected: true, readFailureRejected: true, fileDescriptorsClosed: true }))
} finally { await rm(root, { recursive: true, force: true }) }
