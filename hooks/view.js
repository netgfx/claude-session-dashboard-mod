// Builds the pane's element tree from plain data. No mods API calls here:
// register.js passes in the element table and the callbacks.

import { fit, fitStart, fmtAgo, fmtDuration, fmtNum, fmtPct, fmtUntil, labelSpot, pieGrid } from './lib.js'

export const COLORS = {
  hot: '#F2862E',
  cold: '#3B8EEA',
  ok: '#3FB950',
  bad: '#F85149',
  warn: '#D29922',
  accent: '#A371F7',
  hourly: '#E3C341',
  agent: '#39C5CF',
  swarm: '#DB61A2',
}

/**
 * @param E the element table from `$.ui.resolve(e)`
 * @param v `{ width, now, snap, cache, ttlMs, usage, errorsOpen, links, linkUi, distUi, swarm }`
 * @param act `{ refresh(proc), close(proc), toggleErrors(), rescan(), clearExited(), closePane(),
 *   addLink(), addLinkPath(path), editLink(link), renameLink(link, name), unlink(link),
 *   toggleSmallPct(), togglePct(kind) }`
 */
export function renderDashboard(E, v, act) {
  const { Box, Text } = E
  const W = Math.max(28, v.width)
  const rule = () => Text({ dimColor: true, wrap: 'truncate-end', children: ['─'.repeat(W)] })

  return Box({
    flexDirection: 'column',
    width: W,
    children: [
      header(E, v, act, W),
      cacheSection(E, v, W),
      rule(),
      activitySection(E, v, act, W),
      rule(),
      processSection(E, v, act, W),
      rule(),
      linkSection(E, v, act, W),
      rule(),
      taskSection(E, v, W, act),
      rule(),
      tokenSection(E, v, W),
      rule(),
      limitSection(E, v, W),
      // Once a turn has ended
      ...(v.snap.dist ? [rule(), distSection(E, v, act, W)] : []),
    ],
  })
}

function header(E, v, act, W) {
  const { Box, Text, Button } = E
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: W,
    marginBottom: 1,
    children: [
      Text({ bold: true, children: ['SESSION DASHBOARD'] }),
      // One cell (~8px) in from the right edge, clear of the pane's own close X
      Box({
        marginRight: 1,
        children: [Button({ key: 'pane-close', label: 'hide', hotkey: 'q', plain: true, dimColor: true, onPress: act.closePane })],
      }),
    ],
  })
}

function sectionTitle(E, title, extra) {
  const { Box, Text } = E
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [Text({ bold: true, dimColor: true, children: [title] }), ...(extra ? [extra] : [])],
  })
}

// ---------------------------------------------------------------------------

function cacheSection(E, v, W) {
  const { Box, Text } = E
  const c = v.cache
  const color = c.isHot ? COLORS.hot : COLORS.cold
  const word = c.isHot ? 'Hot' : 'Cold'

  let detail
  if (c.isNew) detail = 'no request yet'
  else if (c.isHot) detail = 'expires in ' + fmtDuration(c.remainingMs)
  else detail = 'expired ' + fmtAgo(-c.remainingMs)

  const lines = []
  if (!c.isNew) {
    const hit = c.hitRate === null ? '—' : Math.round(c.hitRate * 100) + '%'
    lines.push(
      Text({
        dimColor: true,
        wrap: 'truncate-end',
        children: ['last request ' + hit + ' cached · TTL ' + Math.round(v.ttlMs / 60000) + 'm' + (v.ttlSource === 'auto' ? ' (auto)' : '')],
      }),
    )
    if (c.lastMiss === 'invalidated') {
      lines.push(Text({ color: COLORS.cold, wrap: 'truncate-end', children: ['↯ last request missed the cache (invalidated)'] }))
    } else if (c.lastMiss === 'expired') {
      lines.push(Text({ color: COLORS.cold, wrap: 'truncate-end', children: ['last request rebuilt an expired cache'] }))
    } else if (v.snap.cache.misses > 0) {
      lines.push(Text({ dimColor: true, wrap: 'truncate-end', children: [v.snap.cache.misses + ' cache miss' + (v.snap.cache.misses === 1 ? '' : 'es') + ' this session'] }))
    }
  }

  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 1,
        width: W,
        children: [
          // The colored block: three cells of background color
          Text({ backgroundColor: color, children: ['   '] }),
          Text({ bold: true, children: ['Cache (', Text({ bold: true, color, children: [word] }), ')'] }),
          Box({ flexGrow: 1, justifyContent: 'flex-end', children: [Text({ dimColor: true, wrap: 'truncate-start', children: [detail] })] }),
        ],
      }),
      ...lines,
    ],
  })
}

