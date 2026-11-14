type AttributeValue = string | number | boolean
// The OAuth library accepts WorkerEntrypoint handlers; these tests use fetch handlers.
export class WorkerEntrypoint {}

export type TestSpan = {
  attributes: Record<string, AttributeValue>
  setAttribute(key: string, value: AttributeValue): TestSpan
  setAttributes(attributes: Record<string, AttributeValue | undefined>): TestSpan
}

const spanKey = Symbol.for('lifespace.trace.test-span')
type GlobalWithSpan = typeof globalThis & { [spanKey]?: TestSpan }

export function installTraceSpan(): TestSpan {
  const attributes: Record<string, AttributeValue> = {}
  const span: TestSpan = {
    attributes,
    setAttribute(key, value) {
      attributes[key] = value
      return span
    },
    setAttributes(values) {
      for (const [key, value] of Object.entries(values)) if (value !== undefined) attributes[key] = value
      return span
    },
  }
  ;(globalThis as GlobalWithSpan)[spanKey] = span
  return span
}

export function clearTraceSpan() {
  delete (globalThis as GlobalWithSpan)[spanKey]
}

export const tracing = {
  getActiveSpan(): TestSpan | undefined {
    return (globalThis as GlobalWithSpan)[spanKey]
  },
}
