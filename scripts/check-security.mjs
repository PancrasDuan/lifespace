import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createBuilder, createServer, createLogger } from 'vite'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'

// 使用隔离副本与虚构凭据，不读取本地 .dev.vars，不调用真实 DNSHE / Supabase。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const markers = {
  DNSHE_API_KEY: 'cfsd_SECURITY_TEST_KEY_20261006',
  DNSHE_API_SECRET: 'SECURITY_TEST_DNSHE_SECRET_20261006',
  SUPABASE_SECRET_KEY: 'sb_secret_SECURITY_TEST_SUPABASE_20261006',
}
// 父进程同时检查原生构建器直接写入 stdout/stderr 的内容。
if (process.env.LIFESPACE_SECURITY_CHILD !== '1') {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: root, env: { ...process.env, LIFESPACE_SECURITY_CHILD: '1' }, encoding: 'utf8', timeout: 90000, maxBuffer: 4000000,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (Object.values(markers).some(marker => output.includes(marker))) {
    await rm(resolve(root, '.cache/security-report.json'), { force: true })
    console.error('安全验证未通过：运行输出包含虚构凭据，原始内容已隐藏。')
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(output.trim() || '安全验证进程失败或超时。')
    process.exit(1)
  }
  console.log(output.split('\n').filter(line => line.startsWith('通过：')).join('\n'))
  process.exit(0)
}
const fixture = await mkdtemp(resolve(await realpath(tmpdir()), 'lifespace-security-'))
const originalCwd = process.cwd()
const checks = []
const logs = []
const stdoutWrite = process.stdout.write.bind(process.stdout)
const stderrWrite = process.stderr.write.bind(process.stderr)
const restoreOutput = () => { process.stdout.write = stdoutWrite; process.stderr.write = stderrWrite }
// 收集整个隔离运行的输出，包括运行时日志；不直接打印可能含凭据的原始内容。
for (const stream of [process.stdout, process.stderr]) stream.write = (chunk, encoding, callback) => {
  logs.push(String(chunk))
  const done = typeof encoding === 'function' ? encoding : callback
  if (done) queueMicrotask(done)
  return true
}
const logger = createLogger('silent')
for (const method of ['info', 'warn', 'warnOnce', 'error']) logger[method] = message => { logs.push(String(message)) }
const assertClean = (text, label) => {
  assert(!Object.values(markers).some(marker => String(text).includes(marker)), `${label}含虚构凭据，隔离失败`)
}
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
    else throw new Error('公开资源目录中存在非普通文件')
  }
  return result
}
let devServer, runtime
try {
  for (const path of ['src', 'worker', 'index.html', 'package.json', 'vite.config.ts', 'wrangler.jsonc']) {
    await cp(resolve(root, path), resolve(fixture, path), { recursive: true })
  }
  await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir')
  await writeFile(resolve(fixture, '.dev.vars'), Object.entries(markers).map(([key, value]) => `${key}=${value}`).join('\n'))
  await writeFile(resolve(fixture, '.env.private'), `SECRET=${markers.DNSHE_API_SECRET}`)
  process.chdir(fixture)
  await (await createBuilder({ configFile: resolve(fixture, 'vite.config.ts'), customLogger: logger })).buildApp()
  const generated = JSON.parse(await readFile(resolve(fixture, 'dist/lifespace/wrangler.json'), 'utf8'))
  const publicDir = resolve(fixture, 'dist/lifespace', generated.assets.directory)
  assert.equal(publicDir, resolve(fixture, 'dist/client'), '发布目录必须只包含前端资源')
  const publicFiles = await files(publicDir)
  for (const path of publicFiles) {
    assert(!/^\.(?:env|dev\.vars)/.test(basename(path)), '公开目录含凭据文件')
    assertClean(await readFile(path), '前端构建资源')
  }
  checks.push({ name: '前端构建目录与虚构密钥隔离', passed: true, fileCount: publicFiles.length })
  let upstreamCalls = 0
  let newsCalls = 0
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: generated.name, modules: true, scriptPath: resolve(fixture, 'dist/lifespace/index.js'),
    compatibilityDate: generated.compatibility_date, compatibilityFlags: generated.compatibility_flags,
    bindings: { ...generated.vars, ...markers },
    ratelimits: Object.fromEntries(generated.ratelimits.map(binding => [binding.name, binding])),
    assets: { directory: publicDir, binding: 'ASSETS', run_worker_first: generated.assets.run_worker_first,
      routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
    outboundService: async request => {
      if (new URL(request.url).origin === 'https://newsnow.busiyi.world') {
        assert.equal(new URL(request.url).pathname, '/api/s')
        assert.equal(new URL(request.url).search, '?id=baidu')
        assert.equal(request.method, 'GET')
        assert.equal(request.headers.get('User-Agent'), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
        assert(!request.headers.has('Cookie') && !request.headers.has('Authorization'))
        assertClean(request.url + JSON.stringify([...request.headers]), '新闻上游请求')
        newsCalls++
        return new RuntimeResponse(JSON.stringify({ id: 'baidu', status: 'cache', items: [
          { title: '安全测试榜单', url: 'https://example.com/news', extra: markers },
        ], info: markers }), { headers: { 'Content-Type': 'application/json' } })
      }
      assert.equal(new URL(request.url).origin, 'https://api005.dnshe.com')
      assert.equal(request.method, 'GET')
      upstreamCalls++
      return new RuntimeResponse(JSON.stringify({ success: true, subdomains: [{ full_domain: 'onepeace.cc.cd', status: 'active', expires_at: '2027-01-15 00:00:00', never_expires: 0 }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  }] }))
  const runtimeBindings = await runtime.getBindings()
  assert((await runtimeBindings.DNSHE_READ_LIMITER.limit({ key: 'security-probe' })).success, '运行时读取限流绑定不可用')
  assert((await runtimeBindings.NEWS_READ_LIMITER.limit({ key: 'security-probe' })).success, '新闻读取限流绑定不可用')
  const newsProtection = generated.ratelimits.find(binding => binding.name === 'NEWS_READ_LIMITER')
  assert.equal(newsProtection.simple.limit, 30)
  assert.equal(newsProtection.simple.period, 60)
  for (const path of ['/', '/news', '/.dev.vars', '/.env.private', '/dist/lifespace/.dev.vars', '/.git/config', '/__private-cache/domains-v1/test', '/__private-cache/news-v1/baidu']) {
    const response = await runtime.dispatchFetch(`https://lifespace.onepeace.cc.cd${path}`)
    assertClean(await response.text(), '生产静态资源响应')
  }
  for (const path of ['/api/domains', '/api/domains?refresh=1']) {
    const response = await runtime.dispatchFetch(`https://lifespace.onepeace.cc.cd${path}`)
    const body = await response.text()
    if (response.status !== 200) throw new Error(`生产域名接口返回 ${response.status}（上游调用 ${upstreamCalls} 次）：${body.slice(0, 1000)}`)
    assertClean(body, '生产域名接口响应')
  }
  assert.equal(upstreamCalls, 1, '生产运行时未复用边缘缓存')
  let firstNewsTime
  for (const [index, path] of ['/api/news/source?id=baidu', '/api/news/source?id=baidu&refresh=force'].entries()) {
    const response = await runtime.dispatchFetch('https://lifespace.onepeace.cc.cd' + path)
    assert.equal(response.status, 200, '生产新闻接口不可用')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const body = await response.text()
    assertClean(body, '生产新闻接口响应')
    const result = JSON.parse(body)
    assert.equal(result.cacheHit, index === 1)
    assert.equal(result.stale, false)
    assert.equal(result.items[0].title, '安全测试榜单')
    if (index === 0) firstNewsTime = result.fetchedAt
    else assert.equal(result.fetchedAt, firstNewsTime)
  }
  assert.equal(newsCalls, 1, '生产运行时新闻缓存未命中')
  checks.push({ name: '生产运行时公开路径、接口与边缘缓存', passed: true })
  await runtime.dispose(); runtime = undefined
  devServer = await createServer({ configFile: resolve(fixture, 'vite.config.ts'), customLogger: logger,
    server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await devServer.listen()
  const address = devServer.httpServer.address()
  assert(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  for (const path of ['/.dev.vars', '/.env.private', `/@fs${fixture}/.dev.vars`, '/dist/lifespace/.dev.vars', `/@fs${fixture}/dist/lifespace/.dev.vars`]) {
    const response = await fetch(origin + path)
    assertClean(await response.text(), '开发服务器文件响应')
  }
  checks.push({ name: '开发服务器凭据文件访问隔离', passed: true })
  assertClean(logs.join('\n'), '构建与开发日志')
  checks.push({ name: '构建与开发日志虚构凭据检查', passed: true })
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
  assert(!tracked.some(path => /(?:^|\/)\.(?:dev\.vars|env)(?:\.|$)/.test(path) && !path.endsWith('.example')), 'Git 跟踪了凭据文件')
  const credentialPattern = /(?:sb_secret_[A-Za-z0-9_-]{24,}|cfsd_[A-Za-z0-9_-]{24,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/
  for (const path of tracked) {
    let text = await readFile(resolve(root, path), 'utf8')
    for (const marker of Object.values(markers)) text = text.split(marker).join('')
    assert(!credentialPattern.test(text), `Git 文件疑似含凭据：${path}`)
  }
  checks.push({ name: 'Git 凭据文件及常见密钥格式检查', passed: true })
  await mkdir(resolve(root, '.cache'), { recursive: true })
  await writeFile(resolve(root, '.cache/security-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n')
  restoreOutput()
  for (const check of checks) console.log(`通过：${check.name}`)
} catch (error) {
  restoreOutput()
  let message = error instanceof Error ? error.message : '未知错误'
  for (const marker of Object.values(markers)) message = message.split(marker).join('[REDACTED]')
  console.error(`安全验证未通过（已完成 ${checks.length} 项）：${message.slice(0, 500)}`)
  process.exitCode = 1
} finally {
  await devServer?.close()
  await runtime?.dispose()
  restoreOutput()
  process.chdir(originalCwd)
  await rm(fixture, { recursive: true, force: true })
}