// ---------------------------------------------------------------------------

function activitySection(E, v, act, W) {
  const { Box, Text, Button } = E
  const s = v.snap
  const half = Math.floor(W / 2)
  const errColor = s.errorCount > 0 ? COLORS.bad : COLORS.ok

  const stat = (label, value, color, sub) =>
    Box({
      flexDirection: 'column',
      width: half,
      children: [
        Text({ dimColor: true, bold: true, children: [label] }),
        Text({ bold: true, color, children: [String(value)] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [sub] }),
      ],
    })

  const lastErr = s.errors[0]
  const errorRows = v.errorsOpen
    ? s.errors.slice(0, 6).map((err, i) =>
        Box({
          key: 'err-' + i,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ color: COLORS.bad, children: ['✕'] }),
            Text({
              wrap: 'truncate-end',
              children: [fit(err.kind, 14).trimEnd() + ' · ' + (err.tool ?? '') + (err.message ? ': ' + err.message : '')],
            }),
          ],
        }),
      )
    : []

  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        width: W,
        children: [
          stat('TOOL CALLS', s.toolCalls.total, COLORS.accent, 'main ' + s.toolCalls.main + ' · sub ' + s.toolCalls.sub),
          stat('ERRORS', s.errorCount, errColor, lastErr ? lastErr.kind + ' ' + fmtAgo(v.now - lastErr.at) : 'none so far'),
        ],
      }),
      ...(s.errorCount > 0
        ? [
            Button({
              key: 'errors-toggle',
              label: v.errorsOpen ? '▾ hide errors' : '▸ show errors',
              hotkey: 'e',
              plain: true,
              dimColor: true,
              onPress: act.toggleErrors,
            }),
          ]
        : []),
      ...errorRows,
    ],
  })
}

// ---------------------------------------------------------------------------

function processSection(E, v, act, W) {
  const { Box, Text, Button } = E
  const procs = v.snap.procs
  const running = procs.filter((p) => p.status === 'running').length
  const PID = 7
  const PORT = 7
  const ACTIONS = 12
  const CMD = Math.max(8, W - PID - PORT - ACTIONS - 1)

  const title = sectionTitle(
    E,
    'BACKGROUND',
    Text({ dimColor: true, children: [running + ' running' + (procs.length > running ? ' · ' + (procs.length - running) + ' ended' : '')] }),
  )

  if (procs.length === 0) {
    return Box({
      flexDirection: 'column',
      children: [title, Text({ dimColor: true, children: ['No background commands in this session.'] })],
    })
  }

  const headerRow = Box({
    flexDirection: 'row',
    children: [
      Text({ dimColor: true, children: [fit('PID', PID)] }),
      Text({ dimColor: true, children: [fit('PORT', PORT)] }),
      Text({ dimColor: true, children: [fit('COMMAND', CMD)] }),
    ],
  })

  const rows = procs.map((p) => {
    const alive = p.status === 'running'
    const statusColor = alive ? COLORS.ok : p.status === 'failed' ? COLORS.bad : undefined
    const port = p.ports?.length ? p.ports.join(',') : '—'
    return Box({
      key: 'proc-' + p.id,
      flexDirection: 'row',
      width: W,
      children: [
        Text({ color: statusColor, dimColor: !alive, children: [fit(p.pid ? String(p.pid) : alive ? '…' : '—', PID)] }),
        Text({ color: p.ports?.length ? COLORS.cold : undefined, dimColor: !p.ports?.length, children: [fit(port, PORT)] }),
        Box({
          width: CMD,
          flexShrink: 1,
          children: [Text({ dimColor: !alive, wrap: 'truncate-end', children: [p.command + (alive ? '' : ' (' + p.status + ')')] })],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          marginLeft: 1,
          children: [
            Button({ key: 'refresh-' + p.id, label: '↻', onPress: () => act.refresh(p) }),
            Button({ key: 'close-' + p.id, label: alive ? '✕' : '–', onPress: () => act.close(p) }),
          ],
        }),
      ],
    })
  })

  const footer = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Button({ key: 'rescan', label: 'rescan', hotkey: 's', plain: true, dimColor: true, onPress: act.rescan }),
      ...(procs.length > running
        ? [Button({ key: 'clear-ended', label: 'clear ended', hotkey: 'x', plain: true, dimColor: true, onPress: act.clearExited })]
        : []),
    ],
  })

  return Box({ flexDirection: 'column', children: [title, headerRow, ...rows, footer] })
}

