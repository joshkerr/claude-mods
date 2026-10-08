import type { EngineInterface, Register, Timer } from 'claude-code'

import { exitCodeIn, fmt, label, outputFileOf } from './format'
import { commands } from './notify'
import type { Platform } from './notify'

type Running = { description: string; startedAt: number; background: boolean }

// The engine follows `$` only into functions declared in the hooks module itself,
// so the OS probe lives here rather than in a shared file.
let os: Platform | undefined

/** The host OS: `OS=Windows_NT` on Windows, else what `uname -s` answers (Darwin, or Linux). */
const platform = async ($: EngineInterface): Promise<Platform> => {
  if (os !== undefined) return os
  if ((await $.env.get('OS')) === 'Windows_NT') return (os = 'win32')
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 3000 })
    if (r.exitCode === 0 && r.stdout.trim() === 'Darwin') return (os = 'darwin')
  } catch {
    // no uname: call it Linux
  }
  return (os = 'linux')
}

const BACKGROUND_POLL_MS = 3000
const BACKGROUND_GIVE_UP_MS = 2 * 60 * 60 * 1000

// Module state: starts over on a reload, which is fine for an in-flight timer.
let threshold = 30_000
let sound = true
let notify = true
const running = new Map<string, Running>()
let ticker: Timer | undefined
let seq = 0

const paint = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  const shown = [...running.values()]
    .filter(r => now - r.startedAt >= threshold)
    .sort((a, b) => a.startedAt - b.startedAt)
  if (shown.length === 0) {
    $.ui.status(undefined)
    return
  }
  const first = shown[0]
  if (first === undefined) return
  const rest = shown.slice(1)
  const mark = first.background ? '⇢' : '⏳'
  const more = rest.length > 0 ? `   +${rest.length} more` : ''
  $.ui.status(`${mark} ${first.description}   ${fmt(now - first.startedAt)}${more}`)
}

const track = ($: EngineInterface, id: string, task: Running): void => {
  running.set(id, task)
  ticker ??= $.clock.every(1000, () => void paint($))
}

const untrack = ($: EngineInterface, id: string): void => {
  running.delete(id)
  if (running.size === 0) {
    ticker?.cancel()
    ticker = undefined
    $.ui.status(undefined)
  }
}

const announce = async ($: EngineInterface, description: string, took: number, failed: boolean): Promise<void> => {
  const head = failed ? `✗ failed after ${fmt(took)}` : `✓ done in ${fmt(took)}`
  $.ui.toast(`${head} — ${description}`, { timeoutMs: 10_000 })
  if (!sound && !notify) return
  const cmd = commands(await platform($), {
    title: `Claude Code: ${failed ? 'command failed' : 'done'} after ${fmt(took)}`,
    body: description,
    failed,
  })
  if (sound) void $.process.run(cmd.sound, { timeoutMs: 10_000 }).catch(() => {})
  if (notify) void $.process.run(cmd.notify, { timeoutMs: 10_000 }).catch(() => {})
}

// A backgrounded command answers at once, so watch the task's output file for
// the "[exited with code N]" line the runner appends when the command ends.
const watchBackground = ($: EngineInterface, id: string, description: string, startedAt: number, file: string): void => {
  track($, id, { description, startedAt, background: true })
  let poll: Timer | undefined
  const stop = () => {
    poll?.cancel()
    untrack($, id)
  }
  poll = $.clock.every(BACKGROUND_POLL_MS, async () => {
    let code: number | undefined
    try {
      code = exitCodeIn(await $.fs.read(file))
    } catch {
      return // not written yet
    }
    if (code === undefined) return
    stop()
    const took = (await $.clock.now()) - startedAt
    if (took >= threshold) void announce($, description, took, code !== 0).catch(() => {})
  })
  $.clock.after(BACKGROUND_GIVE_UP_MS, stop)
}

export const register: Register = (on, options) => {
  threshold = Math.max(1, Number(options.thresholdSeconds ?? 30)) * 1000
  sound = options.sound !== false
  notify = options.desktopNotification !== false

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const id = `bash-${++seq}`
    const description = label(e)
    const startedAt = await $.clock.now()
    track($, id, { description, startedAt, background: false })
    try {
      const ran = await next(e)
      if (ran.deny !== undefined) return ran

      const result = ran.result as { backgroundTaskId?: string } | undefined
      const file = result?.backgroundTaskId ? outputFileOf(ran.text) : undefined
      if (file !== undefined) {
        watchBackground($, `${id}-bg`, description, startedAt, file)
        return ran
      }
      const took = (await $.clock.now()) - startedAt
      if (took >= threshold) void announce($, description, took, ran.isError === true).catch(() => {})
      return ran
    } finally {
      untrack($, id)
    }
  }).catch(($, e, next) => (next.called ? next(e) : next(e))) // never in the command's way
}
