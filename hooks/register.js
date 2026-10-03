// session-dashboard: a side pane with the prompt cache's state, tool calls and
// errors, background commands, the task list, and token usage per agent.

import {
  applyTaskCreate,
  applyTaskList,
  applyTaskUpdate,
  applyTodoWrite,
  backgroundIdOf,
  cacheStatus,
  classifyToolResult,
  emptySnapshot,
  emptyTokens,
  firstLine,
  matchProcess,
  parseLsof,
  parseNetstat,
  parseProcessList,
  parseTaskNotification,
  pushError,
} from './lib.js'
import { renderDashboard } from './view.js'

const PANE = 'session-dashboard'
const NO_DOCK =
  'Dashboard opens as a right-hand sidebar only in the fullscreen layout: start Claude Code with CLAUDE_CODE_NO_FLICKER=1 in a terminal at least 110 columns wide'
const BACKGROUND_TOOLS = ['Bash', 'PowerShell', 'Monitor']

// Added to each prompt so the model keeps a task list the pane can show
const TASK_NUDGE =
  'Keep a task list for this request with your task tool (TaskCreate/TaskUpdate, or TodoWrite if that is the one you have) ' +
  'whenever the work takes more than one step: create the tasks before starting, mark exactly one in_progress while you work on it, ' +
  'and mark each completed as soon as it is done. For a single quick step, one task is enough.'

// Lists every process as `pid<TAB>ppid<TAB>command line`
const PS_SCRIPT =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_Process | ForEach-Object { "{0}`t{1}`t{2}" -f $_.ProcessId,$_.ParentProcessId,$_.CommandLine }'

// What the pane shows. Mirrored into $.state so it survives a hot reload.
let S = emptySnapshot()
let options = {}
let paneOpen = false
// Whether the terminal docks panes beside the transcript (fullscreen layout).
// Learned from the first drawing; undefined until then.
let isFullscreen
// auto_open waits here until a drawing says the pane would dock on the right
let wantsAutoOpen = false
let errorsOpen = false
let ttlMs = 5 * 60_000
let ttlSource = 'default'
let isWindows = false
let scanning = false
let ticks = 0
let usage = null
const agentLabels = new Map()