// ---------------------------------------------------------------------------

function linkSection(E, v, act, W) {
  const { Box, Text, Button, Input } = E
  const links = v.links
  const ui = v.linkUi

  const title = Box({
    flexDirection: 'row',
    width: W,
    children: [
      Box({
        flexGrow: 1,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ bold: true, dimColor: true, children: ['LINKED FOLDERS'] }),
          ...(links.length ? [Text({ dimColor: true, children: [String(links.length)] })] : []),
          ...(ui.busy ? [Text({ color: COLORS.warn, children: [ui.busy] })] : []),
        ],
      }),
      Box({
        marginRight: 1,
        children: [Button({ key: 'link-add', label: '+', hotkey: 'l', onPress: act.addLink })],
      }),
    ],
  })

  const rows = links.map((l) => {
    if (ui.editing === l.name) {
      return Input({
        key: 'link-name-' + l.name,
        label: 'rename',
        value: l.name,
        submitLabel: 'rename',
        autoFocus: true,
        onSubmit: (name) => act.renameLink(l, name),
      })
    }
    // Fixed widths, as in the background rows, so a long path never pushes ✎ / ✕ off the edge
    const NAME = Math.min(18, Math.max(6, Math.floor(W / 3)))
    const ACTIONS = 12
    const PATH = Math.max(4, W - NAME - ACTIONS - 1)
    return Box({
      key: 'link-' + l.name,
      flexDirection: 'row',
      width: W,
      children: [
        Text({ bold: true, color: COLORS.accent, wrap: 'truncate-end', children: [fit(l.name, NAME)] }),
        Box({
          width: PATH,
          flexShrink: 1,
          children: [Text({ dimColor: true, wrap: 'truncate-start', children: ['→ ' + fitStart(l.target, PATH - 2)] })],
        }),
        Box({
          flexDirection: 'row',
          flexShrink: 0,
          columnGap: 1,
          marginLeft: 1,
          children: [
            Button({ key: 'link-edit-' + l.name, label: '✎', onPress: () => act.editLink(l) }),
            Button({ key: 'link-remove-' + l.name, label: '✕', onPress: () => act.unlink(l) }),
          ],
        }),
      ],
    })
  })

  const pathInput = ui.adding
    ? [
        Input({
          key: 'link-path',
          label: 'folder',
          placeholder: 'path to a folder on this machine',
          submitLabel: 'link',
          autoFocus: true,
          onSubmit: act.addLinkPath,
        }),
      ]
    : []

  const empty = links.length === 0 && !ui.adding ? [Text({ dimColor: true, wrap: 'truncate-end', children: ['None. Press + to link a folder into the workspace.'] })] : []

  return Box({ flexDirection: 'column', children: [title, ...rows, ...pathInput, ...empty] })
}

// ---------------------------------------------------------------------------

