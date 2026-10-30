import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Git, Herdr, Status } from '../types'
import { herdrLabel, parseGitStatus, shortenPath } from './status'

const status = atom({ plugin: 'herdr-statusline', key: 'status' } as const, null)

const REFRESH_MS = 20_000
const HERDR_TTL_MS = 60_000

let herdrCache: { value: Herdr | null; at: number } | undefined

const readGit = async ($: EngineInterface, cwd: string): Promise<Git | null> => {
  try {
    const r = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 })
    return r.exitCode === 0 ? parseGitStatus(r.stdout) : null
  } catch {
    return null
  }
}

// The herdr workspace label and pane id, from the env herdr gives its panes.
const readHerdr = async ($: EngineInterface): Promise<Herdr | null> => {
  const workspace = await $.env.get('HERDR_WORKSPACE_ID')
  const pane = await $.env.get('HERDR_PANE_ID')
  if (!workspace || !pane) return null
  const bin = (await $.env.get('HERDR_BIN_PATH')) ?? 'herdr'
  let label = workspace
  try {
    const r = await $.process.run([bin, 'workspace', 'list'], { timeoutMs: 5000 })
    if (r.exitCode === 0) label = herdrLabel(r.stdout, workspace) ?? workspace
  } catch {
    // herdr not answering: the id is still a fine label
  }
  return { label, pane }
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  if (herdrCache === undefined || now - herdrCache.at > HERDR_TTL_MS) {
    herdrCache = { value: await readHerdr($), at: now }
  }
  const cwd = await $.session.cwd()
  const next: Status = {
    herdr: herdrCache.value,
    // HOME on Linux and macOS; Windows keeps the home directory in USERPROFILE.
    cwd: shortenPath(cwd, (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))),
    git: await readGit($, cwd),
  }
  await update($, status, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The band first: nothing below may keep it from drawing.
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    try {
      // `/statusline` is a built-in, so the refresh command gets its own name.
      await $.command.register({ name: 'herdr-status', description: 'Refresh the herdr status band now' })
    } catch {
      // no command, still a band
    }
    return next(e)
  })

  on('command.run', { command: 'herdr-status' }, async $ => {
    await refresh($)
    return { text: 'Status band refreshed.' }
  })

  // Git state mostly changes inside a turn: redraw at both ends of one.
  on('turn.start', ($, e, next) => {
    void refresh($)
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    void refresh($)
    return next(e)
  })

  // The band is one slot that every mod shares: whatever the mods beneath draw
  // there (a usage band, say) is stacked under the status row, never hidden by it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const s = await read($, status)
    if (e.props.hasSurvey || s === null) return below

    const { Box, Text } = $.ui.resolve(e)
    const parts: JSX.Element[] = []
    const sep = (key: string) => <Text key={key} color="subtle">  │  </Text>

    if (s.herdr !== null) {
      parts.push(
        <Text key="ws" color="claude" bold>▣ {s.herdr.label}</Text>,
        <Text key="pane" color="subtle"> {s.herdr.pane}</Text>,
        sep('sep1'),
      )
    }
    parts.push(<Text key="cwd" color="text">{s.cwd}</Text>)
    if (s.git !== null) {
      const dirty = s.git.changed > 0
      parts.push(
        sep('sep2'),
        <Text key="branch" color={dirty ? 'warning' : 'success'} bold>⎇ {s.git.branch}</Text>,
        dirty
          ? <Text key="changed" color="warning"> ✎ {s.git.changed}</Text>
          : <Text key="clean" color="success"> ✓</Text>,
      )
      if (s.git.ahead > 0) parts.push(<Text key="ahead" color="subtle"> ↑{s.git.ahead}</Text>)
      if (s.git.behind > 0) parts.push(<Text key="behind" color="subtle"> ↓{s.git.behind}</Text>)
    }
    if (e.props.isWorking) parts.push(<Text key="working" color="claude">  ●</Text>)

    const row = <Box key="status" flexDirection="row">{parts}</Box>
    // `engine` is the engine's own band, which draws nothing of its own here.
    if (below.type === 'engine') return row
    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })
}