export function register(on, opts) {
  options = opts ?? {}

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restore($)
    await detectEnvironment($)
    paneOpen = (await $.ui.panes()).some((p) => p.id === PANE)

    // One timer drives the countdown, the usage figures, and the process scan
    $.clock.every(1000, () => onTick($))

    // Opened unasked only as a right-hand sidebar, never above the prompt:
    // the AbovePrompt hook opens it once it learns the layout docks panes
    wantsAutoOpen = options.auto_open !== false && !paneOpen

    // Register commands last: a name that is taken throws
    await $.command.register({
      name: 'session-dashboard',
      description: 'Toggle the session dashboard pane (open | close | reset)',
      argumentHint: '[open|close|reset]',
      immediate: true,
    })
    try {
      await $.command.register({
        name: 'dashboard',
        description: 'Toggle the session dashboard pane (open | close | reset)',
        argumentHint: '[open|close|reset]',
        immediate: true,
      })
    } catch {
      // Another plugin or a built-in owns /dashboard; /session-dashboard still works
    }
    return started
  })

  // /clear, /resume and /branch start a new conversation: start the counts over
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    S = emptySnapshot()
    agentLabels.clear()
    changed($)
    return next(e)
  })

  // ---- Commands -----------------------------------------------------------

  on('command.run', { command: ['dashboard', 'session-dashboard'] }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'reset') {
      S = emptySnapshot()
      changed($)
      $.ui.toast('Counters reset')
      return {}
    }
    const isUp = (await $.ui.panes()).some((p) => p.id === PANE)
    if (arg === 'close' || (isUp && arg !== 'open')) {
      await $.ui.close({ id: PANE })
      paneOpen = false
      return {}
    }
    if (!e.presentation?.isFullscreen) {
      $.ui.toast(NO_DOCK)
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: 'Dashboard', focus: true, columns: 54 })
    paneOpen = true
    if (!opened.isPlaced) $.ui.toast('Dashboard is waiting: ' + opened.reason)
    await refreshUsage($)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // ---- Tool calls, errors, tasks, background commands ---------------------

  on('tool.call', async ($, e, next) => {
    S.toolCalls.total += 1
    if (e.agentId === undefined) S.toolCalls.main += 1
    else S.toolCalls.sub += 1
    $.ui.invalidate('ui.render')

    let result
    try {
      result = await next(e)
    } catch (error) {
      pushError(S, { at: Date.now(), tool: e.tool, kind: 'tool crashed', message: firstLine(error?.message) })
      changed($)
      throw error
    }
    afterToolCall($, e, result)
    return result
  })

  // Background tasks report back when they end
  on('session.receive', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      const note = parseTaskNotification(e.text)
      const proc = note && S.procs.find((p) => p.taskId === note.id)
      if (proc) {
        const failed = note.status === 'failed' || (note.exitCode !== undefined && note.exitCode !== 0)
        proc.status = failed ? 'failed' : note.status === 'killed' ? 'stopped' : 'exited'
        if (failed) {
          pushError(S, {
            at: Date.now(),
            tool: proc.tool,
            kind: 'background failed',
            message: proc.command + (note.exitCode !== undefined ? ' (exit ' + note.exitCode + ')' : ''),
          })
        }
        changed($)
      }
    }
    return next(e)
  })

  // At the end of each response, the engine lists the background work still in flight
  on('classic.Stop', async ($, e, next) => {
    reconcileBackground($, e.background_tasks)
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    pushError(S, { at: Date.now(), tool: 'API', kind: 'API error', message: firstLine(e.error_details ?? e.error) })
    changed($)
    return next(e)
  })

  // ---- Tokens and the prompt cache ----------------------------------------

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result?.usage) await recordUsage($, e.agentId, result.usage)
    return result
  })

  // ---- Force a task list --------------------------------------------------

  on('prompt.submit', async ($, e, next) => {
    if (options.force_task_list === false) return next(e)
    return next({ ...e, context: [...(e.context ?? []), TASK_NUDGE] })
  })

  // ---- Drawing ------------------------------------------------------------

  // Drawn on every screen update: learns whether the layout docks panes, and
  // makes the deferred auto-open once it would land on the right
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    if (wantsAutoOpen && isFullscreen !== undefined) {
      wantsAutoOpen = false
      if (isFullscreen && !paneOpen) {
        paneOpen = true
        void $.ui.open({ id: PANE, title: 'Dashboard', columns: 54 })
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    // Seated above the prompt (a pane kept from a main-screen session): close it
    if (e.surface === 'terminal' && e.props.placement === 'inline') {
      paneOpen = false
      void $.ui.close({ id: PANE })
    }
    const E = $.ui.resolve(e)
    const now = Date.now()
    const redraw = () => $.ui.invalidate('ui.render')

    return renderDashboard(
      E,
      {
        width: (e.props.bodyColumns ?? 54) - 1,
        now,
        snap: S,
        cache: cacheStatus(S.cache, now, ttlMs),
        ttlMs,
        ttlSource,
        usage,
        errorsOpen,
      },
      {
        refresh: (proc) => restartProcess($, proc),
        close: (proc) => closeProcess($, proc),
        toggleErrors: () => {
          errorsOpen = !errorsOpen
          redraw()
        },
        rescan: () => scanProcesses($, true),
        clearExited: () => {
          S.procs = S.procs.filter((p) => p.status === 'running')
          changed($)
        },
        closePane: async () => {
          await $.ui.close({ id: PANE })
          paneOpen = false
        },
      },
    )
  })
}

// ---------------------------------------------------------------------------
// State

async function restore($) {
  const { value } = await $.state.get({ plugin: 'session-dashboard', key: 'snapshot' })
  if (value && typeof value === 'object') S = { ...emptySnapshot(), ...value }
}

/** Saves the snapshot for the next hot reload and redraws the pane. */
function changed($) {
  $.state.set({ plugin: 'session-dashboard', key: 'snapshot' }, S).catch(() => {})
  $.ui.invalidate('ui.render')
}

async function detectEnvironment($) {
  const cwd = await $.session.cwd()
  isWindows = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\')

  const configured = Number(options.cache_ttl_minutes ?? 0)
  if (configured > 0) {
    ttlMs = configured * 60_000
    ttlSource = 'config'
    return
  }
  // Subscription (OAuth) sessions get the 1-hour prompt cache; API keys the 5-minute one
  try {
    const auth = await $.session.authorize()
    ttlMs = auth?.kind === 'bearer' ? 60 * 60_000 : 5 * 60_000
    ttlSource = 'auto'
  } catch {
    ttlMs = 5 * 60_000
    ttlSource = 'default'
  }
}

async function refreshUsage($) {
  try {
    usage = await $.session.usage()
  } catch {
    // Keep the last figures
  }
}

