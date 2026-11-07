import { authDiagnosticText, type AuthDiagnostic } from './diagnostics'

export function AuthDiagnostics({ diagnostic }: { diagnostic?: AuthDiagnostic }) {
  if (!diagnostic) return null
  return (
    <details className="auth-diagnostics">
      <summary>查看诊断信息</summary>
      <p>可将下方信息提供给维护者，帮助排查本次失败。不包含邮箱或登录凭据。</p>
      <code>{authDiagnosticText(diagnostic)}</code>
    </details>
  )
}
