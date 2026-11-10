---
title: Browser UI
nav_order: 7
---

# Browser UI

When using `elm-watch hot`, you’ll see a little emoji in the bottom-left corner of the browser window, like ✅.

It shows the current status. The ✅ means all is good and there are no compilation errors. When a hot reload has gone through successfully, there’s an animation – a green circle growing from the ✅ and fading out as it goes. No more wondering “did the hot reload stop working? Or did I edit the wrong piece of code?”

If there are several targets (scripts) on the page, there’s still just one emoji, showing the worst status of them all. A small 🚀 next to it means that some target is in `--optimize` mode.

Clicking the emoji opens a panel with one row per target. Each row shows the status, the time it was last updated (handy for knowing when the last hot reload was applied), and lets you switch between the “standard” compilation mode, `--debug` and `--optimize`. elm-watch remembers your choice (per target) across restarts. So if you prefer to have the Elm debugger on at all times, it’s easy to do!

If the emoji is in the way, drag it somewhere else. It snaps to the closest side of the window. You can also move it with Shift + arrow keys while it (or the panel) has focus. The position is remembered in the browser (using `localStorage`), for all pages on the same origin.

Here are all the icons you might see (they’re also explained in the panel):

✅ = Successfully compiled  
🔌 = Connecting  
⏳ = Waiting for compilation  
🚨 = Compilation error  
⛔️ = Eval error  
❌ = Unexpected error

Pay extra attention to 🚨 (compilation error). If you see it, the latest changes to your Elm files didn’t compile, **so you’re running an older version of your app.** elm-watch then shows the errors directly in the browser, in an overlay (in addition to the terminal).

I often want to play around with my app while making changes. I might refactor something and wonder exactly how the app used to behave in a certain situation. Error overlays in some other tools prevent you from doing that, or require you to repeatedly close it. In elm-watch, you can close the overlay (with the close button, or by pressing Escape), and it then stays closed until the next time you save and get errors. Press Escape again to bring it back, or open the panel and click the “Show errors” button.

(A cool little detail: The error overlay picks up the colors from your terminal, if possible.)

## One error at a time

The error overlay shows one error at a time, so you can focus on fixing it before moving on to the next. If there are several targets on the page, their errors are shown together.

At the bottom of the overlay you can see which error and file you’re at, and which keys you can use. The keys are also buttons, so you can click them.