async function onTick($) {
  ticks += 1
  if (paneOpen) {
    if (ticks % 2 === 0) await refreshUsage($)
    $.ui.invalidate('ui.render')
  }
  // Scan every 5 s while the pane is open, every 30 s otherwise
  const hasRunning = S.procs.some((p) => p.status === 'running')
  if (hasRunning && ticks % (paneOpen ? 5 : 30) === 0) await scanProcesses($, false)
}

// ---------------------------------------------------------------------------
// Tool calls

function afterToolCall($, e, result) {
  const error = classifyToolResult(e.tool, result)
  if (error) pushError(S, { at: Date.now(), tool: e.tool, agentId: e.agentId, ...error })

  const ok = result && !result.deny && !result.isError
  if (ok) {
    if (e.tool === 'TodoWrite' && e.agentId === undefined) applyTodoWrite(S, e.todos)
    else if (e.tool === 'TaskCreate') applyTaskCreate(S, e, result.result)
    else if (e.tool === 'TaskUpdate') applyTaskUpdate(S, e)
    else if (e.tool === 'TaskList') applyTaskList(S, result.result)
    else if (e.tool === 'TaskStop') {
      const id = e.task_id ?? e.shell_id
      for (const p of S.procs) if (p.taskId === id && p.status === 'running') p.status = 'stopped'
    }
  }

  if (ok && BACKGROUND_TOOLS.includes(e.tool)) {
    const taskId = backgroundIdOf(result)
    if (taskId || e.run_in_background) trackBackground($, e, taskId)
  }
  changed($)
}

function trackBackground($, e, taskId) {
  const input = {}
  for (const k of ['command', 'description', 'timeout', 'timeout_ms']) if (e[k] !== undefined) input[k] = e[k]
  S.procs = [
    ...S.procs.filter((p) => p.taskId !== taskId || !taskId),
    {
      id: taskId ?? e.tool_use_id,
      taskId,
      tool: e.tool,
      input,
      command: e.command ?? e.description ?? e.tool,
      status: 'running',
      startedAt: Date.now(),
      pid: 0,
      rootPid: 0,
      pids: [],
      ports: [],
      seen: false,
      misses: 0,
    },
  ]
  // Give the process a moment to start and open its port
  $.clock.after(1500, () => scanProcesses($, false))
  $.clock.after(6000, () => scanProcesses($, false))
}

function reconcileBackground($, tasks) {
  if (!Array.isArray(tasks)) return
  const live = new Set(tasks.map((t) => t.id))
  let isChanged = false
  for (const p of S.procs) {
    if (p.status === 'running' && p.taskId && !live.has(p.taskId)) {
      p.status = 'exited'
      isChanged = true
    }
  }
  // Shell tasks the pane doesn't know yet, such as ones started before a reload
  for (const t of tasks) {
    if (t.type !== 'shell' || !t.command || S.procs.some((p) => p.taskId === t.id)) continue
    S.procs = [
      ...S.procs,
      {
        id: t.id,
        taskId: t.id,
        tool: 'Bash',
        input: { command: t.command, description: t.description },
        command: t.command,
        status: 'running',
        startedAt: Date.now(),
        pid: 0,
        rootPid: 0,
        pids: [],
        ports: [],
        seen: false,
        misses: 0,
      },
    ]
    isChanged = true
  }
  if (isChanged) changed($)
}

// ---------------------------------------------------------------------------
// Tokens

async function recordUsage($, agentId, u) {
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  const input = u.input_tokens ?? 0
  const output = u.output_tokens ?? 0
  const now = Date.now()

  let row
  if (agentId === undefined) {
    row = S.tokens.main
    // The main thread's request decides whether the cache is warm
    const c = S.cache
    const prompt = read + write + input
    const isMiss = c.requests > 0 && prompt > 0 && read / prompt < 0.5
    const wasExpired = c.lastAt > 0 && now - c.lastAt > ttlMs
    S.cache = {
      lastAt: now,
      read,
      write,
      input,
      requests: c.requests + 1,
      misses: c.misses + (isMiss ? 1 : 0),
      lastMiss: isMiss ? (wasExpired ? 'expired' : 'invalidated') : null,
    }
  } else {
    row = S.tokens.agents[agentId]
    if (!row) {
      row = { ...emptyTokens(await agentLabel($, agentId)), id: agentId }
      S.tokens.agents[agentId] = row
    }
  }
  row.input += input
  row.output += output
  row.cacheRead += read
  row.cacheWrite += write
  row.requests += 1
  changed($)
}

