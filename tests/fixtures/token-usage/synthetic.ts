// Entirely invented IDs, models and counts; no transcript text or paths.
export function syntheticCodexLog() {
  const rows: unknown[] = [
    { timestamp: '2026-11-14T15:58:00Z', type: 'session_meta', payload: { id: 'synthetic-token-206', model_provider: 'openai' } },
  ]
  function usage(timestamp: string, model: string | undefined, input: number, cached: number, output: number, reasoning: number, turn: string) {
    rows.push({ timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: turn } })
    rows.push({ timestamp, type: 'turn_context', payload: { turn_id: turn, ...(model ? { model } : {}) } })
    rows.push({ timestamp, type: 'token_usage_record', payload: {
      thread_id: 'synthetic-token-206', turn_id: turn, response_id: `synthetic-${turn}`,
      ...(model ? { model } : {}), usage: {
        input_tokens: input, cached_input_tokens: cached, output_tokens: output,
        reasoning_output_tokens: reasoning, total_tokens: input + output,
      },
    } })
    rows.push({ timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: turn } })
  }
  usage('2026-11-14T15:59:59Z', 'gpt-5.5', 100, 20, 30, 10, 'before-midnight')
  usage('2026-11-14T16:00:00Z', 'gpt-5.5', 200, 50, 60, 20, 'after-midnight')
  usage('2026-11-15T02:00:00Z', 'synthetic-unpriced-206', 300, 70, 90, 30, 'unpriced')
  // A new session without any model context is tested separately (no inheritance).
  return rows.map(row => JSON.stringify(row)).join('\n') + '\n'
}

export function syntheticUnknownModelLog() {
  return [
    { timestamp: '2026-11-15T03:00:00Z', type: 'session_meta', payload: { id: 'synthetic-unknown-206' } },
    { timestamp: '2026-11-15T03:01:00Z', type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 40, cached_input_tokens: 5, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 50 },
      last_token_usage: { input_tokens: 40, cached_input_tokens: 5, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 50 },
    } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
}
