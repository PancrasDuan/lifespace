import { Client, type QueryResultRow } from 'pg'

export type DatabaseEnv = { HYPERDRIVE?: Pick<Hyperdrive, 'connectionString'> }

// Only deliberate domain failures are exposed by HTTP adapters. Driver errors,
// SQL text and connection details must never reach responses or application logs.
export class DatabaseError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
export function reject(code: string): never {
  throw new DatabaseError(code)
}

export class Transaction {
  constructor(private readonly client: Client) {}
  async rows<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.client.query<T>(sql, values)).rows
  }
  async one<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T> {
    const rows = await this.rows<T>(sql, values)
    if (rows.length !== 1) throw new DatabaseError('DATABASE_RESULT_INVALID')
    return rows[0]
  }
}

// Each operation owns one client. Hyperdrive owns the remote pool; a global pg
// Pool would retain request-scoped sockets across Worker invocations.
export async function transaction<T>(env: DatabaseEnv, owner: string | null, work: (db: Transaction) => Promise<T>): Promise<T> {
  if (!env.HYPERDRIVE?.connectionString) throw new DatabaseError('DATABASE_NOT_CONFIGURED')
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10_000,
    application_name: 'lifespace-worker',
  })
  // An idle socket error can arrive between statements; query/commit will reject.
  client.on('error', () => {})
  let begun = false
  try {
    await client.connect()
    await client.query('begin')
    begun = true
    await client.query(
      `select set_config('lifespace.owner_id',$1,true),
      set_config('lock_timeout','3s',true),set_config('statement_timeout','10s',true),
      set_config('idle_in_transaction_session_timeout','10s',true),set_config('transaction_timeout','10s',true),
      set_config('search_path','pg_catalog,public',true)`,
      [owner ?? '']
    )
    const result = await work(new Transaction(client))
    await client.query('commit')
    begun = false
    return result
  } catch (error) {
    if (begun) {
      try {
        await client.query('rollback')
      } catch {
        /* Discard the connection below. */
      }
    }
    throw error
  } finally {
    // Await close on every path, including connect/commit/rollback failures.
    await client.end().catch(() => {})
  }
}
