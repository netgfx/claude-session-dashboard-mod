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
    // The plan last approved in plan mode: `{ title, steps, at, status }`
    plan: null,
    // Subagents seen this session, by id: `{ id, type, description, status, at }`
    agents: {},
    // What the main agent is doing: `{ status, headline, step, since, at }`,
    // status 'working' | 'waiting' | 'done'; null before the first turn
    now: null,
    // Running token split by kind, and the copy the pane shows, taken when a turn ends
    mix: emptyMix(),
    dist: null,
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

/**
 * The whole prompt a request headline was cut from: the newest user message
 * whose first line starts the same way. For a snapshot saved before prompts
 * were kept. '' when none matches.
 */
export function promptFromMessages(messages, headline, max = 9000) {
  if (!Array.isArray(messages) || !headline) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user' || typeof m.text !== 'string') continue
    const text = m.text
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/\r\n/g, '\n')
      .trim()
    if (text && firstLine(text, 100) === headline) return text.slice(0, max)
  }
  return ''
}

/** Pads or cuts a string to exactly `n` columns. */
export function fit(text, n) {
  text = String(text)
  if (n <= 0) return ''
  if (text.length > n) return n > 1 ? text.slice(0, n - 1) + '…' : text.slice(0, n)
  return text.padEnd(n)
}

