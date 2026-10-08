import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { adminWrap, rewrite, statementEnd } from './hooks/register'

/** A Linux desktop with pkexec: `uname -s` says Linux, `which pkexec` is found. */
const linuxDesktop = (on: On) => {
  mock.env(on, { DISPLAY: ':0' })
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '/usr/bin/pkexec\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
}

const TWO = 'sudo apt-get install -y foo && sudo systemctl restart bar'

test('leaves a command without sudo alone', async ($, on) => {
  linuxDesktop(on)
  let seen = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls -la ~/Downloads' })
  expect(ran.deny).toBeUndefined()
  expect(seen).toBe('ls -la ~/Downloads')
})

test('rewrites a plain sudo to pkexec on a Linux desktop', async ($, on) => {
  linuxDesktop(on)
  let seen = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: TWO })
  expect(ran.deny).toBeUndefined()
  expect(seen).toBe('pkexec apt-get install -y foo && pkexec systemctl restart bar')
})

test('refuses sudo with flags instead of guessing', async ($, on) => {
  linuxDesktop(on)
  let called = false
  on('tool.call', { tool: 'Bash' }, () => {
    called = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'sudo -n true' })
  expect(ran.deny).toContain('pkexec')
  expect(called).toBe(false)
})

test('on Windows, sudo passes through to Windows sudo and its UAC prompt', async ($, on) => {
  mock.env(on, { OS: 'Windows_NT' })
  let seen = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'sudo netsh advfirewall show allprofiles' })
  expect(ran.deny).toBeUndefined()
  expect(seen).toBe('sudo netsh advfirewall show allprofiles')
})

test('on macOS, sudo becomes an osascript administrator dialog', async ($, on) => {
  mock.env(on, {})
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  let seen = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'sudo killall -HUP mDNSResponder' })
  expect(ran.deny).toBeUndefined()
  expect(seen).toBe(`osascript -e 'do shell script "killall -HUP mDNSResponder" with administrator privileges'`)
})

test('rewrite() for pkexec handles pipelines, subshells and newlines', () => {
  expect(rewrite('cat x | sudo tee /etc/y')).toEqual({ command: 'cat x | pkexec tee /etc/y' })
  expect(rewrite('(sudo ls)')).toEqual({ command: '(pkexec ls)' })
  expect(rewrite('echo hi\nsudo ls')).toEqual({ command: 'echo hi\npkexec ls' })
  expect(rewrite('echo "run sudo later"')).toEqual({ command: 'echo "run sudo later"' })
  expect(rewrite('sudoedit /etc/x')).toEqual({ command: 'sudoedit /etc/x' })
})

test('rewrite() for osascript wraps each statement and keeps what joins them', () => {
  const wrap = (s: string) => `osascript -e 'do shell script "${s}" with administrator privileges'`
  expect(rewrite(TWO, 'osascript')).toEqual({
    command: `${wrap('apt-get install -y foo')} && ${wrap('systemctl restart bar')}`,
  })
  expect(rewrite('cat x | sudo tee /etc/y', 'osascript')).toEqual({ command: `cat x | ${wrap('tee /etc/y')}` })
  expect(rewrite('(sudo ls)', 'osascript')).toEqual({ command: `(${wrap('ls')})` })
  expect(rewrite('echo hi\nsudo ls', 'osascript')).toEqual({ command: `echo hi\n${wrap('ls')}` })
  expect(rewrite('sudo sh -c "echo a; echo b" ; ls', 'osascript')).toEqual({
    command: `${wrap(String.raw`sh -c \"echo a; echo b\"`)} ; ls`,
  })
  expect(rewrite('sudo -u root ls', 'osascript')).toMatchObject({ deny: expect.stringContaining('administrator privileges') })
})

test('rewrite() leaves sudo alone where nothing can prompt, and on Windows', () => {
  expect(rewrite('sudo ls', 'none')).toEqual({ command: 'sudo ls' })
  expect(rewrite('sudo -n ls', 'none')).toEqual({ command: 'sudo -n ls' })
  expect(rewrite('sudo ls', 'windows-sudo')).toEqual({ command: 'sudo ls' })
})

test('statementEnd and adminWrap respect quoting', () => {
  expect(statementEnd('ls "a;b" ; x', 0)).toBe(9)
  expect(statementEnd("ls 'a|b' && x", 0)).toBe(9)
  expect(statementEnd(String.raw`ls a\;b;x`, 0)).toBe(7)
  expect(statementEnd('ls', 0)).toBe(2)
  expect(adminWrap(String.raw`echo it's "q" \n`)).toBe(
    String.raw`osascript -e 'do shell script "echo it'\''s \"q\" \\n" with administrator privileges'`,
  )
})