// What the main agent is doing now, then the plan from plan mode, the task
// tools' list, subagents and swarm-mod's agents, each group in its own color
function taskSection(E, v, W, act) {
  const { Box, Text } = E
  const groups = [nowGroup(E, v, W, act),planGroup(E, v, W), taskGroup(E, v, W), agentGroup(E, v, W), swarmGroup(E, v, W)].filter(Boolean)
  const title = sectionTitle(E, 'TASKS')
  if (groups.length === 0) {
    return Box({ flexDirection: 'column', children: [title, Text({ dimColor: true, children: ['No plan, tasks or agents yet.'] })] })
  }
  return Box({ flexDirection: 'column', rowGap: 1, children: [title, ...groups] })
}

/** A group's first line: its name in its color, then dim details. */
function groupTitle(E, name, color, detail) {
  const { Box, Text } = E
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [Text({ color, bold: true, children: ['● ' + name] }), ...(detail ? [Text({ dimColor: true, wrap: 'truncate-end', children: [detail] })] : [])],
  })
}

/** One row: a status mark, the label, and dim text on the right. */
function itemRow(E, key, mark, label, opts = {}) {
  const { Box, Text } = E
  return Box({
    key,
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ color: mark.color, children: [mark.ch] }),
      Box({
        flexGrow: 1,
        flexShrink: 1,
        children: [
          Text({ color: opts.color, bold: opts.bold, dimColor: opts.dim, strikethrough: opts.strike, wrap: 'truncate-end', children: [label ?? ''] }),
        ],
      }),
      ...(opts.right ? [Box({ flexShrink: 0, children: [opts.right] })] : []),
    ],
  })
}

function progressBar(E, done, total, W, color) {
  const { Box, Text } = E
  const barWidth = Math.min(12, Math.max(4, W - 30))
  const filled = total ? Math.round((done / total) * barWidth) : 0
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ dimColor: true, children: [done + '/' + total] }),
      Box({ flexDirection: 'row', children: [Text({ color, children: ['▰'.repeat(filled)] }), Text({ dimColor: true, children: ['▱'.repeat(barWidth - filled)] })] }),
    ],
  })
}

const NOW_COLORS = { working: COLORS.ok, waiting: COLORS.warn, done: '#8B949E' }

// The status as a filled label, the request (or the task in progress), and its current step
function nowGroup(E, v, W, act) {
  const { Box, Text, Button } = E
  const n = v.snap.now
  if (!n) return null
  const color = NOW_COLORS[n.status] ?? NOW_COLORS.done
  const isDone = n.status === 'done'
  const active = v.snap.tasks.items.find((t) => t.status === 'in_progress')
  const headline = (!isDone && active ? active.activeForm || active.subject : n.headline) || 'continuing'
  // Counts up while working or waiting; on done it stops at the total the request took
  const when = isDone ? 'took ' + fmtDuration(n.at - n.since) : fmtDuration(v.now - n.since)
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color, bold: true, children: ['● now'] }),
          Text({ backgroundColor: color, color: inkOn(color), bold: true, children: [' ' + n.status + ' '] }),
          Text({ dimColor: true, children: [when] }),
        ],
      }),
      ...promptRows(E, v, W, act, { color, isDone, headline, showsPrompt: isDone || !active }),
      ...(n.step ? [itemRow(E, 'now-step', { ch: '↳', color }, n.step, { color: isDone ? undefined : color, dim: isDone })] : []),
    ],
  })
}

// The request under "now": one line, with a pressable … when there's more of it;
// pressed, the whole prompt wraps below, with ▴ less to fold it again
function promptRows(E, v, W, act, { color, isDone, headline, showsPrompt }) {
  const { Box, Text, Button } = E
  const full = showsPrompt ? String(v.snap.now.prompt || v.snap.now.headline || '').trim() : ''
  const room = W - 2 // the mark column and its gap
  const canExpand = Boolean(full) && Boolean(act?.togglePrompt) && (full !== headline || headline.length > room)
  if (!canExpand) return [itemRow(E, 'now-headline', { ch: ' ', color }, headline, { bold: !isDone, dim: isDone })]

  const toggle = (label) =>
    Button({ key: 'prompt-toggle', label, plain: true, dimColor: label !== '…', onPress: act.togglePrompt })
  if (v.promptOpen) {
    return [
      Box({
        key: 'now-prompt',
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color, children: [' '] }),
          Box({ flexGrow: 1, flexShrink: 1, children: [Text({ bold: !isDone, dimColor: isDone, wrap: 'wrap', children: [full] })] }),
        ],
      }),
      Box({ key: 'now-prompt-less', flexDirection: 'row', columnGap: 1, children: [Text({ children: [' '] }), toggle('▴ less')] }),
    ]
  }
  // Cut it ourselves, leaving one column for the … button
  const cut = headline.slice(0, Math.max(1, room - 1)).trimEnd()
  return [
    Box({
      key: 'now-headline',
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color, children: [' '] }),
        Box({
          flexDirection: 'row',
          flexShrink: 1,
          children: [Text({ bold: !isDone, dimColor: isDone, wrap: 'truncate-end', children: [cut] }), toggle('…')],
        }),
      ],
    }),
  ]
}

