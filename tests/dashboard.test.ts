import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-dashboard',
  component: 'Pane',
  requestId: 'session-dashboard',
  viewport: { columns: 160, rows: 50 },
  props: {
    title: 'Dashboard',
    isFocused: true,
    bodyColumns: 54,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 48 },
    view: {},
  },
} as const

const usage = (read: number, write: number, input = 10, output = 50) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model: 'claude-test',
})

// Runs one model request through the mod's turn.step hook
async function step($: any, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
  return s.value
}

function stubStep(on: any, u: () => any) {
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: u() }
  })
}

test('the pane draws on both surfaces with no data', async ($, on) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'SESSION DASHBOARD' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cold' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No plan, tasks or agents yet.' })).toBeDefined()
    await ui.unmount()
  }
})

test('counts tool calls and errors of every kind', async ($, on) => {
  on('tool.call', ($: any, e: any) => {
    if (e.command === 'curl -i x') return { result: {}, text: 'HTTP/1.1 404 Not Found\n' }
    if (e.command === 'false') return { result: {}, text: 'Exit code 1', isError: true }
    if (e.command === 'nope') return { result: {}, text: "bash: nope: command not found" }
    if (e.command === 'rm -rf /') return { deny: 'User refused' }
    return { result: {}, text: 'ok' }
  })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'curl -i x' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'nope' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  await $.tool.call({ tool: 'Read', file_path: 'a.md', agentId: 'sub1' } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '6' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'main 5 · sub 1' })).toBeDefined()
  await ui.press({ key: 'errors-toggle' })
  expect(await ui.find({ type: 'Text', text: /HTTP 404/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /command not found/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /denied/ })).toBeDefined()
})

test('tracks the task list from TaskCreate and TaskUpdate', async ($, on) => {
  let n = 0
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++n), subject: e.subject } }, text: 'ok' }
    return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] }, text: 'ok' }
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write code', description: 'd', activeForm: 'Writing code' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Test it', description: 'd' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Ship', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', activeForm: 'Testing it' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Testing it' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Ship' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '☑' })).toBeDefined()
})

test('TodoWrite replaces the list', async ($, on) => {
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'A', status: 'completed', activeForm: 'Doing A' },
      { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
    ],
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Doing B' })).toBeDefined()
})

test('the cache turns hot after a request and tokens add up per agent', async ($, on) => {
  let next = usage(0, 5000)
  stubStep(on, () => next)
  on('agent.list', () => ({ value: [{ id: 'ag1', type: 'Explore', description: 'find mods', status: 'running' }] }))

  await step($)
  next = usage(5000, 200)
  await step($)
  next = usage(0, 3000, 20, 700)
  await step($, 'ag1')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Hot' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}Explore · find mods/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^main agent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /96% cached/ })).toBeDefined()
})

test('a request that misses a warm cache is flagged as invalidated', async ($, on) => {
  let next = usage(0, 5000)
  stubStep(on, () => next)
  await step($)
  next = usage(0, 5200)
  await step($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /invalidated/ })).toBeDefined()
})

