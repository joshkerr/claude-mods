export type Herdr = { label: string; pane: string }
export type Git = { branch: string; changed: number; ahead: number; behind: number }
export type Status = { herdr: Herdr | null; cwd: string; git: Git | null }

declare module 'claude-code' {
  interface PluginState {
    'herdr-statusline': { status: Status | null }
  }
}