function planGroup(E, v, W) {
  const { Box } = E
  const p = v.snap.plan
  if (!p?.steps?.length) return null
  const isDone = p.status === 'done'
  const detail = (p.title ? p.title + ' · ' : '') + (isDone ? 'done ' + fmtAgo(v.now - (p.doneAt ?? p.at)) : 'approved ' + fmtAgo(v.now - p.at))
  return Box({
    flexDirection: 'column',
    children: [
      groupTitle(E, 'plan', COLORS.accent, detail),
      ...p.steps.map((s, i) =>
        itemRow(E, 'plan-' + i, isDone ? { ch: '☑', color: COLORS.ok } : { ch: String(i + 1).padStart(2), color: COLORS.accent }, s, { dim: isDone }),
      ),
    ],
  })
}

function taskGroup(E, v, W) {
  const { Box, Text } = E
  const items = v.snap.tasks.items
  if (items.length === 0) return null
  const done = items.filter((t) => t.status === 'completed').length

  // In progress first, then pending, then completed, keeping order within each
  const rank = { in_progress: 0, pending: 1, completed: 2 }
  const sorted = items.map((t, i) => [t, i]).sort((a, b) => (rank[a[0].status] ?? 1) - (rank[b[0].status] ?? 1) || a[1] - b[1]).map(([t]) => t)

  return Box({
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', columnGap: 1, children: [groupTitle(E, 'task list', COLORS.cold), progressBar(E, done, items.length, W, COLORS.cold)] }),
      ...sorted.map((t) =>
        t.status === 'completed'
          ? itemRow(E, 'task-' + t.id, { ch: '☑', color: COLORS.ok }, t.subject, { dim: true, strike: true })
          : t.status === 'in_progress'
            ? itemRow(E, 'task-' + t.id, { ch: '▶', color: COLORS.cold }, t.activeForm || t.subject, { color: COLORS.cold, bold: true })
            : itemRow(E, 'task-' + t.id, { ch: '☐', color: COLORS.cold }, t.subject),
      ),
    ],
  })
}

const AGENT_MARKS = {
  pending: { ch: '◌', color: COLORS.agent },
  running: { ch: '▶', color: COLORS.agent },
  waiting: { ch: '◌', color: COLORS.warn },
  idle: { ch: '◌', color: undefined },
  completed: { ch: '☑', color: COLORS.ok },
  failed: { ch: '✗', color: COLORS.bad },
  killed: { ch: '■', color: undefined },
}

function agentGroup(E, v, W) {
  const { Box, Text } = E
  const list = Object.values(v.snap.agents ?? {})
  if (list.length === 0) return null
  const running = list.filter((a) => a.status === 'running' || a.status === 'pending').length
  const tokens = v.snap.tokens.agents ?? {}
  return Box({
    flexDirection: 'column',
    children: [
      groupTitle(E, 'subagents', COLORS.agent, running ? running + ' running' : 'all finished'),
      ...list.map((a) => {
        const t = tokens[a.id]
        const total = t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0
        const isLive = a.status === 'running' || a.status === 'pending'
        return itemRow(E, 'agent-' + a.id, AGENT_MARKS[a.status] ?? AGENT_MARKS.idle, a.type + ' · ' + (a.description || a.id.slice(0, 6)), {
          color: isLive ? COLORS.agent : undefined,
          bold: isLive,
          dim: !isLive,
          right: total ? Text({ dimColor: true, children: [fmtNum(total)] }) : undefined,
        })
      }),
    ],
  })
}

