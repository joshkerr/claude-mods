export type Platform = 'linux' | 'darwin' | 'win32'

export type Announcement = { title: string; body: string; failed: boolean }

const LINUX_DONE = '/usr/share/sounds/freedesktop/stereo/complete.oga'
const LINUX_FAIL = '/usr/share/sounds/freedesktop/stereo/dialog-warning.oga'
const MAC_DONE = '/System/Library/Sounds/Glass.aiff'
const MAC_FAIL = '/System/Library/Sounds/Basso.aiff'

/** The inside of an AppleScript string literal. */
const applescript = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
/** The inside of a PowerShell single-quoted literal. */
const ps = (s: string): string => s.replace(/'/g, "''")

// Windows PowerShell 5.1 reaches the toast API through its WinRT projection; the
// PowerShell app id is one every Windows install already registers for toasts.
const toastScript = (title: string, body: string): string =>
  [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "$t = $x.GetElementsByTagName('text')",
    `$t.Item(0).AppendChild($x.CreateTextNode('${ps(title)}')) | Out-Null`,
    `$t.Item(1).AppendChild($x.CreateTextNode('${ps(body)}')) | Out-Null`,
    "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show((New-Object Windows.UI.Notifications.ToastNotification -ArgumentList $x))',
  ].join('; ')

const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']

/** The host's sound and notification commands, as argument vectors (no shell). */
export const commands = (platform: Platform, a: Announcement): { sound: string[]; notify: string[] } => {
  switch (platform) {
    case 'darwin':
      return {
        sound: ['afplay', a.failed ? MAC_FAIL : MAC_DONE],
        notify: ['osascript', '-e', `display notification "${applescript(a.body)}" with title "${applescript(a.title)}"`],
      }
    case 'win32':
      return {
        sound: [...POWERSHELL, `(New-Object Media.SoundPlayer "$env:WINDIR\\Media\\${a.failed ? 'chord' : 'notify'}.wav").PlaySync()`],
        notify: [...POWERSHELL, toastScript(a.title, a.body)],
      }
    default:
      return {
        sound: ['paplay', a.failed ? LINUX_FAIL : LINUX_DONE],
        notify: ['notify-send', '--app-name=Claude Code', `--icon=${a.failed ? 'dialog-warning' : 'utilities-terminal'}`, a.title, a.body],
      }
  }
}
