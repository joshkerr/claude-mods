# claude-mods

Three small [Claude Code](https://claude.com/claude-code) mods (hooks-module plugins) by Josh Kerr. Each runs on Linux, macOS and Windows.

| Mod | What it does |
| --- | --- |
| `pkexec-guard` | Routes `sudo` in Bash calls to a password prompt you can actually answer. Claude Code's Bash tool cannot answer sudo's password prompt, so a plain `sudo` hangs or fails. On a Linux desktop `sudo` becomes `pkexec` (a polkit dialog); on macOS it becomes `osascript -e 'do shell script "…" with administrator privileges'` (the system administrator dialog); on Windows it is left to Windows `sudo`, which raises a UAC prompt. A headless Linux box keeps plain `sudo`. `sudo` with flags (`-n`, `-u`, `-E`, …) is refused with a hint rather than guessed at. |
| `long-task-notifier` | A live timer in the status line for Bash commands and background tasks that run longer than a threshold, then a toast, a chime and a desktop notification when they finish. Linux uses `paplay` and `notify-send`, macOS uses `afplay` and Notification Center, Windows uses a system sound and a toast. Threshold, chime and notification are user options. |
| `herdr-statusline` | A band above the prompt showing the [herdr](https://github.com/joshkerr) workspace and pane you are in (when Claude Code runs inside herdr), the working directory, and the git branch with its dirty, ahead and behind state. |

## Install

In a terminal Claude Code session:

```
/plugin install pkexec-guard --marketplace joshkerr/claude-mods
/plugin install long-task-notifier --marketplace joshkerr/claude-mods
/plugin install herdr-statusline --marketplace joshkerr/claude-mods
```

Answer `y` to add the marketplace the first time, then pick the `user` scope. Or from a shell:

```
claude plugin marketplace add joshkerr/claude-mods
claude plugin install pkexec-guard@claude-mods --scope user
claude plugin install long-task-notifier@claude-mods --scope user
claude plugin install herdr-statusline@claude-mods --scope user
```

Later, `claude plugin marketplace update claude-mods` then `claude plugin update <mod>` pulls a new version.

## Develop

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module under `hooks/`. To run them from this checkout instead of an install, point `CLAUDE_CODE_PLUGIN_DIRS` at the mod folders (`:`-separated on Linux and macOS, `;` on Windows), or pass `claude --plugin-dir <folder>`.

```
claude plugin validate <mod>   # manifest, hooks and what the engine would refuse
claude plugin test <mod>       # the *.test.ts beside the mod
tsc -p <mod>                   # after the mod has loaded once, which writes its types
```

The `.claude-plugin/types/` folder inside each mod is written by the engine when the mod loads and is not committed.
