import type { Git } from '../types'

const isSep = (c: string | undefined): boolean => c === '/' || c === '\\'

/** `~` for the home directory, and the last three path segments at most; `/` or `\` as the path uses. */
export const shortenPath = (cwd: string, home: string | undefined): string => {
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const fold = (s: string) => (sep === '\\' ? s.toLowerCase() : s)
  let p = cwd
  if (home) {
    const h = home.replace(/[\\/]+$/, '')
    if (fold(p) === fold(h)) p = '~'
    else if (fold(p.slice(0, h.length)) === fold(h) && isSep(p[h.length])) p = `~${p.slice(h.length)}`
  }
  const parts = p.split(/[\\/]/)
  return parts.length > 4 ? `…${sep}${parts.slice(-3).join(sep)}` : p
}

/** Reads `git status --porcelain=v2 --branch` output. */
export const parseGitStatus = (text: string): Git => {
  let branch = '?'
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.length > 0 && !line.startsWith('#')) changed += 1
  }
  if (branch === '(detached)') branch = 'detached'
  return { branch, changed, ahead, behind }
}

/** The workspace's label from `herdr workspace list` JSON, when it is there. */
export const herdrLabel = (json: string, workspaceId: string): string | undefined => {
  try {
    const parsed = JSON.parse(json) as { result?: { workspaces?: { workspace_id: string; label?: string }[] } }
    return parsed.result?.workspaces?.find(w => w.workspace_id === workspaceId)?.label || undefined
  } catch {
    return undefined
  }
}
