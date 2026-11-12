import pg from 'pg'

export async function openCutoverDatabase(port) {
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: '', ssl: false })
  await client.connect()
  return client
}
