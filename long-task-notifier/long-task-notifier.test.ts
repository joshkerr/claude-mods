import { test, expect, mock } from 'claude-code/testing'

import { exitCodeIn, fmt, label, outputFileOf } from './hooks/format'
import { commands } from './hooks/notify'

test('fmt renders seconds, minutes and hours', () => {
  expect(fmt(4200)).toBe('4s')
  expect(fmt(102_000)).toBe('1m 42s')
  expect(fmt(3_725_000)).toBe('1h 02m')
})

test('label prefers the description and keeps one short line', () => {
  expect(label({ description: '  Extract the   installer ', command: 'unzip x' })).toBe('Extract the installer')
  expect(label({ command: 'unzip -o -q a.zip' })).toBe('unzip -o -q a.zip')
  expect(label({ command: 'x'.repeat(80) })).toHaveLength(60)
})

test("parses the background runner's result text and exit line", () => {
  expect(
    outputFileOf('Command running in background with ID: b9o94. Output is being written to: /tmp/t/b9o94.output. You will be notified.'),
  ).toBe('/tmp/t/b9o94.output')
  expect(outputFileOf('plain output')).toBeUndefined()
  expect(exitCodeIn('some output\n\n[exited with code 0]\n')).toBe(0)
  expect(exitCodeIn('still running')).toBeUndefined()
})

test('each platform gets its own sound and notification commands', () => {
  const a = { title: 'Claude Code: done after 1m 02s', body: "Build it's \"fast\"", failed: false }

  const linux = commands('linux', a)
  expect(linux.sound[0]).toBe('paplay')
  expect(linux.notify.slice(0, 1)).toEqual(['notify-send'])
  expect(linux.notify).toContain(a.title)
  expect(linux.notify).toContain(a.body)
  expect(commands('linux', { ...a, failed: true }).sound[1]).toContain('dialog-warning')

  const mac = commands('darwin', a)
  expect(mac.sound).toEqual(['afplay', '/System/Library/Sounds/Glass.aiff'])
  expect(mac.notify).toEqual(['osascript', '-e', 'display notification "Build it\'s \\"fast\\"" with title "Claude Code: done after 1m 02s"'])
  expect(commands('darwin', { ...a, failed: true }).sound[1]).toContain('Basso')

  const win = commands('win32', a)
  expect(win.sound.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  expect(win.sound[4]).toContain('notify.wav')
  expect(commands('win32', { ...a, failed: true }).sound[4]).toContain('chord.wav')
  expect(win.notify[4]).toContain("CreateTextNode('Build it''s \"fast\"')")
  expect(win.notify[4]).toContain('ToastNotificationManager')
})

test('a quick command passes through untouched', async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'true', description: 'Quick check' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ stdout: 'ok', stderr: '', interrupted: false })
})

test('a long command still returns its result after the notification', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const ran_cmds: string[] = []
  on('process.run', (_$, e) => {
    ran_cmds.push(e.argv[0] ?? '')
    return { value: { exitCode: 0, stdout: 'Linux\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await clock.advance(45_000)
    return { result: { stdout: 'done', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'sleep 45', description: 'Long wait' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ stdout: 'done', stderr: '', interrupted: false })
})
