import { expect, test } from 'claude-code/testing'
import { fmtPct, labelSpot, pieGrid, splitUsage } from '../hooks/lib.js'

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

const usage = (read: number, write: number, input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model: 'claude-test',
})

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)

test('splitUsage keeps the request total and carves out tool use', () => {
  const u = usage(9000, 1000, 50, 400)
  const { mix, pendingLeft } = splitUsage(u, {
    toolUses: [{ name: 'Read', input: { file_path: 'x'.repeat(76) } }],
    pendingToolTokens: 300,
    failedTools: new Set(),
  })
  expect(sum(mix)).toBe(10450)
  // 300 tool-result tokens from the cache write, ~33 output tokens for the call
  expect(mix.cacheWrite).toBe(700)
  expect(mix.tool).toBe(300 + 33)
  expect(mix.output).toBe(400 - 33)
  expect(pendingLeft).toBe(0)
})

test('splitUsage counts a resent request and a redone tool call as retries', () => {
  const resent = splitUsage(usage(100, 0, 10, 20), { isRetry: true }).mix
  expect(resent.retry).toBe(130)
  expect(sum(resent)).toBe(130)

  const redo = splitUsage(usage(0, 0, 0, 1000), { toolUses: [{ name: 'Bash', input: { command: 'npm test' } }], failedTools: new Set(['Bash']) }).mix
  expect(redo.retry).toBeGreaterThan(0)
  expect(redo.tool).toBe(0)
  expect(sum(redo)).toBe(1000)

  // Never more tool tokens than the output reported
  const capped = splitUsage(usage(0, 0, 0, 5), { toolUses: [{ name: 'Write', input: { content: 'x'.repeat(4000) } }] }).mix
  expect(capped.tool).toBe(5)
  expect(capped.output).toBe(0)
})

test('the pie covers every slice in proportion and labels only the wide ones', () => {
  const values = [2, 8, 5, 70, 14, 1]
  const grid = pieGrid(values, 16)
  const counts = values.map((_, i) => grid.flat().filter((x: number) => x === i).length)
  const inside = grid.flat().filter((x: number) => x >= 0).length
  expect(Math.abs(counts[3] / inside - 0.7)).toBeLessThan(0.05)
  expect(labelSpot(grid, values, 3, 3)).not.toBeNull()
  expect(labelSpot(grid, values, 5, 2)).toBeNull()
  expect(pieGrid([0, 0], 4).flat().every((x: number) => x === -1)).toBe(true)
  expect(fmtPct(0.04)).toBe('<0.1%')
  expect(fmtPct(4)).toBe('4%')
  expect(fmtPct(4.25)).toBe('4.3%')
  expect(fmtPct(42.4)).toBe('42%')
})

const stop = ($: any) => $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)

test('Total Distribution appears once a turn ends and updates only at the next turn end', async ($, on) => {
  on('classic.Stop', () => ({}))
  let next: any = usage(9000, 1000, 50, 400)
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: next }
  })
  let index = 0
  const step = async () => {
    const stream = $.turn.step({ turnId: 't', index: index++, model: 'claude-test', messageCount: 1 })
    let s = await stream.next()
    while (s.done !== true) s = await stream.next()
  }

  await step()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'TOTAL DISTRIBUTION' })).toBeUndefined()
  await ui.unmount()

  await stop($)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'TOTAL DISTRIBUTION' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^10k tokens · 1 turn$/ })).toBeDefined()
  // cache read is the wide slice: its share is drawn inside the pie
  expect(await ui.find({ type: 'Text', text: '86%' })).toBeDefined()

  // A ledger press shows that entry's share; the toggle shows the narrow slices'
  expect(await ui.find({ type: 'Text', text: '0.5%' })).toBeUndefined()
  await ui.press({ key: 'dist-input' })
  expect(await ui.find({ type: 'Text', text: '0.5%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3.8%' })).toBeUndefined()
  await ui.press({ key: 'dist-small' })
  expect(await ui.find({ type: 'Text', text: '3.8%' })).toBeDefined()
  await ui.unmount()

  // More tokens mid-turn: the figures stay as they were
  next = usage(90000, 0, 0, 0)
  await step()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^10k tokens/ })).toBeDefined()
  await ui.unmount()

  await stop($)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^100k tokens · 2 turns$/ })).toBeDefined()
})

test('Total Distribution appears when only turn.complete ends the turn, and a turn ending both ways counts once', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage(9000, 1000, 50, 400) }
  })
  let index = 0
  const step = async () => {
    const stream = $.turn.step({ turnId: 't', index: index++, model: 'claude-test', messageCount: 1 })
    let s = await stream.next()
    while (s.done !== true) s = await stream.next()
  }

  await step()
  await $.turn.complete({ turnId: 't', reason: 'answer', isAborted: false } as any)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'TOTAL DISTRIBUTION' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· 1 turn$/ })).toBeDefined()
  await ui.unmount()

  // The same turn's Stop after it adds no turn
  await stop($)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /· 1 turn$/ })).toBeDefined()
  await ui.unmount()

  // A Stop whose background list is malformed still ends the next turn
  await step()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [null] } as any)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /· 2 turns$/ })).toBeDefined()
})