async function agentLabel($, agentId) {
  if (!agentLabels.has(agentId)) {
    try {
      for (const a of await $.agent.list()) agentLabels.set(a.id, a.type + ' · ' + a.description)
    } catch {
      // Fall through to the generic label
    }
  }
  return agentLabels.get(agentId) ?? 'internal ' + agentId.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Processes

/** Every OS process with its parent and command line, and the TCP ports each one listens on. */
async function listProcesses($) {
  if (isWindows) {
    const [list, net] = await Promise.all([
      $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { timeoutMs: 20_000 }),
      $.process.run(['netstat', '-ano'], { timeoutMs: 10_000 }).catch(() => ({ stdout: '' })),
    ])
    return { procs: parseProcessList(list.stdout, true), ports: parseNetstat(net.stdout) }
  }
  const [list, net] = await Promise.all([
    $.process.run(['ps', '-axo', 'pid=,ppid=,args='], { timeoutMs: 10_000 }),
    $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeoutMs: 10_000 }).catch(() => ({ stdout: '' })),
  ])
  return { procs: parseProcessList(list.stdout, false), ports: parseLsof(net.stdout) }
}

async function scanProcesses($, isManual) {
  if (scanning) return
  const running = S.procs.filter((p) => p.status === 'running')
  if (running.length === 0) {
    if (isManual) $.ui.toast('Nothing running to scan')
    return
  }
  scanning = true
  try {
    const { procs, ports } = await listProcesses($)
    for (const p of running) {
      const hit = matchProcess(p.command, procs, ports)
      if (hit) {
        Object.assign(p, hit, { seen: true, misses: 0 })
      } else if (p.seen) {
        p.misses += 1
        // Gone on two scans in a row: it ended
        if (p.misses >= 2) {
          p.status = 'exited'
          p.ports = []
        }
      }
    }
    changed($)
  } catch (error) {
    if (isManual) $.ui.toast('Scan failed: ' + firstLine(error?.message))
  } finally {
    scanning = false
  }
}

async function stopProcess($, proc) {
  if (proc.taskId) {
    try {
      await $.tool.call({ tool: 'TaskStop', task_id: proc.taskId })
    } catch {
      // The task may be gone already; the OS kill below covers it
    }
  }
  // Whatever outlived the task (a detached child, a server that ignores the signal).
  // Look again first, so a pid the OS has since reused is never killed.
  try {
    const { procs, ports } = await listProcesses($)
    const left = matchProcess(proc.command, procs, ports)
    if (left) {
      const argv = isWindows ? ['taskkill', '/PID', String(left.rootPid), '/T', '/F'] : ['kill', '-TERM', ...left.pids.map(String)]
      await $.process.run(argv, { timeoutMs: 10_000 })
    }
  } catch {
    // Already gone, or the OS refused; the task stop above is what counts
  }
  proc.status = 'stopped'
  proc.ports = []
}

async function closeProcess($, proc) {
  if (proc.status !== 'running') {
    S.procs = S.procs.filter((p) => p.id !== proc.id)
    changed($)
    return
  }
  await stopProcess($, proc)
  changed($)
  $.ui.toast('Stopped: ' + proc.command)
}

async function restartProcess($, proc) {
  if (proc.status === 'running') await stopProcess($, proc)
  const args = { tool: proc.tool, ...proc.input }
  if (proc.tool !== 'Monitor') args.run_in_background = true
  args.consent = 'The user pressed "Refresh" on the session-dashboard pane to restart this command: ' + proc.command

  let result
  try {
    result = await $.tool.call(args)
  } catch (error) {
    result = { deny: firstLine(error?.message) || 'could not start' }
  }
  if (result.deny || result.isError) {
    pushError(S, { at: Date.now(), tool: proc.tool, kind: 'restart failed', message: firstLine(result.deny ?? result.text) })
    changed($)
    $.ui.toast('Restart failed: ' + firstLine(result.deny ?? result.text))
    return
  }
  const taskId = backgroundIdOf(result)
  S.procs = S.procs.map((p) =>
    p.id !== proc.id
      ? p
      : {
          ...p,
          id: taskId ?? p.id + '-r',
          taskId,
          status: 'running',
          startedAt: Date.now(),
          pid: 0,
          rootPid: 0,
          pids: [],
          ports: [],
          seen: false,
          misses: 0,
          restarts: (p.restarts ?? 0) + 1,
        },
  )
  changed($)
  $.ui.toast('Restarted: ' + proc.command)
  $.clock.after(1500, () => scanProcesses($, false))
  $.clock.after(6000, () => scanProcesses($, false))
}
