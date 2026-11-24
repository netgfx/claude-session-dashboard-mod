# Session Dashboard

A Claude Code mod (`powermods-session-dashboard`) that adds a live side pane for the current session.

> **Claude Code only.** Runs in the Claude Code CLI (v2.1.287+), the Desktop app's Code tab (v2.1.286+) and the VS Code extension (v2.1.299+ for panes). It does nothing in claude.ai chat or Cowork.

What it reads, writes, runs and stores is listed under [Data, network and permissions](#data-network-and-permissions). Privacy statement: [PRIVACY.md](PRIVACY.md).

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
| **Background** | Commands Claude runs with `run_in_background` (Bash, PowerShell, Monitor) or that you push to the background with Ctrl+B. PID and listening ports come from the processes under this Claude Code session only (see [Processes it lists](#processes-it-lists)). **↻** stops the command and starts it again; **✕** stops it (and kills any child process that survives). |
| **Linked folders** | **+** opens your OS folder picker (Windows folder dialog, macOS `choose folder`, `zenity` or `kdialog` on Linux; with none, a path field). The folder is linked into the workspace root (a symlink, or a junction on Windows without Developer Mode) and added as `/<name>` under a `# Linked folders (session-dashboard)` header in `.gitignore`. **✎** renames the link and its `.gitignore` entry; **✕** removes the link and the entry, never the folder itself. The list is kept per workspace across sessions. Folder links already at the workspace root (made with `ln -s`, `mklink` or a junction) are listed too, within 10 s while the pane is open; renaming or removing one leaves `.gitignore` alone unless it had an entry. |
| **Tasks** | What the session is working through, each group in its own color. **now**: what the main agent is on, labelled **working** (green), **waiting** (amber: a permission dialog, a question or a plan waiting for you) or **done** (grey, with *answered*, *interrupted* or *stopped on an API error*), with your request (or the task in progress) and its current step, such as `Bash · Run the tests` or *thinking*. **plan** (purple): the steps of the plan last approved in plan mode (`ExitPlanMode`), ticked when the turn that carries it out ends. **task list** (blue): `TaskCreate` / `TaskUpdate` / `TaskList` or `TodoWrite`, in sessions that have those tools; since Claude Code 2.1.233 newer models get them only in background and cloud sessions or with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. **subagents** (teal): each subagent as `type · description`, with its status and tokens; the last 8 stay listed. **swarm** (pink): with the [Swarm](https://github.com/netgfx/claude-swarm-mod) mod loaded (`powermods-swarm`, or its former name `swarm-mod`), its agents' activity and tokens, and `!` / `?` when one waits on you; its teammates are not listed again under subagents. |
| **Tokens** | Input, output, cache read and cache write per agent, with subagents labelled by type and description, plus context window use and session cost. |
| **Total distribution** | Appears once the first turn ends and refreshes at the end of each turn. A pie of every token the session has used, split into input, output, tool use, cache read, cache write and retries. Slices wide enough carry their share inside; **show small %** (`p`) lists the narrow ones' shares in the ledger, and pressing a ledger entry shows or hides its share. Tool use is the output spent writing tool calls plus the tool results sent back (≈4 characters a token); retries are a request resent after one that got no response, and calls that redo a tool that just failed. |

## Install

This repo is a Claude Code plugin marketplace. Add it and install the plugin:

```shell
/plugin marketplace add netgfx/claude-session-dashboard-mod
/plugin install powermods-session-dashboard@claude-session-dashboard-mod
```

The plugin was called `session-dashboard` before version 0.3.0. The marketplace maps the old name to the new one, so an existing install moves over when you update it. The list of linked folders was kept under the old name: the dashboard finds the folder links at the workspace root again on its own, so nothing needs doing.

Or run it from a local checkout:

```shell
claude --plugin-dir /path/to/claude-session-dashboard-mod
```

Then type in the Claude Code prompt:

| Command | What it does |
| :- | :- |
| `/session-dashboard` | Toggles the pane |
| `/session-dashboard open` / `/session-dashboard close` | Opens or closes it |
| `/session-dashboard reset` | Zeroes the counters |

The pane only ever opens as a sidebar on the right. Claude Code docks panes there only in the **fullscreen** layout, at 110 columns or wider. On the main screen it would put the pane above the prompt, so the dashboard stays closed there and `/session-dashboard` shows a toast explaining why. To get the fullscreen layout, start Claude Code with `CLAUDE_CODE_NO_FLICKER=1` (outside tmux). On start, the pane opens by itself once the terminal is at least 144 columns wide.

Keys while the pane has focus (click it, or Ctrl+X then Tab): `q` hides it, `e` shows or hides the error list, `s` rescans processes, `x` clears ended commands, `l` links a folder, `p` shows the narrow slices' shares in the distribution, Tab moves between the ↻ / ✕ buttons, Esc returns to the prompt.

Installing through the marketplace loads it in every session. For a local checkout, add the directory to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env`).

## Settings (`userConfig`)

| Key | Default | Meaning |
| :- | :- | :- |
| `auto_open` | `true` | Open the pane when a session starts |
| `force_task_list` | `false` | Ask Claude to keep a task list on every prompt. Only useful where the task tools exist (older models, or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`) |
| `cache_ttl_minutes` | `0` | Prompt cache lifetime in minutes. `0` guesses it from the session's usage figures (`$.session.usage()`): 60 once they show a Claude subscription's plan limits (5-hour or weekly window), 5 otherwise, as with an API key. Set it when the guess is wrong for your setup |

## Data, network and permissions

The dashboard watches the session and draws what it sees. It never approves, denies or rewrites a tool call, sends nothing over the network, and calls no model.

### What it watches

- **Tool calls** (`tool.call`): counts every call, reads its input and result to find errors, background task ids and task-list updates, then passes the call on unchanged.
- **Turns and requests** (`turn.start`, `turn.step`, `turn.complete`): your request's text (first 9,000 characters, for the "now" row), and each model response's token usage.
- **Settings hooks** `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionStart`: to end a turn, record API errors, and list subagents.
- **`PermissionRequest`**: only observes, to show "needs approval" while a permission dialog waits on you. It never answers the dialog.
- **Messages to the session** (`session.receive`): reads background-task notifications to mark a command ended or failed, and passes every message on unchanged.
- **Prompts** (`prompt.submit`): unchanged, unless you turn on `force_task_list` (off by default). Then it adds this text as context to each prompt:

  > Keep a task list for this request with your task tool (TaskCreate/TaskUpdate, or TodoWrite if that is the one you have) whenever the work takes more than one step: create the tasks before starting, mark exactly one in_progress while you work on it, and mark each completed as soon as it is done. For a single quick step, one task is enough.

### What it reads

- **Session figures**: `$.session.usage()` (context use, plan rate limits, cost), the working directory and workspace root, and `$.agent.list()` for subagent names and status.
- **The transcript** (`$.session.messages()`): only after a hot reload of the mod, to find the full text of the request the "now" row shows when only its first line was kept.
- **The approved plan**: the plan file that `ExitPlanMode` names, when the plan text isn't in its result.
- **The workspace root**: its entries, to list folder links and match the saved list.
- **The Swarm mod's state**: the `snapshot` value that the Swarm mod publishes (`powermods-swarm`, or `swarm-mod` for older versions), read only, to show its agents.
- It reads no settings and changes no environment variables.

### Processes it lists

Only processes under this Claude Code process are read, matched, drawn or stopped. Processes started by anything else on the machine, including other Claude Code sessions and other users, are never kept, and no command line goes into the mod's state. Scans run only while a background command it tracks is running: 1.5 s and 6 s after the command starts, then every 5 s with the pane open or every 30 s with it closed, and when you press **rescan**, **↻** or **✕**.

- **Windows**: `powershell -NoProfile -NonInteractive -Command <scan>`, where the scan finds its own parent (Claude Code) with `Get-CimInstance Win32_Process` and prints only the processes under it; other command lines never leave PowerShell. `netstat -ano` for listening ports, kept for those processes only.
- **macOS and Linux**: `sh -c 'echo $PPID'` once, to learn Claude Code's process id; `ps -A -o pid=,ppid=` (process ids and parents only, no command lines) to find the processes under it; then `ps -o pid=,ppid=,args= -p <those pids>` and `lsof -nP -a -p <those pids> -iTCP -sTCP:LISTEN -Fpn` for their command lines and listening ports.

### What it runs when you press a button

- **✕ (stop)**: asks Claude Code to stop the background task (`TaskStop`), then looks at the processes again and, if the command's process tree under Claude Code is still there, ends it with `taskkill /PID <pid> /T /F` (Windows) or `kill -TERM <pids>` (macOS, Linux). The pid is re-checked right before, so a reused pid is never killed. Nothing is stopped without your press.
- **↻ (restart)**: stops the command as above, then runs the same command again in the background through Claude Code's own tool (Bash, PowerShell or Monitor), with a note that you pressed Refresh. Claude Code's permission rules still apply to that call.
- **+ (link a folder)**: opens your OS folder picker (`powershell -STA` with a Windows folder dialog, `osascript` on macOS, `zenity` or `kdialog` on Linux), or a path field when there is none. It then creates a link to that folder at the workspace root: a symbolic link, or a junction on Windows without Developer Mode (`powershell` running `New-Item -ItemType SymbolicLink` or `Junction`, `ln -sn` elsewhere), and adds `/<name>` under a `# Linked folders (session-dashboard)` header in the project's `.gitignore`.
- **✎ (rename)** and **✕ on a link**: rename or remove the link (`powershell` deleting the link only, or `rm <link>`) and its `.gitignore` entry. The linked folder itself is never touched.

Links and `.gitignore` edits happen only from the Linked folders section of the pane.

### What it stores

- **`$.store`** (a JSON file of the plugin's own under `~/.claude/plugins/store/`, shared by every Claude Code session on this machine): the linked-folder list per workspace, as the link name, the target folder's path and when it was added. Kept until you remove the link with ✕, or delete the file whose name starts with `powermods-session-dashboard_` there.
- **`$.state`** (held in memory by Claude Code for this session, so a hot reload doesn't zero the counts): the pane's figures, including your current request's text, tool-call summaries and error messages. Gone when the session ends.

### Network and models

- No hosts. The dashboard makes no network requests (`network.hosts` is empty) and sends nothing to a model.

## Develop

```shell
claude plugin validate .
claude plugin test
```

Tested with Claude Code 2.1.331 on Windows 11. PID and port lookup uses PowerShell `Get-CimInstance` and `netstat` on Windows, `ps` and `lsof` elsewhere, for this session's process tree only.