const SWARM_LIVE = ['starting', 'launching', 'pending', 'working', 'running', 'waiting']

function swarmGroup(E, v, W) {
  const { Box, Text } = E
  const rows = v.swarm ?? []
  if (rows.length === 0) return null
  const working = rows.filter((a) => SWARM_LIVE.includes(a.status)).length
  return Box({
    flexDirection: 'column',
    children: [
      groupTitle(E, 'swarm', COLORS.swarm, working + ' of ' + rows.length + ' working · /swarm'),
      ...rows.map((a, i) => {
        const isLive = SWARM_LIVE.includes(a.status)
        const mark = a.pending
          ? { ch: a.pending === 'question' ? '?' : '!', color: a.pending === 'question' ? COLORS.swarm : COLORS.bad }
          : a.status === 'failed'
            ? { ch: '✗', color: COLORS.bad }
            : a.status === 'done'
              ? { ch: '☑', color: COLORS.ok }
              : isLive
                ? { ch: '▶', color: COLORS.swarm }
                : { ch: '◌', color: undefined }
        const what = a.pending ? (a.pending === 'question' ? 'has a question' : 'needs approval') : a.activity || a.status
        return itemRow(E, 'swarm-' + i, mark, a.name + ' · ' + what, {
          color: a.pending ? mark.color : isLive ? COLORS.swarm : undefined,
          bold: isLive || !!a.pending,
          dim: !isLive && !a.pending,
          right: a.tokens ? Text({ dimColor: true, children: [fmtNum(a.tokens)] }) : undefined,
        })
      }),
    ],
  })
}

// ---------------------------------------------------------------------------

function tokenSection(E, v, W) {
  const { Box, Text } = E
  const t = v.snap.tokens
  const agents = Object.values(t.agents)
  const NUM = 7
  // The cache columns are wider so "c.read" and "c.write" don't run together
  const CACHE = 9
  const NAME = Math.max(8, W - NUM * 2 - CACHE * 2)

  const row = (key, name, r, opts = {}) =>
    Box({
      key,
      flexDirection: 'row',
      children: [
        Text({ bold: opts.bold, color: opts.color, wrap: 'truncate-end', children: [fit(name, NAME)] }),
        Text({ bold: opts.bold, children: [fmtNum(r.input).padStart(NUM)] }),
        Text({ bold: opts.bold, children: [fmtNum(r.output).padStart(NUM)] }),
        Text({ bold: opts.bold, dimColor: !opts.bold, children: [fmtNum(r.cacheRead).padStart(CACHE)] }),
        Text({ bold: opts.bold, dimColor: !opts.bold, children: [fmtNum(r.cacheWrite).padStart(CACHE)] }),
      ],
    })

  const sum = (list) =>
    list.reduce(
      (a, r) => ({
        input: a.input + r.input,
        output: a.output + r.output,
        cacheRead: a.cacheRead + r.cacheRead,
        cacheWrite: a.cacheWrite + r.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    )

  const subTotal = sum(agents)
  const total = sum([t.main, ...agents])

  const headerRow = Box({
    flexDirection: 'row',
    children: [
      Text({ dimColor: true, children: [fit('', NAME)] }),
      ...['in', 'out'].map((h) => Text({ dimColor: true, children: [h.padStart(NUM)] })),
      ...['c.read', 'c.write'].map((h) => Text({ dimColor: true, children: [h.padStart(CACHE)] })),
    ],
  })

  const agentRows = agents
    .slice(-6)
    .map((a) => row('tok-' + a.id, '  ' + a.label, a, {}))

  const usage = v.usage
  const ctx = usage?.context
  const pct = ctx?.percent
  const ctxColor = pct === undefined ? undefined : pct >= 85 ? COLORS.bad : pct >= 60 ? COLORS.warn : COLORS.ok
  const footer = Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ dimColor: true, children: ['context'] }),
      Text({ color: ctxColor, bold: true, children: [pct === undefined ? '—' : pct + '%'] }),
      Text({ dimColor: true, children: ['of ' + fmtNum(ctx?.window ?? 0)] }),
      ...(usage?.cost ? [Text({ dimColor: true, children: ['· $' + usage.cost.usd.toFixed(2)] })] : []),
    ],
  })

  return Box({
    flexDirection: 'column',
    children: [
      sectionTitle(E, 'TOKENS', Text({ dimColor: true, children: [t.main.requests + agents.reduce((n, a) => n + a.requests, 0) + ' requests'] })),
      headerRow,
      row('tok-main', 'main agent', t.main, { color: COLORS.accent }),
      ...(agents.length ? [row('tok-sub', 'subagents (' + agents.length + ')', subTotal, { color: COLORS.accent })] : []),
      ...agentRows,
      row('tok-total', 'total', total, { bold: true }),
      Text({ children: [' '] }),
      footer,
    ],
  })
}

