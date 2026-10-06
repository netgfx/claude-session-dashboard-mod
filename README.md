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
LINKED FOLDERS 2                                  [+]
shared-docs     → D:\team\shared-docs          [✎] [✕]
api             → D:\src\backend-api           [✎] [✕]
─────────────────────────────────────────────────────
TASKS
● now  working  1:24
  Repurpose the tasks section
↳ Bash · Run the tests

● plan Repurpose the tasks section · approved 4m ago
 1 Parse the plan from ExitPlanMode
 2 Draw each group in its own color
 3 Add tests

● subagents 1 running
▶ Explore · find routing files                    12k
☑ general-purpose · review the diff               48k

● swarm 1 of 2 working · /swarm
▶ scout · Bash: npm test                          52k
! fixer · needs approval
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
─────────────────────────────────────────────────────
TOTAL DISTRIBUTION 2.7M tokens · 14 turns
      ▄▄▄▄          ██ input                     1.5k
   ▄▄▄▄▄▄▄▄▄▄       ██ output                     18k
  ████████████      ██ tool use                   64k
 ██████86%█████     ██ cache read                2.3M
  ████████████      ██ cache write               200k
   ▀▀▀▀▀▀▀▀▀▀       ██ retries                    4.1k
p: show small %
tool use and retries are estimated from call sizes
```

## What it shows

| Section | Where the data comes from |
| :- | :- |
| **Cache (Hot / Cold)** | Each main-thread model request (`turn.step` usage). Hot (orange) until the cache TTL passes since the last request, then Cold (blue). Flags a request that missed a warm cache as *invalidated*. |
| **Tool calls / errors** | Every `tool.call`, main agent and subagents. Errors: tool errors, permission denials, HTTP 4xx/5xx and "command not found", tracebacks, build errors found in command output, failed background tasks, API errors (`StopFailure`). |
| **Background** | Commands Claude runs with `run_in_background` (Bash, PowerShell, Monitor) or that you push to the background with Ctrl+B. PID and listening ports come from the OS process table. **↻** stops the command and starts it again; **✕** stops it (and kills any child process that survives). |
| **Linked folders** | **+** opens your OS folder picker (Windows folder dialog, macOS `choose folder`, `zenity` or `kdialog` on Linux; with none, a path field). The folder is linked into the workspace root (a symlink, or a junction on Windows without Developer Mode) and added as `/<name>` under a `# Linked folders (session-dashboard)` header in `.gitignore`. **✎** renames the link and its `.gitignore` entry; **✕** removes the link and the entry, never the folder itself. The list is kept per workspace across sessions. |
| **Tasks** | What the session is working through, each group in its own color. **now**: what the main agent is on, labelled **working** (green), **waiting** (amber: a permission dialog, a question or a plan waiting for you) or **done** (grey, with *answered*, *interrupted* or *stopped on an API error*), with your request (or the task in progress) and its current step, such as `Bash · Run the tests` or *thinking*. **plan** (purple): the steps of the plan last approved in plan mode (`ExitPlanMode`), ticked when the turn that carries it out ends. **task list** (blue): `TaskCreate` / `TaskUpdate` / `TaskList` or `TodoWrite`, in sessions that have those tools; since Claude Code 2.1.233 newer models get them only in background and cloud sessions or with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. **subagents** (teal): each subagent as `type · description`, with its status and tokens; the last 8 stay listed. **swarm** (pink): with [swarm-mod](https://github.com/netgfx/claude-swarm-mod) loaded, its agents' activity and tokens, and `!` / `?` when one waits on you; its teammates are not listed again under subagents. |
| **Tokens** | Input, output, cache read and cache write per agent, with subagents labelled by type and description, plus context window use and session cost. |
| **Total distribution** | Appears once the first turn ends and refreshes at the end of each turn. A pie of every token the session has used, split into input, output, tool use, cache read, cache write and retries. Slices wide enough carry their share inside; **show small %** (`p`) lists the narrow ones' shares in the ledger, and pressing a ledger entry shows or hides its share. Tool use is the output spent writing tool calls plus the tool results sent back (≈4 characters a token); retries are a request resent after one that got no response, and calls that redo a tool that just failed. |

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

Keys while the pane has focus (click it, or Ctrl+X then Tab): `q` hides it, `e` shows or hides the error list, `s` rescans processes, `x` clears ended commands, `l` links a folder, `p` shows the narrow slices' shares in the distribution, Tab moves between the ↻ / ✕ buttons, Esc returns to the prompt.

Installing through the marketplace loads it in every session. For a local checkout, add the directory to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env`).

## Settings (`userConfig`)

| Key | Default | Meaning |
| :- | :- | :- |
| `auto_open` | `true` | Open the pane when a session starts |
| `force_task_list` | `false` | Ask Claude to keep a task list on every prompt. Only useful where the task tools exist (older models, or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`) |
| `cache_ttl_minutes` | `0` | Prompt cache lifetime. `0` = 60 min when signed in with a subscription, 5 min with an API key |

## Develop

```shell
claude plugin validate .
claude plugin test
```

Tested with Claude Code 2.1.287 on Windows 11. PID and port lookup uses PowerShell `Get-CimInstance` and `netstat` on Windows, `ps` and `lsof` elsewhere.