| Key | Action |
| --- | --- |
| ← → (or h l) | Previous/next error. |
| ↑ ↓ (or k j) | Previous/next file. |
| Enter (or o) | Open the error in your editor (see [Clickable error locations](#clickable-error-locations)). |
| Space | Expand or collapse long code (see below). |
| a | Show all errors at once (press again to go back to one at a time). |
| Escape | Close the error overlay. |

Sometimes Elm shows a lot of code in an error. For example, if you forget a branch in a `case` expression with 50 branches, Elm shows the whole `case` expression. To make it easier to see what the error is about at a glance, elm-watch collapses long code: It keeps the start of the code and the lines Elm points at (with some context), and replaces the rest with a line like `¦ (16 lines)`. Press Space, or click “(16 lines)”, to see all of the code. It stays expanded for all errors until you press Space again. When showing all errors at once, nothing is collapsed.

The terminal works the same way – it also shows one error at a time, with the same keys (except Escape). The terminal also has Tab to switch between targets, since it shows the errors of one target at a time. (When the output isn’t an interactive terminal, such as when piping to a file, all errors are printed as usual.)

When the status changes to 🚨, there’s a similar animation as for ✅ – a growing and fading _red_ circle.

## Clickable error locations

In the error overlay you can click error locations to open them in your editor!

There’s no universal way of doing that, though, so you’ll have to set it up. It’s not that complicated: You need to set the `ELM_WATCH_OPEN_EDITOR` environment variable to some shell script code.

TL;DR examples:

- bash/zsh with VSCode: `export ELM_WATCH_OPEN_EDITOR='code --goto "$file:$line:$column"'`
- fish with Rider on macOS: `set -Ux ELM_WATCH_OPEN_EDITOR '/Applications/Rider.app/Contents/MacOS/rider --line "$line" --column "$((column - 1))" "$file"'`

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
| [IntelliJ IDEA] | `idea --line "$line" --column "$((column - 1))" "$file"` \* | `idea64.exe --line "%line%" "%file%"` † |
| [Rider] | `rider --line "$line" --column "$((column - 1))" "$file"` \* | `rider64.exe --line "%line%" "%file%"` † |
| [Sublime Text] | `subl "$file:$line:$column"` § | `subl "%file%:%line%:%column%"` § † |
| [Zed] | `zed "$file:$line:$column"` ‡ | n/a ([Zed is macOS-only for now]) |
| [Emacs] | `emacsclient --no-wait "+$line:$column" "$file"` | `emacsclient --no-wait "+%line%:%column%" "%file%"` † |

\* Neither IntelliJ IDEA nor Rider come with a command in PATH out of the box (at least on macOS). The easiest to it supply the full path. For example:

- IntelliJ IDEA on macOS: `"/Applications/IntelliJ IDEA.app/Contents/MacOS/idea" --line "$line" --column "$((column - 1))" "$file"`
- Rider on macOS: `/Applications/Rider.app/Contents/MacOS/rider --line "$line" --column "$((column - 1))" "$file"`
- Chances are other [JetBrains] IDEs work similarly, just with different names.
- Linux and Windows: If you use the JetBrains Toolbox to install, see [JetBrains Toolbox install locations].

† I haven’t tested IntelliJ IDEA, Rider, Sublime Text, or Emacs on Windows, so I’m not 100 % sure about those commands. Let me know if they do or do not work! Also note that I don’t know how to subtract 1 from the column on Windows, so the column might be off by one.

§ For Sublime Text, you might need to [enable the `subl` command][subl].

‡ For Zed, you will need to run `cli: install` from the command palette before this will work.

Don’t forget quotes around the `file` variable, in case it contains spaces! (`line` and `column` only contain digits, but it doesn’t hurt to quote them too.)

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

### With the JavaScript API

If you use the [JavaScript API](../javascript-api/), the `ELM_WATCH_OPEN_EDITOR` environment variable is ignored. Instead, you pass an `openEditor` function, which is called with `{ file, line, column }` (same as the environment variables above, but `line` and `column` are numbers). If it throws (or returns a promise that rejects), the error is shown in the browser.

Since people use different editors, it’s a good idea to let each developer choose their own command. Here’s how to keep supporting the `ELM_WATCH_OPEN_EDITOR` environment variable, so that it works just like with the elm-watch CLI:

```js
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { elmWatch } from "elm-watch";

process.exitCode = await elmWatch({
  // ...
  openEditor: openEditorFromEnv(),
});

/** @returns {import("elm-watch").OpenEditor | undefined} */
function openEditorFromEnv() {
  const command = process.env.ELM_WATCH_OPEN_EDITOR;
  if (command === undefined) {
    return undefined;
  }
  const execAsync = promisify(exec);
  return async ({ file, line, column }) => {
    await execAsync(command, {
      cwd: import.meta.dirname,
      env: {
        ...process.env,
        file,
        line: line.toString(),
        column: column.toString(),
      },
      timeout: 5000,
    });
  };
}
```

`elm-watch init --javascript` and `elm-watch init --typescript` generate that code for you.

[child_process.exec]: https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback
[direnv]: https://direnv.net/
[emacs]: https://www.gnu.org/software/emacs/
[intellij idea]: https://www.jetbrains.com/idea/
[jetbrains toolbox install locations]: https://toolbox-support.jetbrains.com/hc/en-us/articles/115000978804-Where-are-the-IDEs-located-on-my-hard-drive-
[jetbrains]: https://www.jetbrains.com/
[rider]: https://www.jetbrains.com/rider/
[subl]: https://www.sublimetext.com/docs/command_line.html
[sublime text]: https://www.sublimetext.com/
[vscode]: https://code.visualstudio.com/
[Zed is macOS-only for now]: https://github.com/zed-industries/zed/issues/5391
[Zed]: https://zed.dev/
