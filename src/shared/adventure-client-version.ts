import { z } from 'zod'

// Bump when an older adventure client must no longer submit writes.
export const adventureClientVersionHeader = 'X-Adventure-Client-Version'
export const legacyAdventureClientVersion = 'goal-categories-1'
export const adventureClientVersion = legacyAdventureClientVersion
// #199 activates this gate for ALL new writes in the coordinated release.
// #198 keeps the currently deployed once-task gate unchanged.
export const recurringAdventureClientVersion = 'recurring-1'
export const planningCompatibilitySchema = z.union([
  z.strictObject({ model: z.literal('goal-categories'), version: z.literal(1), receiptLookup: z.literal(true), legacyRetry: z.literal(false) }),
  z.strictObject({ model: z.literal('goal-categories'), version: z.literal(1), receiptLookup: z.literal(true), legacyRetry: z.literal(false),
    recurring: z.literal(1), clientVersion: z.literal(recurringAdventureClientVersion) }),
])
