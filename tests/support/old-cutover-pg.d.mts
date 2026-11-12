export function openCutoverDatabase(port: number): Promise<{
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<void>
}>