/** Like `fit`, but cuts from the start so the end of the string (a path's tail) stays. */
export function fitStart(text, n) {
  text = String(text)
  if (n <= 0) return ''
  if (text.length > n) return n > 1 ? '…' + text.slice(text.length - n + 1) : text.slice(-n)
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
// Plan and agents

const MAX_PLAN_STEPS = 12
export const MAX_AGENTS = 8

/** Markdown inline marks off: `**a**` -> "a", "[x](y)" -> "x", "`c`" -> "c". */
function plainText(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The steps of a plan approved in plan mode, from its markdown: the top-level
 * numbered items, else the `##` headings, else the top-level bullets.
 * @returns `{ title, steps: string[] }`
 */
export function parsePlan(markdown) {
  let title = ''
  const numbered = []
  const headings = []
  const bullets = []
  let isFenced = false
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) isFenced = !isFenced
    if (isFenced) continue
    let m
    if (!title && (m = line.match(/^#\s+(.+)/))) title = plainText(m[1])
    else if ((m = line.match(/^#{2,3}\s+(.+)/))) headings.push(plainText(m[1]))
    else if ((m = line.match(/^ ?\d+[.)]\s+(?:\[[ xX]\]\s+)?(.+)/))) numbered.push(plainText(m[1]))
    else if ((m = line.match(/^[-*+]\s+(?:\[[ xX]\]\s+)?(.+)/))) bullets.push(plainText(m[1]))
  }
  const steps = numbered.length >= 2 ? numbered : headings.length >= 2 ? headings : bullets.length ? bullets : [...numbered, ...headings]
  return { title: title.replace(/^plan:\s*/i, ''), steps: steps.filter(Boolean).slice(0, MAX_PLAN_STEPS) }
}

/**
 * Merges `$.agent.list()` into the subagents seen so far. Ones started by
 * `skipPlugin` (swarm-mod, which lists its own) are left out; ones the list
 * no longer has finished.
 */
export function mergeAgents(known, listed, now, skipPlugin) {
  const out = { ...known }
  const live = new Set()
  for (const a of listed ?? []) {
    if (!a?.id || (skipPlugin && a.spawnedBy === skipPlugin)) continue
    live.add(a.id)
    const prev = out[a.id]
    out[a.id] = { id: a.id, type: a.type, description: a.description || a.name || '', status: a.status, at: prev?.at ?? now }
  }
  for (const id of Object.keys(out)) {
    if (!live.has(id) && ['pending', 'running', 'waiting', 'idle'].includes(out[id].status)) out[id] = { ...out[id], status: 'completed' }
  }
  // The running ones, then the latest finished, up to MAX_AGENTS
  const isLive = (a) => ['pending', 'running', 'waiting'].includes(a.status)
  const kept = Object.values(out)
    .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.at - a.at)
    .slice(0, MAX_AGENTS)
  return Object.fromEntries(kept.map((a) => [a.id, a]))
}

// Tools that block on the user until they answer
export const WAIT_TOOLS = ['AskUserQuestion', 'ExitPlanMode']

/** A tool call as a short line for the pane: "Bash · Run the tests", "Read · view.js". */
export function describeToolCall(e) {
  const tool = String(e?.tool ?? '?')
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return mcp[1] + ' · ' + mcp[2]
  const detail = (() => {
    switch (tool) {
      case 'Bash':
      case 'PowerShell':
      case 'Monitor':
        return e.description || e.command
      case 'Read':
      case 'Edit':
      case 'Write':
      case 'NotebookEdit':
        return baseName(e.file_path ?? e.notebook_path ?? '')
      case 'Grep':
      case 'Glob':
        return e.pattern
      case 'WebFetch':
        return String(e.url ?? '').replace(/^https?:\/\//, '').split('/')[0]
      case 'WebSearch':
        return e.query
      case 'Agent':
      case 'Task':
        return [e.subagent_type, e.description].filter(Boolean).join(' · ')
      case 'Skill':
        return e.skill
      case 'AskUserQuestion':
        return 'asking you a question'
      case 'ExitPlanMode':
        return 'plan ready for approval'
      default:
        return e.description
    }
  })()
  const text = firstLine(detail ?? '', 80)
  return text ? tool + ' · ' + text : tool
}

/** swarm-mod's snapshot as rows: `{ name, status, activity, tokens, pending }`. */
export function swarmRows(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.order) || !snapshot.agents) return []
  return snapshot.order
    .map((k) => snapshot.agents[k])
    .filter(Boolean)
    .map((a) => {
      const t = a.tokens ?? {}
      return {
        name: String(a.name ?? '?'),
        status: String(a.status ?? ''),
        activity: firstLine(a.activity || a.task || '', 80),
        tokens: (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
        pending: a.pending ? (a.pending.kind === 'question' ? 'question' : 'approval') : null,
      }
    })
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

// ---------------------------------------------------------------------------
// Linked folders

export const GITIGNORE_HEADER = '# Linked folders (session-dashboard)'

/** The last segment of a path: `C:\work\notes\` -> "notes". */
export function baseName(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** Trims what a picker or a pasted path carries: whitespace, quotes, a trailing separator. */
export function cleanPath(path) {
  let p = String(path ?? '').trim()
  if (/^(["']).*\1$/.test(p)) p = p.slice(1, -1).trim()
  // Keep a drive or filesystem root's own separator
  if (p.length > 1 && !/^[A-Za-z]:[\\/]$/.test(p)) p = p.replace(/[\\/]+$/, '')
  return p
}

/** A link's name: one path segment the file system and git both take. */
export function isValidLinkName(name) {
  if (!name || name === '.' || name === '..' || name.length > 255) return false
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return false
  // Windows drops a trailing dot or space; git would then ignore the wrong name
  return !/[. ]$/.test(name) && name.trim() === name
}

/**
 * `base`, or `base-2`, `base-3`, … if a sibling already holds the name, ignoring
 * case: Windows and macOS disks do.
 */
export function uniqueName(base, taken) {
  const used = new Set([...taken].map((s) => s.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!used.has((base + '-' + i).toLowerCase())) return base + '-' + i
}

/** Joins a folder and one name with the platform's separator. */
export function joinPath(root, name, isWindows) {
  return String(root).replace(/[\\/]+$/, '') + (isWindows ? '\\' : '/') + name
}

/** Whether `inner` is `outer` or lies beneath it, ignoring case as Windows and macOS disks do. */
export function isWithin(inner, outer) {
  const norm = (p) => cleanPath(p).replace(/[\\/]+/g, '/').toLowerCase()
  const a = norm(inner)
  const b = norm(outer)
  return a === b || a.startsWith(b.endsWith('/') ? b : b + '/')
}

/** The .gitignore line for a link at the workspace root, glob characters escaped. */
export function gitignoreEntry(name) {
  // No trailing slash: git sees a symlink as a file, and "name/" matches folders only
  return '/' + name.replace(/[\\*?[\]!#]/g, '\\$&')
}

function splitLines(text) {
  return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
}

/** .gitignore text with the link's entry added under the mod's header. Unchanged if present. */
export function gitignoreAdd(text, name) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n'
  const lines = splitLines(text)
  const entry = gitignoreEntry(name)
  if (lines.includes(entry)) return text
  let at = lines.indexOf(GITIGNORE_HEADER)
  if (at < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push(GITIGNORE_HEADER)
    at = lines.length - 1
  }
  let end = at + 1
  while (end < lines.length && lines[end].startsWith('/')) end++
  lines.splice(end, 0, entry)
  return lines.join(eol) + eol
}

/** .gitignore text without the link's entry; drops the header once nothing is under it. */
export function gitignoreRemove(text, name) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n'
  const entry = gitignoreEntry(name)
  let lines = splitLines(text)
  if (!lines.includes(entry)) return text
  lines = lines.filter((l) => l !== entry)
  const at = lines.indexOf(GITIGNORE_HEADER)
  if (at >= 0 && !(lines[at + 1] ?? '').startsWith('/')) {
    lines.splice(at, 1)
    if (at > 0 && lines[at - 1] === '' && (at === lines.length || lines[at] === '')) lines.splice(at - 1, 1)
  }
  return lines.length ? lines.join(eol) + eol : ''
}

// ---------------------------------------------------------------------------
// Token distribution

export const MIX_KINDS = ['input', 'output', 'tool', 'cacheRead', 'cacheWrite', 'retry']

export function emptyMix() {
  return { input: 0, output: 0, tool: 0, cacheRead: 0, cacheWrite: 0, retry: 0 }
}

/** Rough token count of a piece of text or a value's JSON: ~4 characters a token. */
export function estimateTokens(value) {
  if (value === undefined || value === null) return 0
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return Math.ceil(text.length / 4)
}

/**
 * Splits one model request's usage into the distribution's kinds; the parts add up
 * to the request's total. Tool use is the output spent writing tool calls plus the
 * tool results the request sends; retries are a request resent after a failed one,
 * and the calls that redo a tool that just failed.
 * @param u the API usage
 * @param o `{ toolUses, pendingToolTokens, failedTools: Set<name>, isRetry }`
 * @returns `{ mix, pendingLeft }`: the parts, and the tool-result tokens not yet sent
 */
export function splitUsage(u, o = {}) {
  const input = u.input_tokens ?? 0
  const output = u.output_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  const mix = emptyMix()
  const pending = Math.max(0, o.pendingToolTokens ?? 0)
  if (o.isRetry) {
    mix.retry = input + output + cacheRead + cacheWrite
    return { mix, pendingLeft: pending }
  }
  // Tool results are new content: written to the cache, or sent uncached
  const fromWrite = Math.min(pending, cacheWrite)
  const fromInput = Math.min(pending - fromWrite, input)
  let toolOut = 0
  let retryOut = 0
  for (const use of o.toolUses ?? []) {
    const n = estimateTokens(use?.input) + 10
    if (o.failedTools?.has(use?.name)) retryOut += n
    else toolOut += n
  }
  // Never more than the output the request reported
  const over = toolOut + retryOut - output
  if (over > 0) {
    const cut = Math.min(over, toolOut)
    toolOut -= cut
    retryOut -= over - cut
  }
  mix.input = input - fromInput
  mix.cacheRead = cacheRead
  mix.cacheWrite = cacheWrite - fromWrite
  mix.output = output - toolOut - retryOut
  mix.tool = toolOut + fromWrite + fromInput
  mix.retry = retryOut
  return { mix, pendingLeft: pending - fromWrite - fromInput }
}

export function addMix(a, b) {
  const out = emptyMix()
  for (const k of MIX_KINDS) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0)
  return out
}

/** 0.4 -> "0.4%", 42.3 -> "42%"; a share under 0.1 is "<0.1%". */
export function fmtPct(pct) {
  if (!(pct > 0)) return '0%'
  if (pct < 0.1) return '<0.1%'
  if (pct < 10) return pct.toFixed(1).replace(/\.0$/, '') + '%'
  return Math.round(pct) + '%'
}

/**
 * Which slice each pixel of a pie lies in, clockwise from 12 o'clock.
 * @param values the slices' sizes
 * @param size the pie's diameter in pixels
 * @returns rows of slice indexes, -1 outside the pie
 */
export function pieGrid(values, size) {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  const ends = []
  let acc = 0
  for (const v of values) {
    acc += Math.max(0, v)
    ends.push(total > 0 ? acc / total : 0)
  }
  const c = size / 2
  const r = c - 0.2
  const grid = []
  for (let y = 0; y < size; y++) {
    const row = []
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      if (total <= 0 || dx * dx + dy * dy > r * r) {
        row.push(-1)
        continue
      }
      let f = Math.atan2(dx, -dy) / (2 * Math.PI)
      if (f < 0) f += 1
      let i = ends.findIndex((end, k) => f < end && values[k] > 0)
      // Rounding at the very end of the circle: the last slice with a size
      if (i < 0) i = values.reduce((last, v, k) => (v > 0 ? k : last), -1)
      row.push(i)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Where a slice's label fits inside the pie: a run of `length` cells, each with both
 * of its half-block pixels in the slice, near the middle of the slice's arc.
 * @param grid from `pieGrid`; a cell is two pixel rows
 * @returns `{ row, col }` in cells, or null when the slice is too narrow for it
 */
export function labelSpot(grid, values, index, length) {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (!(values[index] > 0) || total <= 0) return null
  const before = values.slice(0, index).reduce((a, b) => a + Math.max(0, b), 0)
  const angle = ((before + values[index] / 2) / total) * 2 * Math.PI
  const size = grid.length
  const c = size / 2
  const fits = (row, col) => {
    for (let x = col; x < col + length; x++) {
      if (grid[row * 2]?.[x] !== index || grid[row * 2 + 1]?.[x] !== index) return false
    }
    return true
  }
  // A slice holding nearly the whole pie can take its label at the center
  for (const k of values[index] / total > 0.75 ? [0, 0.3, 0.55] : [0.55, 0.4, 0.7]) {
    const px = c + Math.sin(angle) * k * c
    const py = c - Math.cos(angle) * k * c
    const row = Math.min(Math.floor(size / 2) - 1, Math.max(0, Math.floor(py / 2)))
    const mid = Math.round(px - length / 2)
    for (const col of [mid, mid - 1, mid + 1]) if (col >= 0 && col + length <= size && fits(row, col)) return { row, col }
  }
  return null
}