function stubBackground(on: any, cwd: string, toolCalls: any[]) {
  on('session.start', () => ({ cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', ($: any, e: any) => {
    toolCalls.push(e)
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' }, text: 'started' }
    return { result: { message: 'stopped', task_id: e.task_id, task_type: 'shell' }, text: 'ok' }
  })
}

test('a background command shows in the table with its pid and port, and close stops it (Windows)', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const toolCalls: any[] = []
  stubBackground(on, 'C:\\work', toolCalls)
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'powershell') {
      return {
        value: {
          exitCode: 0,
          stderr: '',
          stdout: [
            // Claude Code is pid 50. The scan prints only its tree; the rows of
            // other processes here check that the mod drops them all the same
            'root\t50',
            '900\t1\t"C:\\Program Files\\dotnet\\dotnet.exe" run',
            '100\t50\tC:\\Program Files\\Git\\bin\\bash.exe -c "eval \'dotnet run\' < /dev/null"',
            '200\t100\t"C:\\Program Files\\dotnet\\dotnet.exe" run',
            '300\t200\tC:\\app\\bin\\Debug\\App.exe',
            '400\t1\tnotepad.exe',
          ].join('\r\n'),
        },
      }
    }
    if (e.argv[0] === 'netstat') {
      return {
        value: {
          exitCode: 0,
          stderr: '',
          stdout: '  TCP    0.0.0.0:6000    0.0.0.0:0    LISTENING    900\r\n  TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    300\r\n  TCP    [::]:5000    [::]:0    LISTENING    300\r\n',
        },
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.tool.call({ tool: 'Bash', command: 'dotnet run', run_in_background: true })
  // The mod scans 1.5 s after the command starts
  await clock.advance(1600)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^dotnet run/ })).toBeDefined()
  // The pid shown is the process holding the port, under the shell that ran the command
  expect(await ui.find({ type: 'Text', text: /^300 / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5000/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^900 |^6000/ })).toBeUndefined()

  await ui.press({ key: 'close-bg1' })
  expect(toolCalls.some((c) => c.tool === 'TaskStop' && c.task_id === 'bg1')).toBe(true)
  // Kills the tree from the shell down, never the other dotnet run
  expect(runs.some((r) => r[0] === 'taskkill' && r.includes('100'))).toBe(true)
  expect(runs.some((r) => r[0] === 'taskkill' && r.includes('900'))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /\(stopped\)/ })).toBeDefined()
})

test('a background command shows in the table with its pid and port, and close stops it (macOS, Linux)', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const toolCalls: any[] = []
  stubBackground(on, '/work', toolCalls)
  // Claude Code is pid 50; 900 is someone else's `dotnet run`
  const rows: Record<number, string> = {
    100: "  100    50 /bin/bash -c eval 'dotnet run' < /dev/null",
    200: '  200   100 dotnet run',
    300: '  300   200 /app/bin/Debug/App',
  }
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    const argv = e.argv.join(' ')
    if (argv === 'sh -c echo $PPID') return { value: { exitCode: 0, stderr: '', stdout: '50\n' } }
    if (argv === 'ps -A -o pid=,ppid=') {
      return { value: { exitCode: 0, stderr: '', stdout: ['    1     0', '   50     1', '  100    50', '  200   100', '  300   200', '  900     1', ''].join('\n') } }
    }
    if (e.argv[0] === 'ps') {
      const pids = e.argv[e.argv.indexOf('-p') + 1].split(',').map(Number)
      // Answers for the pids asked, plus the foreign process as if its pid had been reused
      return { value: { exitCode: 0, stderr: '', stdout: [...pids.map((p: number) => rows[p]), '  900     1 dotnet run', ''].join('\n') } }
    }
    if (e.argv[0] === 'lsof') return { value: { exitCode: 0, stderr: '', stdout: 'p900\nn*:6000\np300\nn*:5000\n' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.tool.call({ tool: 'Bash', command: 'dotnet run', run_in_background: true })
  await clock.advance(1600)

  // Command lines are read for Claude Code's own tree only, never with -A
  const asked = runs.find((r) => r[0] === 'ps' && r.includes('-p'))!
  expect(asked[asked.indexOf('-p') + 1]).toBe('100,200,300')
  expect(asked.join(' ')).toContain('args=')
  expect(runs.some((r) => r[0] === 'ps' && r.includes('-A') && r.join(' ').includes('args='))).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^300 / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5000/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^900 |^6000/ })).toBeUndefined()

  await ui.press({ key: 'close-bg1' })
  const kill = runs.find((r) => r[0] === 'kill')!
  expect(kill.slice(0, 2)).toEqual(['kill', '-TERM'])
  expect([...kill.slice(2)].sort()).toEqual(['100', '200', '300'])
  expect(await ui.find({ type: 'Text', text: /\(stopped\)/ })).toBeDefined()
})

