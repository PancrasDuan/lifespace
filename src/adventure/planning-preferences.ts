const terminalKey = (owner: string) => `lifespace.adventure.terminal.${owner}`

export function readTerminalPreference(owner: string): boolean {
  try { return window.localStorage.getItem(terminalKey(owner)) === 'true' } catch { return false }
}

export function saveTerminalPreference(owner: string, value: boolean): boolean {
  try { window.localStorage.setItem(terminalKey(owner), String(value)); return true } catch { return false }
}