// ---------------------------------------------------------------------------

function limitSection(E, v, W) {
  const { Box, Text } = E
  const limits = v.usage?.rateLimits ?? []
  const LABEL = 7
  const PCT = 5
  const RESET = 10
  const BAR = Math.max(4, W - LABEL - PCT - RESET - 2)

  // Only the used part is drawn: no bar means no usage
  const bar = (key, label, limit, color) => {
    const pct = limit?.percentUsed ?? 0
    const cells = pct > 0 ? Math.max(1, Math.min(BAR, Math.round((pct / 100) * BAR))) : 0
    const resetMs = limit?.resetsAt ? Date.parse(limit.resetsAt) - v.now : NaN
    return Box({
      key,
      flexDirection: 'row',
      children: [
        Text({ dimColor: true, children: [fit(label, LABEL)] }),
        Text({ color, children: [fit('█'.repeat(cells), BAR)] }),
        Text({ bold: true, color: pct > 0 ? color : undefined, dimColor: pct === 0, children: [(limit ? Math.round(pct) + '%' : '—').padStart(PCT)] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [' ' + (resetMs > 0 ? fmtUntil(resetMs) : '').padStart(RESET + 1)] }),
      ],
    })
  }

  const title = sectionTitle(E, 'USAGE LIMITS')
  if (limits.length === 0) {
    return Box({
      flexDirection: 'column',
      children: [title, Text({ dimColor: true, wrap: 'truncate-end', children: ['No rate-limit readings yet (subscription only).'] })],
    })
  }

  return Box({
    flexDirection: 'column',
    children: [
      title,
      bar('limit-5h', '5-hour', limits.find((l) => l.kind === 'five_hour'), COLORS.hourly),
      bar('limit-7d', 'weekly', limits.find((l) => l.kind === 'seven_day'), COLORS.ok),
    ],
  })
}

// ---------------------------------------------------------------------------

// Slice order around the pie, clockwise from 12 o'clock, and the ledger's
const SLICES = [
  { kind: 'input', label: 'input', color: COLORS.cold },
  { kind: 'output', label: 'output', color: COLORS.ok },
  { kind: 'tool', label: 'tool use', color: COLORS.accent },
  { kind: 'cacheRead', label: 'cache read', color: COLORS.hourly },
  { kind: 'cacheWrite', label: 'cache write', color: COLORS.hot },
  { kind: 'retry', label: 'retries', color: COLORS.bad },
]
const PIE = 16 // diameter in pixels: 16 columns by 8 rows of half blocks
const LEDGER = 26

/** Dark text on a light slice, light on a dark one. */
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 140 ? '#111111' : '#FFFFFF'
}

