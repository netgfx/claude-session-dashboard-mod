# session-dashboard

A Claude Code mod that adds a live side pane for the current session.

```
SESSION DASHBOARD                               hide
███ Cache (Hot)                      expires in 54:12
last request 97% cached · TTL 60m (auto)
─────────────────────────────────────────────────────
TOOL CALLS                ERRORS
128                       3
main 101 · sub 27         HTTP 404 2m ago
▸ show errors
─────────────────────────────────────────────────────
BACKGROUND 1 running
PID    PORT   COMMAND
18320  5000   dotnet run                       [↻] [✕]
─────────────────────────────────────────────────────
TASKS 2/4 ▰▰▰▰▰▰▱▱▱▱▱▱
now  Writing the render code
next Add tests
▶ Writing the render code
☐ Add tests
☑ Scaffold the plugin
─────────────────────────────────────────────────────
TOKENS 42 requests
                 in    out   c.read  c.write
main agent      1.2k   18k     2.1M     140k
subagents (1)    310  4.2k     380k      60k
  Explore · …    310  4.2k     380k      60k
total           1.5k   22k     2.5M     200k

context 34% of 200k · $1.84
─────────────────────────────────────────────────────
USAGE LIMITS
5-hour ███████                         23%      2h 15m
weekly ███                              8%       3d 4h
```

## What it shows

| Section | Where the data comes from |
| :- | :- |
| **Cache (Hot / Cold)** | Each main-thread model request (`turn.step` usage). Hot (orange) until the cache TTL passes since the last request, then Cold (blue). Flags a request that missed a warm cache as *invalidated*. |
| **Tool calls / errors** | Every `tool.call`, main agent and subagents. Errors: tool errors, permission denials, HTTP 4xx/5xx and "command not found", tracebacks, build errors found in command output, failed background tasks, API errors (`StopFailure`). |
| **Background** | Commands Claude runs with `run_in_background` (Bash, PowerShell, Monitor) or that you push to the background with Ctrl+B. PID and listening ports come from the OS process table. **↻** stops the command and starts it again; **✕** stops it (and kills any child process that survives). |
| **Tasks** | `TaskCreate` / `TaskUpdate` / `TaskList` or `TodoWrite`. Each prompt gets a one-line instruction asking Claude to keep a task list (turn off with `force_task_list`). |
| **Tokens** | Input, output, cache read and cache write per agent, with subagents labelled by type and description, plus context window use and session cost. |

## Install

This repo is a Claude Code plugin marketplace. Add it and install the plugin:

```shell
/plugin marketplace add netgfx/claude-session-dashboard-mod
/plugin install session-dashboard@claude-session-dashboard-mod
```

Or run it from a local checkout:

```shell
claude --plugin-dir /path/to/claude-session-dashboard-mod
```

Then type in the Claude Code prompt:

| Command | What it does |
| :- | :- |
| `/dashboard` or `/session-dashboard` | Toggles the pane |
| `/dashboard open` / `/dashboard close` | Opens or closes it |
| `/dashboard reset` | Zeroes the counters |

The pane only ever opens as a sidebar on the right. Claude Code docks panes there only in the **fullscreen** layout, at 110 columns or wider. On the main screen it would put the pane above the prompt, so the dashboard stays closed there and `/dashboard` shows a toast explaining why. To get the fullscreen layout, start Claude Code with `CLAUDE_CODE_NO_FLICKER=1` (outside tmux). On start, the pane opens by itself once the terminal is at least 144 columns wide.

Keys while the pane has focus (click it, or Ctrl+X then Tab): `q` hides it, `e` shows or hides the error list, `s` rescans processes, `x` clears ended commands, Tab moves between the ↻ / ✕ buttons, Esc returns to the prompt.

Installing through the marketplace loads it in every session. For a local checkout, add the directory to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env`).

## Settings (`userConfig`)

| Key | Default | Meaning |
| :- | :- | :- |
| `auto_open` | `true` | Open the pane when a session starts |
| `force_task_list` | `true` | Ask Claude to keep a task list on every prompt |
| `cache_ttl_minutes` | `0` | Prompt cache lifetime. `0` = 60 min when signed in with a subscription, 5 min with an API key |

## Develop

```shell
claude plugin validate .
claude plugin test
```

Tested with Claude Code 2.1.287 on Windows 11. PID and port lookup uses PowerShell `Get-CimInstance` and `netstat` on Windows, `ps` and `lsof` elsewhere.
