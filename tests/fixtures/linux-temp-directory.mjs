import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'

// 模拟 Linux 没有 macOS 的 /private/tmp；其他文件系统操作使用真实实现。
const mkdtemp = fs.mkdtemp
fs.mkdtemp = async (prefix, options) => {
  if (String(prefix).startsWith('/private/tmp/')) {
    const error = new Error('Linux 环境不存在 /private/tmp')
    error.code = 'ENOENT'
    throw error
  }
  return mkdtemp(prefix, options)
}
syncBuiltinESMExports()
