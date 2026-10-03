// Pure helpers: no mods API calls here, so they can be imported and unit tested.

export const MAX_ERRORS = 50

/** A fresh, empty snapshot of everything the dashboard tracks. */
export function emptySnapshot() {
  return {
    toolCalls: { total: 0, main: 0, sub: 0 },
    errors: [],
    errorCount: 0,
    procs: [],
    tasks: { source: null, items: [] },
    tokens: { main: emptyTokens('main'), agents: {} },
    cache: { lastAt: 0, read: 0, write: 0, input: 0, misses: 0, requests: 0, lastMiss: null },
  }
}

export function emptyTokens(label) {
  return { label, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
}

/** 1234 -> "1.2k", 1234567 -> "1.2M". */
export function fmtNum(n) {
  n = Number(n) || 0
  if (n < 1000) return String(n)
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'
}

/** 75000 -> "1:15", 3723000 -> "1:02:03". */
export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "3m ago" style, coarse. */
export function fmtAgo(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

/** Time left until a reset, coarse: "3d 4h", "2h 15m", "15m". */
export function fmtUntil(ms) {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return d + 'd ' + h + 'h'
  if (h > 0) return h + 'h ' + (m % 60) + 'm'
  return (m % 60) + 'm'
}

export function firstLine(text, max = 120) {
  const line = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.trim().slice(0, max)
}

/** Pads or cuts a string to exactly `n` columns. */
export function fit(text, n) {
  text = String(text)
  if (n <= 0) return ''
  if (text.length > n) return n > 1 ? text.slice(0, n - 1) + '…' : text.slice(0, n)
  return text.padEnd(n)
}

// ---------------------------------------------------------------------------
// Errors

// Output patterns that mean something failed even when the tool reported success
const ERROR_PATTERNS = [
  [/\bHTTP\/\d(?:\.\d)?\s+([45]\d\d)\b/, (m) => 'HTTP ' + m[1]],
  [/\bstatus(?:\s*code)?\s*[:=]?\s*([45]\d\d)\b/i, (m) => 'HTTP ' + m[1]],
  [/\b([45]\d\d)\s+(?:Not Found|Internal Server Error|Bad Request|Unauthorized|Forbidden|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i, (m) => 'HTTP ' + m[1]],
  [/command not found|is not recognized as (?:an internal or external command|the name of a cmdlet)/i, () => 'command not found'],
  [/Traceback \(most recent call last\)/, () => 'Python traceback'],
  [/Unhandled exception|UnhandledPromiseRejection|Uncaught \w*Error/i, () => 'unhandled exception'],
  [/npm ERR!|error TS\d+|error CS\d+|BUILD FAILED|Build FAILED/, (m) => m[0].replace(/\s+$/, '')],
  [/\bsegmentation fault\b|\bcore dumped\b|\bpanicked at\b/i, () => 'crash'],
]

/**
 * Looks at a finished tool call and says whether it was an error.
 * @returns `{ kind, message }` or null
 */
export function classifyToolResult(tool, result) {
  if (!result) return null
  if (typeof result.deny === 'string') return { kind: 'denied', message: firstLine(result.deny) }
  const text = typeof result.text === 'string' ? result.text : ''
  if (result.isError) return { kind: 'tool error', message: firstLine(text) || tool + ' failed' }
  // Only scan output for tools that run things or fetch things
  if (!/^(Bash|PowerShell|WebFetch|Monitor)$|^mcp__/.test(tool)) return null
  const scanned = text.slice(0, 200_000)
  for (const [re, label] of ERROR_PATTERNS) {
    const m = scanned.match(re)
    if (m) return { kind: label(m), message: firstLine(scanned.slice(Math.max(0, m.index - 40)), 120) }
  }
  return null
}

export function pushError(snap, error) {
  snap.errorCount += 1
  snap.errors = [error, ...snap.errors].slice(0, MAX_ERRORS)
}

// ---------------------------------------------------------------------------
// Tasks

/** TodoWrite replaces the whole list. */
export function applyTodoWrite(snap, todos) {
  if (!Array.isArray(todos)) return
  snap.tasks = {
    source: 'todo',
    items: todos.map((t, i) => ({
      id: 'todo-' + i,
      subject: t.content,
      activeForm: t.activeForm,
      status: t.status,
    })),
  }
}

export function applyTaskCreate(snap, input, result) {
  const id = result?.task?.id ?? 'task-' + (snap.tasks.items.length + 1)
  if (snap.tasks.source !== 'task') snap.tasks = { source: 'task', items: [] }
  if (snap.tasks.items.some((t) => t.id === id)) return
  snap.tasks.items = [
    ...snap.tasks.items,
    { id, subject: input.subject, activeForm: input.activeForm, status: 'pending' },
  ]
}

export function applyTaskUpdate(snap, input) {
  if (input.status === 'deleted') {
    snap.tasks.items = snap.tasks.items.filter((t) => t.id !== input.taskId)
    return
  }
  snap.tasks.items = snap.tasks.items.map((t) =>
    t.id !== input.taskId
      ? t
      : {
          ...t,
          subject: input.subject ?? t.subject,
          activeForm: input.activeForm ?? t.activeForm,
          status: input.status ?? t.status,
        },
  )
}

/** TaskList answers with the whole list, which resyncs ours. */
export function applyTaskList(snap, result) {
  const tasks = result?.tasks
  if (!Array.isArray(tasks)) return
  const prev = new Map(snap.tasks.items.map((t) => [t.id, t]))
  snap.tasks = {
    source: 'task',
    items: tasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, activeForm: prev.get(t.id)?.activeForm })),
  }
}

