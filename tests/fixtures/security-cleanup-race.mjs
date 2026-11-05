import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'

// 仅供清理回归 preload：在本轮 fixture 的真实 rmdir 前晚写，仍由操作系统返回错误。
const mkdtemp = fsp.mkdtemp
const rm = fsp.rm
const rmdir = fs.rmdir
const temporaryRoot = process.env.SECURITY_CLEANUP_TMP
const record = event => fs.appendFileSync(process.env.SECURITY_CLEANUP_EVENTS, JSON.stringify(event) + '\n')
let fixture, cleaning = false, rootCalls = 0, writes = 0

fsp.mkdtemp = async (prefix, options) => {
  const path = await mkdtemp(prefix, options)
  if (process.env.LIFESPACE_SECURITY_CHILD === '1' && String(prefix) === resolve(temporaryRoot, 'lifespace-security-')) {
    if (fixture) throw new Error('清理回归只能跟踪本轮唯一 fixture')
    fixture = path
    record({ event: 'created', path })
  }
  return path
}
fsp.rm = async (path, options) => {
  if (!fixture || path !== fixture) return rm(path, options)
  cleaning = true
  record({ event: 'cleanup-start', path })
  try {
    await rm(path, options)
    record({ event: 'cleanup-end', path, exists: fs.existsSync(path) })
  } catch (error) {
    record({ event: 'cleanup-failed', path: error.path, code: error.code, syscall: error.syscall })
    throw error
  } finally {
    cleaning = false
  }
}
fs.rmdir = (path, ...args) => {
  if (cleaning && String(path) === fixture) {
    rootCalls++
    // 第一次 rmdir 遇到正常内容；第二次在遍历删除之后，触发真实 ENOTEMPTY。
    if (rootCalls === 2 || (process.env.SECURITY_CLEANUP_RACE === 'persistent' && rootCalls > 2)) {
      fs.writeFileSync(resolve(fixture, `late-write-${++writes}.txt`), 'controlled cleanup regression\n')
      record({ event: 'late-write', path: fixture })
    }
  }
  return rmdir(path, ...args)
}
syncBuiltinESMExports()
