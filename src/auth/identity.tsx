import { createContext, useContext } from 'react'

// 只能由在线鉴权通过后的 AuthGate 提供；SDK 会话变化会同步撤销 signal。
export type VerifiedIdentity = { ownerId: string; signal: AbortSignal }
export const VerifiedIdentityContext = createContext<
  VerifiedIdentity | undefined
>(undefined)
export function useVerifiedIdentity(): VerifiedIdentity {
  const identity = useContext(VerifiedIdentityContext)
  if (!identity) throw new Error('页面需要已验证的账户上下文')
  return identity
}
