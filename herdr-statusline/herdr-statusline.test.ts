import { test, expect } from 'claude-code/testing'

import { parseGitStatus, shortenPath } from './hooks/status'

test('shortenPath uses ~ and keeps the last three segments', () => {
  expect(shortenPath('/home/joshkerr', '/home/joshkerr')).toBe('~')
  expect(shortenPath('/home/joshkerr/Desktop', '/home/joshkerr')).toBe('~/Desktop')
  expect(shortenPath('/home/joshkerr/Projects/updateproj/hooks/deep', '/home/joshkerr')).toBe('…/updateproj/hooks/deep')
  expect(shortenPath('/opt/resolve', undefined)).toBe('/opt/resolve')
})

test('shortenPath keeps Windows separators and matches the home directory case-insensitively', () => {
  expect(shortenPath('C:\\Users\\joshk', 'C:\\Users\\joshk')).toBe('~')
  expect(shortenPath('C:\\Users\\joshk\\Projects', 'c:\\users\\joshk')).toBe('~\\Projects')
  expect(shortenPath('C:\\Users\\joshk\\Projects\\app\\src\\deep', 'C:\\Users\\joshk')).toBe('…\\app\\src\\deep')
  expect(shortenPath('D:\\work\\x', undefined)).toBe('D:\\work\\x')
  expect(shortenPath('/home/joshkerr/Desktop', '/home/joshkerr/')).toBe('~/Desktop')
})

test('parseGitStatus reads branch, ahead/behind and changed files', () => {
  const text = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 abc abc README.md',
    '? untracked.txt',
    '',
  ].join('\n')
  expect(parseGitStatus(text)).toEqual({ branch: 'main', changed: 2, ahead: 2, behind: 1 })
  expect(parseGitStatus('# branch.head (detached)\n')).toEqual({ branch: 'detached', changed: 0, ahead: 0, behind: 0 })
})

import { herdrLabel } from './hooks/status'

test('herdrLabel finds the workspace label in herdr workspace list output', () => {
  const json = '{"id":"x","result":{"type":"workspace_list","workspaces":[{"workspace_id":"w7","label":"Gowebdav"},{"workspace_id":"wB","label":"Desktop"}]}}'
  expect(herdrLabel(json, 'wB')).toBe('Desktop')
  expect(herdrLabel(json, 'zz')).toBeUndefined()
  expect(herdrLabel('not json', 'wB')).toBeUndefined()
})