function distSection(E, v, act, W) {
  const { Box, Text, Button } = E
  const d = v.snap.dist
  const ui = v.distUi ?? { showSmall: false, shown: new Set() }
  const values = SLICES.map((s) => Math.max(0, d[s.kind] ?? 0))
  const total = values.reduce((a, b) => a + b, 0)
  const pcts = values.map((x) => (total > 0 ? (x / total) * 100 : 0))
  const grid = pieGrid(values, PIE)

  // Each slice wide enough for it carries its share inside; the rest are "small"
  const labels = new Map()
  const small = new Set()
  SLICES.forEach((s, i) => {
    if (!(values[i] > 0)) return
    const text = fmtPct(pcts[i])
    const spot = labelSpot(grid, values, i, text.length)
    if (spot) labels.set(spot.row * PIE + spot.col, { text, color: s.color })
    else small.add(s.kind)
  })

  // Two pixels a cell: the top one in the foreground of ▀, the bottom one behind it
  const pieRows = []
  for (let row = 0; row < PIE / 2; row++) {
    const cells = []
    for (let col = 0; col < PIE; col++) {
      const label = labels.get(row * PIE + col)
      if (label) {
        cells.push({ ch: label.text, color: inkOn(label.color), bg: label.color, bold: true })
        col += label.text.length - 1
        continue
      }
      const top = SLICES[grid[row * 2][col]]?.color
      const bottom = SLICES[grid[row * 2 + 1][col]]?.color
      if (top && bottom) cells.push({ ch: '▀', color: top, bg: top === bottom ? top : bottom })
      else if (top) cells.push({ ch: '▀', color: top })
      else if (bottom) cells.push({ ch: '▄', color: bottom })
      else cells.push({ ch: ' ' })
    }
    // Runs of one style become one Text
    const runs = []
    for (const c of cells) {
      const last = runs[runs.length - 1]
      if (last && last.color === c.color && last.bg === c.bg && last.bold === c.bold) last.ch += c.ch
      else runs.push({ ...c })
    }
    pieRows.push(
      Text({
        key: 'pie-' + row,
        children: runs.map((r) => Text({ color: r.color, backgroundColor: r.bg, bold: r.bold, children: [r.ch] })),
      }),
    )
  }

  const pie = Box({
    flexDirection: 'column',
    width: PIE,
    flexShrink: 0,
    children: [
      ...pieRows,
      ...(small.size
        ? [
            Button({
              key: 'dist-small',
              label: ui.showSmall ? 'hide small %' : 'show small %',
              hotkey: 'p',
              plain: true,
              dimColor: true,
              onPress: act.toggleSmallPct,
            }),
          ]
        : []),
    ],
  })

  const isStacked = W < PIE + 2 + LEDGER
  const LW = isStacked ? W : W - PIE - 2
  const ledger = Box({
    flexDirection: 'column',
    width: LW,
    children: SLICES.map((s, i) => {
      const showPct = ui.shown.has(s.kind) || (ui.showSmall && small.has(s.kind))
      return Box({
        key: 'dist-row-' + s.kind,
        flexDirection: 'row',
        width: LW,
        columnGap: 1,
        children: [
          Text({ color: s.color, children: ['██'] }),
          Button({ key: 'dist-' + s.kind, label: s.label, plain: true, dimColor: values[i] === 0, onPress: () => act.togglePct(s.kind) }),
          Box({
            flexGrow: 1,
            justifyContent: 'flex-end',
            columnGap: 1,
            children: [
              ...(showPct ? [Text({ bold: true, color: s.color, children: [fmtPct(pcts[i])] })] : []),
              Text({ dimColor: true, children: [fmtNum(values[i]).padStart(6)] }),
            ],
          }),
        ],
      })
    }),
  })

  const turns = d.turns ?? 1
  return Box({
    flexDirection: 'column',
    children: [
      sectionTitle(
        E,
        'TOTAL DISTRIBUTION',
        Text({ dimColor: true, wrap: 'truncate-end', children: [fmtNum(total) + ' tokens · ' + turns + ' turn' + (turns === 1 ? '' : 's')] }),
      ),
      Box({
        flexDirection: isStacked ? 'column' : 'row',
        columnGap: 2,
        rowGap: 1,
        width: W,
        children: [pie, ledger],
      }),
      Text({ dimColor: true, wrap: 'truncate-end', children: ['tool use and retries are estimated from call sizes'] }),
    ],
  })
}
