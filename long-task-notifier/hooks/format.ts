/** 42 → "42s", 102 → "1m 42s", 3725 → "1h 02m". */
export const fmt = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** The Bash call's description when it has one, else the command, cut to one short line. */
export const label = (e: { description?: string; command: string }, max = 60): string => {
  const text = (e.description?.trim() || e.command).trim().replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The output file a backgrounded Bash call names in its result text. */
export const outputFileOf = (text: string | undefined): string | undefined =>
  /Output is being written to: (\S+?)\.?(?:\s|$)/.exec(text ?? '')?.[1]

/** The exit code the background task runner appends once the command ends. */
export const exitCodeIn = (output: string): number | undefined => {
  const m = /\[exited with code (\d+)\]/.exec(output)
  return m ? Number(m[1]) : undefined
}
