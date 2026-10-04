// Builds the pane's element tree from plain data. No mods API calls here:
// register.js passes in the element table and the callbacks.

import { fit, fitStart, fmtAgo, fmtDuration, fmtNum, fmtUntil } from './lib.js'

export const COLORS = {
  hot: '#F2862E',
  cold: '#3B8EEA',
  ok: '#3FB950',
  bad: '#F85149',
  warn: '#D29922',
  accent: '#A371F7',
  hourly: '#E3C341',
}

/**
 * @param E the element table from `$.ui.resolve(e)`
 * @param v `{ width, now, snap, cache, ttlMs, usage, errorsOpen, links, linkUi }`
 * @param act `{ refresh(proc), close(proc), toggleErrors(), rescan(), clearExited(), closePane(),
 *   addLink(), addLinkPath(path), editLink(link), renameLink(link, name), unlink(link) }`
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
      taskSection(E, v, W),
      rule(),
      tokenSection(E, v, W),
      rule(),
      limitSection(E, v, W),
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

function taskSection(E, v, W) {
  const { Box, Text } = E
  const items = v.snap.tasks.items
  const done = items.filter((t) => t.status === 'completed').length

  const barWidth = Math.min(12, Math.max(4, W - 24))
  const filled = items.length ? Math.round((done / items.length) * barWidth) : 0
  const bar = Box({
    flexDirection: 'row',
    children: [
      Text({ color: COLORS.ok, children: ['▰'.repeat(filled)] }),
      Text({ dimColor: true, children: ['▱'.repeat(barWidth - filled)] }),
    ],
  })

  const title = sectionTitle(E, 'TASKS', items.length ? Box({ flexDirection: 'row', columnGap: 1, children: [Text({ dimColor: true, children: [done + '/' + items.length] }), bar] }) : undefined)

  if (items.length === 0) {
    return Box({
      flexDirection: 'column',
      children: [title, Text({ dimColor: true, children: ['No task list yet.'] })],
    })
  }

  // In progress first, then pending, then completed, keeping order within each
  const rank = { in_progress: 0, pending: 1, completed: 2 }
  const sorted = items.map((t, i) => [t, i]).sort((a, b) => (rank[a[0].status] ?? 1) - (rank[b[0].status] ?? 1) || a[1] - b[1]).map(([t]) => t)

  const rows = sorted.map((t) => {
    const [box, color, dim, label] =
      t.status === 'completed'
        ? ['☑', COLORS.ok, true, t.subject]
        : t.status === 'in_progress'
          ? ['▶', COLORS.hot, false, t.activeForm || t.subject]
          : ['☐', undefined, false, t.subject]
    return Box({
      key: 'task-' + t.id,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color, children: [box] }),
        Text({
          color: t.status === 'in_progress' ? COLORS.hot : undefined,
          bold: t.status === 'in_progress',
          dimColor: dim,
          strikethrough: t.status === 'completed',
          wrap: 'truncate-end',
          children: [label ?? ''],
        }),
      ],
    })
  })

  const current = items.find((t) => t.status === 'in_progress')
  const next = items.find((t) => t.status === 'pending')
  const summary = [
    current ? Text({ wrap: 'truncate-end', children: [Text({ dimColor: true, children: ['now  '] }), Text({ color: COLORS.hot, children: [current.activeForm || current.subject] })] }) : null,
    next ? Text({ wrap: 'truncate-end', children: [Text({ dimColor: true, children: ['next '] }), Text({ children: [next.subject] })] }) : null,
  ].filter(Boolean)

  return Box({ flexDirection: 'column', children: [title, ...summary, ...(summary.length ? [Text({ children: [' '] })] : []), ...rows] })
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
