import type { EngineInterface, Register } from 'claude-code'

/** How this host can raise privileges with a password prompt the person can answer. */
export type Elevator = 'pkexec' | 'osascript' | 'windows-sudo' | 'none'

export type Platform = 'linux' | 'darwin' | 'win32'

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

// `sudo` in command position: at the start, or after ; & | ( or a newline.
// (A `sudo` inside a quoted string or a comment is not a command and is left alone
// by requiring it to lead a statement.)
const LEAD = String.raw`(^|[;&|(]\s*|\n\s*)`
const SUDO_ANY = new RegExp(`${LEAD}sudo(\\s|$)`)
const SUDO_FLAGGED = new RegExp(`${LEAD}sudo\\s+-`)
const SUDO_PLAIN = new RegExp(`${LEAD}sudo\\s+(?=[^-\\s])`, 'g')

const DENY_FLAGS: Record<'pkexec' | 'osascript', string> = {
  pkexec:
    'pkexec-guard: sudo cannot prompt for a password in this session, and sudo flags ' +
    '(-n, -u, -E, …) do not map onto pkexec. Put the root steps in a script and run it ' +
    'with `pkexec <script>`, which opens a graphical password dialog.',
  osascript:
    'pkexec-guard: sudo cannot prompt for a password in this session, and sudo flags ' +
    '(-n, -u, -E, …) do not map onto an administrator dialog. Put the root steps in a script ' +
    'and run it with `osascript -e \'do shell script "<script>" with administrator privileges\'`, ' +
    'which opens a macOS password dialog.',
}

const TOAST: Record<Elevator, string | undefined> = {
  pkexec: 'sudo → pkexec: a password dialog will open on your desktop',
  osascript: 'sudo → osascript: a macOS administrator dialog will open',
  'windows-sudo': 'sudo: a Windows UAC prompt will open',
  none: undefined,
}

export const hasSudo = (command: string): boolean => SUDO_ANY.test(command)

/** Where the statement starting at `from` ends: the first unquoted ; & | ) or newline. */
export const statementEnd = (s: string, from: number): number => {
  let quote: '"' | "'" | undefined
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (quote === "'") {
      if (c === "'") quote = undefined
    } else if (quote === '"') {
      if (c === '\\') i++
      else if (c === '"') quote = undefined
    } else if (c === '\\') i++
    else if (c === "'" || c === '"') quote = c
    else if (c === ';' || c === '&' || c === '|' || c === ')' || c === '\n') return i
  }
  return s.length
}

/** One statement as `osascript -e 'do shell script "…" with administrator privileges'`, shell-quoted. */
export const adminWrap = (stmt: string): string => {
  const inner = stmt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const line = `do shell script "${inner}" with administrator privileges`
  return `osascript -e '${line.replace(/'/g, String.raw`'\''`)}'`
}

export const rewrite = (command: string, elevator: Elevator = 'pkexec'): { command: string } | { deny: string } => {
  // Windows sudo raises its own UAC prompt, and a host with no dialog to offer is left alone.
  if (elevator === 'none' || elevator === 'windows-sudo' || !SUDO_ANY.test(command)) return { command }
  if (SUDO_FLAGGED.test(command)) return { deny: DENY_FLAGS[elevator] }
  if (elevator === 'pkexec') return { command: command.replace(SUDO_PLAIN, '$1pkexec ') }

  // macOS: each `sudo <statement>` becomes one administrator-privileges call.
  let out = ''
  let at = 0
  const re = new RegExp(SUDO_PLAIN.source, 'g')
  for (let m = re.exec(command); m !== null; m = re.exec(command)) {
    const start = m.index + m[0].length
    const end = statementEnd(command, start)
    const raw = command.slice(start, end)
    const stmt = raw.trimEnd()
    out += command.slice(at, m.index) + (m[1] ?? '') + adminWrap(stmt) + raw.slice(stmt.length)
    at = end
    re.lastIndex = end
  }
  return { command: out + command.slice(at) }
}

/** The host's elevator, found once: Windows sudo, osascript, pkexec on a Linux desktop, or nothing. */
export const detect = async ($: EngineInterface): Promise<Elevator> => {
  const host = await platform($)
  if (host === 'win32') return 'windows-sudo'
  if (host === 'darwin') return 'osascript'
  // pkexec draws its dialog on a desktop; a headless box keeps plain sudo (NOPASSWD or not).
  const display = (await $.env.get('DISPLAY')) || (await $.env.get('WAYLAND_DISPLAY'))
  if (!display) return 'none'
  try {
    const r = await $.process.run(['which', 'pkexec'], { timeoutMs: 3000 })
    return r.exitCode === 0 ? 'pkexec' : 'none'
  } catch {
    return 'none'
  }
}

let elevator: Promise<Elevator> | undefined

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!hasSudo(e.command)) return next(e)
    const how = await (elevator ??= detect($))
    const r = rewrite(e.command, how)
    if ('deny' in r) return { deny: r.deny }

    const toast = TOAST[how]
    if (toast !== undefined) $.ui.toast(toast, { timeoutMs: 8000 })
    return r.command === e.command ? next(e) : next({ ...e, command: r.command })
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: `${$.plugin.name}: its guard failed. Elevate by hand (pkexec, an osascript administrator dialog, or Windows sudo) instead of plain sudo here.` },
  )
}