// ---------------------------------------------------------------------------
// Cache

/**
 * Whether the main thread's prompt cache is still warm.
 * @returns `{ isHot, remainingMs, hitRate, lastMiss, isNew }`; `lastMiss` is `expired`, `invalidated` or null
 */
export function cacheStatus(cache, now, ttlMs) {
  if (!cache.lastAt) return { isHot: false, remainingMs: 0, hitRate: null, lastMiss: null, isNew: true }
  const remainingMs = cache.lastAt + ttlMs - now
  const prompt = cache.read + cache.write + cache.input
  const hitRate = prompt > 0 ? cache.read / prompt : null
  return { isHot: remainingMs > 0, remainingMs, hitRate, lastMiss: cache.lastMiss ?? null, isNew: false }
}

// ---------------------------------------------------------------------------
// Processes

const SHELLS = /(?:^|[\\/])(bash|sh|zsh|dash|fish|pwsh|powershell|cmd|conhost)(?:\.exe)?$/i

/** Strips quotes and escapes and collapses whitespace, so a command matches its shell's command line. */
export function normalizeCommand(text) {
  return String(text ?? '')
    .replace(/['"`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Splits `C:\a b\x.exe --flag` style command lines into the executable's base name. */
export function exeName(cmdline) {
  const s = String(cmdline ?? '').trim()
  const m = s.startsWith('"') ? s.slice(1).split('"')[0] : s.split(/\s+/)[0]
  return m.split(/[\\/]/).pop() ?? ''
}

/** Parses `pid<TAB>ppid<TAB>cmdline` lines (Windows) or `ps -o pid=,ppid=,args=` output. */
export function parseProcessList(text, isWindows) {
  const procs = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    let m
    if (isWindows) m = line.match(/^(\d+)\t(\d+)\t(.*)$/)
    else m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!m) continue
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] })
  }
  return procs
}

/** `netstat -ano` (Windows) -> Map<pid, port[]> for listening TCP sockets. */
export function parseNetstat(text) {
  const ports = new Map()
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
    if (!m) continue
    addPort(ports, Number(m[2]), Number(m[1]))
  }
  return ports
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` -> Map<pid, port[]>. */
export function parseLsof(text) {
  const ports = new Map()
  let pid = 0
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid) {
      const m = line.match(/:(\d+)$/)
      if (m) addPort(ports, pid, Number(m[1]))
    }
  }
  return ports
}

function addPort(ports, pid, port) {
  const list = ports.get(pid) ?? []
  if (!list.includes(port)) list.push(port)
  ports.set(pid, list)
}

/**
 * Finds the OS processes behind a background command: the outermost process
 * whose command line contains the command, and everything under it.
 * @returns `{ rootPid, pid, ports, pids }` or null when nothing matches
 */
export function matchProcess(command, procs, ports, excludePids = new Set()) {
  const needle = normalizeCommand(command)
  if (!needle) return null
  const tokens = needle.split(' ').filter((t) => t.length >= 3).slice(0, 6)
  const matches = (cmd) => {
    const hay = normalizeCommand(cmd)
    if (hay.includes(needle)) return true
    return tokens.length >= 2 && tokens.every((t) => hay.includes(t))
  }
  const hits = procs.filter((p) => !excludePids.has(p.pid) && !/Get-CimInstance Win32_Process|session-dashboard-scan/.test(p.cmd) && matches(p.cmd))
  if (hits.length === 0) return null
  const hitSet = new Set(hits.map((p) => p.pid))
  // The root is a hit whose parent isn't a hit
  const root = hits.find((p) => !hitSet.has(p.ppid)) ?? hits[0]
  const children = new Map()
  for (const p of procs) {
    const list = children.get(p.ppid) ?? []
    list.push(p)
    children.set(p.ppid, list)
  }
  const tree = []
  const queue = [root]
  const seen = new Set()
  while (queue.length) {
    const p = queue.shift()
    if (seen.has(p.pid)) continue
    seen.add(p.pid)
    tree.push(p)
    queue.push(...(children.get(p.pid) ?? []))
  }
  const allPorts = []
  let portOwner = null
  for (const p of tree) {
    for (const port of ports.get(p.pid) ?? []) {
      if (!allPorts.includes(port)) allPorts.push(port)
      portOwner ??= p
    }
  }
  // Show the process doing the work: the port owner, else the deepest non-shell process
  const worker = portOwner ?? [...tree].reverse().find((p) => !SHELLS.test(exeName(p.cmd))) ?? root
  return { rootPid: root.pid, pid: worker.pid, ports: allPorts.sort((a, b) => a - b), pids: tree.map((p) => p.pid) }
}

/** Reads `<task-id>` and `<status>` from a background task notification. */
export function parseTaskNotification(text) {
  const id = String(text).match(/<task[-_]id>\s*([^<\s]+)\s*<\/task[-_]id>/i)?.[1]
  const status = String(text).match(/<status>\s*([^<\s]+)\s*<\/status>/i)?.[1]
  const exit = String(text).match(/exit(?:ed with)?\s*code\s*[:=]?\s*(-?\d+)/i)?.[1]
  return id ? { id, status: status?.toLowerCase(), exitCode: exit === undefined ? undefined : Number(exit) } : null
}

/** The background task id a Bash/PowerShell/Monitor result carries. */
export function backgroundIdOf(result) {
  const r = result?.result
  if (!r || typeof r !== 'object') return undefined
  return r.backgroundTaskId ?? r.taskId ?? r.task_id ?? undefined
}
