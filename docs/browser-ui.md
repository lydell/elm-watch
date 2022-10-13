---
title: Browser UI
nav_order: 7
---

# Browser UI

When using `elm-watch hot`, you’ll see a little box in the bottom-left corner of the browser window, looking something like this:

```
▼ ✅ 13:10:05
```

It shows the current status. The ✅ means all is good and there are no compilation errors. 13:10:05 is the last time the status was updated. That’s especially useful for knowing when the last hot reload was applied. No more wondering “did the hot reload stop working? Or did I edit the wrong piece of code?” If the time has updated, so has the running code. On top of that, there’s an animation – a green circle growing from the ✅ and fading out as it goes – to let you know that a hot reload has gone through successfully.

Clicking the box expands it, letting you switch between the “standard” compilation mode, `--debug` and `--optimize`. elm-watch remembers your choice (per target) across restarts. So if you prefer to have the Elm debugger on at all times, it’s easy to do!

If the UI is in the way, you can move it to another corner using the arrow buttons. elm-watch remembers that choice per target across restarts as well.

Here are some more icons you might see (they’re also explained when you expand the box):

- 🔌: Connecting
- ⏳: Waiting for compilation
- 🚨: Compilation error
- ⛔️: Eval error
- ❌: Unexpected error

Pay extra attention to 🚨 (compilation error). If you see it, the latest changes to your Elm files didn’t compile, **so you’re running an older version of your app.** Go to the terminal to see the errors, or expand the UI and click the “Show errors” button if you’d like to see them directly in the browser, in an overlay. The overlay is visible until you close it again, or until you fix all errors. elm-watch remembers your choice to show errors in the browser per target, and opens the overlay again when there are new errors if you had previously opted to show it.

I often want to play around with my app while making changes. I might refactor something and wonder exactly how the app used to behave in a certain situation. Error overlays in some other tools prevent you from doing that, or require you to repeatedly close it. This is why elm-watch lets you choose if you want the overlay or not, and remembers your choice. Let me know if you think a future version of elm-watch should or should not show it by default, though!

(A cool little detail: The error overlay picks up the colors from your terminal, if possible.)

To make that 🚨 more noticeable, there’s a similar animation as for ✅ – a growing and fading _red_ circle – which also is repeated every time you focus the tab (switch to it from another tab or window, or move focus from the dev tools to the page). (It’s only repeated when the error overlay isn’t showing, though.)

## Clickable error locations

In the error overlay you can click error locations to open them in your editor!

There’s no universal way of doing that, though, so you’ll have to set it up. It’s not that complicated: You need to set the `ELM_WATCH_OPEN_EDITOR` environment variable to some shell script code.

Here’s how to set it in different shells:

| Shell | Config file | Code |
| --- | --- | --- |
| bash | `~/.bashrc` | `export ELM_WATCH_OPEN_EDITOR='your command here'` |
| zsh | `~/.zshrc` | `export ELM_WATCH_OPEN_EDITOR='your command here'` |
| fish | run it once | `set -Ux ELM_WATCH_OPEN_EDITOR 'your command here'` |
| Windows | System Settings | Name: `ELM_WATCH_OPEN_EDITOR`, Value: `your command here` |

(Feel free to do it in a different way if you have a preference. Try [direnv] if you want different editors in different projects.)

And here are some commands for a few editors:

| Editor | Command | Windows command |
| --- | --- | --- |
| [VSCode] | `code --goto "$file:$line:$column"` | `code --goto "%file%:%line%:%column%"` |
| [IntelliJ IDEA] | `idea --line "$line" "$file"` \* | `idea64.exe --line "%line%" "%file%"` † |
| [Rider] | `rider --line "$line" "$file"` \* | `rider64.exe --line "%line%" "%file%"` † |

\* Neither IntelliJ IDEA nor Rider come with a command line interface out of the box. Go to `Tools > Create Command-line Launcher…` to activate them. Chances are other [JetBrains] IDEs work similarly, just with different names.

† I haven’t tested IntelliJ IDEA or Rider on Windows, so I’m not 100 % sure about those commands. Let me know if they do or do not work!

Full examples:

- bash/zsh with VSCode: `export ELM_WATCH_OPEN_EDITOR='code --goto "$file:$line:$column"'`
- fish with Rider: `set -Ux ELM_WATCH_OPEN_EDITOR 'rider --line "$line" "$file"'`

Don’t forget quotes around the `file` variable, in case it contains spaces! (`line` and `column` only contains digits, but it doesn’t hurt to quote them too.)

- ✅ `"$file"`, `"%file%"`
- ❌ `$file`, `%file%`

elm-watch executes the `ELM_WATCH_OPEN_EDITOR` environment variable using [child_process.exec], with the following:

- Shell:
  - On Windows: `cmd.exe`
  - Otherwise: `sh`
- CWD: The `elm-watch.json` directory.
- Environment: Three extra environment variables are set:
  - `file`: The absolute file path of the error location.
  - `line`: 1-based line number of the error location. `1` if the error location has no line number.
  - `column`: 1-based column number of the error location. `1` if the error location has no column number.

[child_process.exec]: https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback
[direnv]: https://direnv.net/
[intellij idea]: https://www.jetbrains.com/idea/
[jetbrains]: https://www.jetbrains.com/
[rider]: https://www.jetbrains.com/rider/
[vscode]: https://code.visualstudio.com/
