import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

const GIT_STATUS = [
  '# branch.oid abc',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -0',
  '1 .M N... 100644 100644 100644 abc abc README.md',
  '',
].join('\n')

const HERDR_LIST =
  '{"id":"x","result":{"type":"workspace_list","workspaces":[{"workspace_id":"wB","label":"Desktop"}]}}'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/**
 * What the engine itself would answer beneath the plugin: its own (empty) band, or the tree
 * another mod beneath draws there when `below` gives one; in-memory state; a session.
 */
const engineStandIns = (on: On, below?: ($: EngineInterface, e: RenderInput) => RenderElement) => {
  const mem = new Map<string, { value: unknown; version: number }>()
  const keyOf = (e: { plugin: string; key: string }) => `${e.plugin}/${e.key}`
  on('ui.render', ($, e) => (below ? below($, e) : { type: 'engine', ref: 0 }))
  on('state.get', (_$, e) => ({ value: mem.get(keyOf(e)) ?? { value: undefined, version: 0 } }))
  on('state.set', (_$, e) => {
    const version = (mem.get(keyOf(e))?.version ?? 0) + 1
    mem.set(keyOf(e), { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

const start = ($: Engine, cwd: string, surface: 'terminal' | 'desktop') =>
  $.session.start({ cwd, surface, isInteractive: true })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws workspace, cwd and git on ${surface}`, async ($, on) => {
    mock.clock(on)
    engineStandIns(on)
    mock.env(on, { HOME: '/home/josh', HERDR_WORKSPACE_ID: 'wB', HERDR_PANE_ID: 'wB:p1', HERDR_BIN_PATH: '/usr/bin/herdr' })
    on('session.cwd', () => ({ value: '/home/josh/Projects/lap' }))
    on('process.run', (_$, e) => ({
      value: { exitCode: 0, stdout: e.argv[0] === 'git' ? GIT_STATUS : HERDR_LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))

    await start($, '/home/josh/Projects/lap', surface)
    const band = await $.ui.mount({ plugin: 'herdr-statusline', surface, component: 'AbovePrompt', props: PROPS })

    // The engine keeps text, not keys, on Text elements: read the segments as drawn.
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('▣ Desktop')
    expect(texts).toContain(' wB:p1')
    expect(texts).toContain('~/Projects/lap')
    expect(texts).toContain('⎇ main')
    expect(texts).toContain(' ✎ 1')
    expect(texts).toContain(' ↑1')
    expect(texts).not.toContain(' ✓')
  })
}

test('outside herdr and outside git, only the cwd is drawn', async ($, on) => {
  mock.clock(on)
  engineStandIns(on)
  mock.env(on, { HOME: '/home/josh' })
  on('session.cwd', () => ({ value: '/opt/resolve' }))
  on('process.run', () => ({
    value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await start($, '/opt/resolve', 'terminal')
  const band = await $.ui.mount({ plugin: 'herdr-statusline', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })

  const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('/opt/resolve')
  expect(texts).toContain('  ●')
  expect(texts.join('')).not.toContain('⎇')
  // Nothing beneath: the status row stands alone, in no column.
  expect((await band.find({ type: 'Box' }))?.props.flexDirection).toBe('row')
})

test('a band another mod draws beneath is stacked under the status row, never hidden', async ($, on) => {
  mock.clock(on)
  engineStandIns(on, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ flexDirection: 'row', children: [Text({ children: ['USAGE 68% left'] })] })
  })
  mock.env(on, { HOME: '/home/josh' })
  on('session.cwd', () => ({ value: '/opt/resolve' }))
  on('process.run', () => ({
    value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await start($, '/opt/resolve', 'terminal')
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'herdr-statusline', surface, component: 'AbovePrompt', props: PROPS })
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('/opt/resolve')
    expect(texts).toContain('USAGE 68% left')
    // The status row first, the other mod's band under it.
    expect(texts.indexOf('/opt/resolve')).toBeLessThan(texts.indexOf('USAGE 68% left'))
    expect((await band.find({ type: 'Box' }))?.props.flexDirection).toBe('column')
    await band.unmount()
  }
})
