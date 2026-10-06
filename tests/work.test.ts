import { expect, test } from 'claude-code/testing'
import { describeToolCall, mergeAgents, parsePlan, swarmRows } from '../hooks/lib.js'

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
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const PLAN = `# Plan: Add the work section

Some context first.

1. Parse the **plan** from \`ExitPlanMode\`
2. Draw it in the pane
   - a nested bullet that is not a step
3. Test it

\`\`\`js
1. not a step either
\`\`\`
`

test('parsePlan takes the top-level numbered items, else headings, else bullets', () => {
  expect(parsePlan(PLAN)).toEqual({ title: 'Add the work section', steps: ['Parse the plan from ExitPlanMode', 'Draw it in the pane', 'Test it'] })
  expect(parsePlan('## Context\ntext\n## Change lib.js\n## Verify').steps).toEqual(['Context', 'Change lib.js', 'Verify'])
  expect(parsePlan('- [ ] one\n- [x] two').steps).toEqual(['one', 'two'])
  expect(parsePlan('').steps).toEqual([])
})

test('mergeAgents keeps finished subagents, leaves out swarm-mod ones, and caps the list', () => {
  let known = mergeAgents({}, [{ id: 'a1', type: 'Explore', description: 'find routes', status: 'running' }, { id: 's1', type: 'teammate', description: 'x', status: 'running', spawnedBy: 'swarm-mod' }], 1, 'swarm-mod')
  expect(Object.keys(known)).toEqual(['a1'])
  known = mergeAgents(known, [], 2, 'swarm-mod')
  expect(known.a1.status).toBe('completed')
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, type: 'Explore', description: 'd', status: 'completed' }))
  expect(Object.keys(mergeAgents({}, many, 3)).length).toBe(8)
})

test('swarmRows reads swarm-mod snapshot agents in order', () => {
  const rows = swarmRows({
    order: ['b', 'a'],
    agents: {
      a: { name: 'scout', status: 'working', activity: 'Bash: npm test', tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 } },
      b: { name: 'fixer', status: 'idle', task: 'fix the bug', pending: { kind: 'question' } },
    },
  })
  expect(rows.map((r) => r.name)).toEqual(['fixer', 'scout'])
  expect(rows[0].pending).toBe('question')
  expect(rows[1].tokens).toBe(1500)
  expect(swarmRows(undefined)).toEqual([])
})

test('an approved plan shows its steps, and is ticked when the turn ends', async ($, on) => {
  on('classic.Stop', () => ({}))
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'ExitPlanMode') return { result: { plan: PLAN, isAgent: false }, text: 'User has approved your plan.' }
    return { result: {}, text: 'ok' }
  })
  await $.tool.call({ tool: 'ExitPlanMode' } as any)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '● plan' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Draw it in the pane' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Add the work section · approved/ })).toBeDefined()
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Add the work section · done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '☑' })).toBeDefined()
})

test('subagents show as type · description with their status', async ($, on) => {
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  let listed: any[] = [{ id: 'ag1', type: 'Explore', description: 'find routing files', status: 'running' }]
  on('agent.list', () => ({ value: listed }))
  await $.classic.SubagentStart({ agent_id: 'ag1', agent_type: 'Explore' } as any)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '● subagents' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Explore · find routing files' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 running' })).toBeDefined()
  await ui.unmount()

  listed = []
  await $.classic.SubagentStop({ agent_id: 'ag1', agent_type: 'Explore', stop_hook_active: false, agent_transcript_path: '' } as any)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'all finished' })).toBeDefined()
})

test('swarm-mod agents show in their own group when swarm-mod is loaded', async ($, on) => {
  on('state.get', ($: any, e: any, next: any) => {
    if (e.plugin !== 'swarm-mod') return next(e)
    return {
      value: {
        version: 1,
        value: {
          order: ['a'],
          agents: { a: { name: 'scout', status: 'working', activity: 'Bash: npm test', tokens: { input: 2000, output: 0, cacheRead: 0, cacheWrite: 0 } } },
        },
      },
    }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '● swarm' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'scout · Bash: npm test' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2.0k' })).toBeDefined()
})

test('describeToolCall gives a short line per tool', () => {
  expect(describeToolCall({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })).toBe('Bash · Run the tests')
  expect(describeToolCall({ tool: 'PowerShell', command: 'Get-ChildItem' })).toBe('PowerShell · Get-ChildItem')
  expect(describeToolCall({ tool: 'Read', file_path: 'D:\\src\\hooks\\view.js' })).toBe('Read · view.js')
  expect(describeToolCall({ tool: 'WebFetch', url: 'https://example.com/a/b' })).toBe('WebFetch · example.com')
  expect(describeToolCall({ tool: 'Agent', subagent_type: 'Explore', description: 'find routes' })).toBe('Agent · Explore · find routes')
  expect(describeToolCall({ tool: 'mcp__slack__send' })).toBe('slack · send')
  expect(describeToolCall({ tool: 'TaskList' })).toBe('TaskList')
})

test('now shows working, waiting and done for the main agent', async ($, on) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  let release: () => void = () => {}
  on('tool.call', async ($: any, e: any) => {
    if (e.tool === 'AskUserQuestion') await new Promise<void>((r) => (release = r))
    return { result: {}, text: 'ok' }
  })
  const find = async (text: any) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const hit = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return hit
  }

  await $.turn.start({ text: 'Add a status line to the dashboard\nmore detail', turnId: 't1' } as any)
  expect(await find(' working ')).toBeDefined()
  expect(await find('Add a status line to the dashboard')).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as any)
  expect(await find('Bash · Run the tests')).toBeDefined()

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } } as any)
  expect(await find(' waiting ')).toBeDefined()
  expect(await find('needs approval: Bash · rm x')).toBeDefined()
  await $.tool.call({ tool: 'Bash', command: 'rm x' } as any)
  expect(await find(' working ')).toBeDefined()

  const asking = $.tool.call({ tool: 'AskUserQuestion' } as any)
  await new Promise((r) => setTimeout(r, 10))
  expect(await find(' waiting ')).toBeDefined()
  release()
  await asking
  expect(await find(' working ')).toBeDefined()

  await $.turn.complete({ turnId: 't1', reason: 'aborted', isAborted: true } as any)
  expect(await find(' done ')).toBeDefined()
  expect(await find('interrupted')).toBeDefined()
  // The clock stops: done shows the total time, not a time-since that keeps counting
  expect(await find(/^took \d+:\d\d$/)).toBeDefined()
  expect(await find(/s ago$/)).toBeUndefined()
})

test('the … under now expands the whole prompt, and ▴ less folds it again', async ($, on) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  const prompt =
    'Make the dashboard prompt row expandable so a long request can be read in full, without leaving the pane\n' +
    'Second line with the details we cut off'
  await $.turn.start({ text: prompt, turnId: 't1' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as any)
    // Folded: the first line, cut to fit, then a pressable …
    expect(await ui.find({ type: 'Text', text: /^Make the dashboard prompt row/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Second line/ })).toBeUndefined()

    await ui.press({ key: 'prompt-toggle' })
    expect(await ui.find({ type: 'Text', text: prompt })).toBeDefined()

    await ui.press({ key: 'prompt-toggle' })
    expect(await ui.find({ type: 'Text', text: /Second line/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a short one-line prompt has no … to press', async ($, on) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Fix the clock', turnId: 't1' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: 'Fix the clock' })).toBeDefined()
  let pressed = true
  try {
    await ui.press({ key: 'prompt-toggle' })
  } catch {
    pressed = false
  }
  expect(pressed).toBe(false)
})