test('refresh stops the command and starts it again in the background', async ($, on) => {
  const clock = mock.clock(on)
  const toolCalls: any[] = []
  let n = 0
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('tool.call', ($: any, e: any) => {
    toolCalls.push(e)
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg' + ++n }, text: 'started' }
    return { result: { message: 'stopped', task_id: e.task_id, task_type: 'shell' }, text: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await clock.advance(100)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh-bg1' })
  const bash = toolCalls.filter((c) => c.tool === 'Bash')
  expect(bash.length).toBe(2)
  expect(bash[1].command).toBe('npm run dev')
  expect(bash[1].run_in_background).toBe(true)
  expect(toolCalls.some((c) => c.tool === 'TaskStop' && c.task_id === 'bg1')).toBe(true)
  expect(await ui.find({ key: 'close-bg2' })).toBeDefined()
})

test('the prompt gets no task-list instruction unless force_task_list is on', async ($, on) => {
  let seen: any
  on('prompt.submit', ($: any, e: any) => {
    seen = e
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'build it' } as any)
  expect(seen.context ?? []).toEqual([])
})

const band = (isFullscreen: boolean) => ({
  plugin: 'session-dashboard',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 160, rows: 50, isFullscreen },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

function stubStart(on: any, opened: any[], toasts: string[], usageValue: any = null) {
  mock.clock(on)
  // Beneath the mod's AbovePrompt hook: the engine's own (empty) band
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({}))
  on('session.start', () => ({ cwd: 'C:\\work' }))
  on('session.cwd', () => ({ value: 'C:\\work' }))
  on('session.usage', () => ({ value: usageValue }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text ?? String(e))
    return { value: undefined }
  })
}

test('auto-open waits for the fullscreen layout so the pane docks on the right', async ($, on) => {
  const opened: any[] = []
  stubStart(on, opened, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  expect(opened.length).toBe(0)
  await $.ui.mount(band(true) as any)
  expect(opened.some((o) => o.id === 'session-dashboard')).toBe(true)
})

test('auto-open never opens the pane above the prompt on the main screen', async ($, on) => {
  const opened: any[] = []
  stubStart(on, opened, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.ui.mount(band(false) as any)
  expect(opened.length).toBe(0)
})

test('/session-dashboard on the main screen explains instead of opening above the prompt', async ($, on) => {
  const opened: any[] = []
  const toasts: string[] = []
  stubStart(on, opened, toasts)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.command.run({ command: 'session-dashboard', args: '', presentation: { isFullscreen: false, columns: 200 } } as any)
  expect(opened.length).toBe(0)
  expect(toasts.some((t) => /fullscreen/.test(t))).toBe(true)

  await $.command.run({ command: 'session-dashboard', args: '', presentation: { isFullscreen: true, columns: 200 } } as any)
  expect(opened.some((o) => o.id === 'session-dashboard')).toBe(true)
})

test('usage limits show a bar per window, and none when a window is unused', async ($, on) => {
  stubStart(on, [], [], {
    startedAt: 0,
    context: { percent: 10, window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0 },
      { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString() },
    ],
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.command.run({ command: 'session-dashboard', args: '', presentation: { isFullscreen: true, columns: 200 } } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'USAGE LIMITS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ *0%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ *40%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^█{10,} *$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3d [45]h$/ })).toBeDefined()
})

test('the cache TTL is 60 minutes on a subscription (plan windows in usage), 5 otherwise', async ($, on) => {
  let usageValue: any = { startedAt: 0, context: { percent: 1, window: 200000 }, rateLimits: [] }
  on('session.usage', () => ({ value: usageValue }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  stubStep(on, () => usage(900, 100))
  mock.clock(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await step($)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TTL 5m$/ })).toBeDefined()
  await ui.unmount()

  // The first response of a subscription session brings its plan windows
  usageValue = { ...usageValue, rateLimits: [{ kind: 'five_hour', percentUsed: 3 }] }
  await step($)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TTL 60m \(auto\)$/ })).toBeDefined()
})

test('cache_ttl_minutes overrides the TTL whatever usage says', { options: { cache_ttl_minutes: 15 } }, async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 3 }] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  stubStep(on, () => usage(900, 100))
  mock.clock(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await step($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TTL 15m$/ })).toBeDefined()
})
