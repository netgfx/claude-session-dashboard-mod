import { expect, test } from 'claude-code/testing'
import { baseName, cleanPath, gitignoreAdd, gitignoreRemove, isValidLinkName, isWithin, uniqueName } from '../hooks/lib.js'

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

const HEADER = '# Linked folders (session-dashboard)'

test('gitignore entries go under one header and leave the rest alone', () => {
  const one = gitignoreAdd('node_modules/\n', 'notes')
  expect(one).toBe('node_modules/\n\n' + HEADER + '\n/notes\n')
  const two = gitignoreAdd(one, 'docs')
  expect(two).toBe('node_modules/\n\n' + HEADER + '\n/notes\n/docs\n')
  expect(gitignoreAdd(two, 'docs')).toBe(two)
  expect(gitignoreRemove(two, 'notes')).toBe('node_modules/\n\n' + HEADER + '\n/docs\n')
  // The last entry out takes the header and its blank line with it
  expect(gitignoreRemove(gitignoreRemove(two, 'notes'), 'docs')).toBe('node_modules/\n')
  expect(gitignoreAdd('', 'a')).toBe(HEADER + '\n/a\n')
  expect(gitignoreAdd('x\r\n', 'a')).toBe('x\r\n\r\n' + HEADER + '\r\n/a\r\n')
  expect(gitignoreAdd('', '#odd [name]')).toBe(HEADER + '\n/\\#odd \\[name\\]\n')
})

test('path and name helpers', () => {
  expect(baseName('C:\\work\\notes\\')).toBe('notes')
  expect(baseName('/Users/me/notes')).toBe('notes')
  expect(cleanPath('  "C:\\a b\\c\\"  ')).toBe('C:\\a b\\c')
  expect(cleanPath('C:\\')).toBe('C:\\')
  expect(cleanPath('/')).toBe('/')
  expect(isValidLinkName('docs')).toBe(true)
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'trail.', ' lead']) expect(isValidLinkName(bad)).toBe(false)
  expect(uniqueName('notes', ['notes', 'notes-2'])).toBe('notes-3')
  // macOS and Windows disks ignore case
  expect(uniqueName('Notes', ['notes'])).toBe('Notes-2')
  expect(isWithin('C:\\Work\\src', 'c:\\work')).toBe(true)
  expect(isWithin('/Users/Me/work/src', '/users/me/work')).toBe(true)
  expect(isWithin('/work2', '/work')).toBe(false)
  expect(isWithin('/work', '/work/')).toBe(true)
})

// The engine resolves fs paths against the host ("/work" -> "D:\work" on Windows): compare them Unix style
const unix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// A Unix workspace at /work with a .gitignore; ln and rm change the links it lists.
// `picked` answers the folder picker; null means no picker is installed.
function stubWorkspace(on: any, picked: () => any) {
  const files: Record<string, string> = { '/work/.gitignore': 'node_modules/\n' }
  const linksOnDisk = new Map<string, string>()
  const runs: string[][] = []
  const store: Record<string, unknown> = {}
  const toasts: string[] = []
  on('session.root', () => ({ value: '/work' }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($: any, e: any) => ({ value: store[e.key] }))
  on('store.set', ($: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('fs.read', ($: any, e: any) => {
    const path = unix(e.path)
    return path in files ? { value: files[path] } : { deny: 'ENOENT' }
  })
  on('fs.write', ($: any, e: any) => {
    files[unix(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.stat', ($: any, e: any) =>
    unix(e.path) === '/Users/me/notes' || unix(e.path) === '/work/src'
      ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
      : { deny: 'ENOENT' },
  )
  on('fs.list', () => ({
    value: [
      { name: '.gitignore', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
      { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      ...[...linksOnDisk.keys()].map((name) => ({ name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })),
    ],
  }))
  on('process.run', ($: any, e: any) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === 'osascript') {
      const answer = picked()
      return answer ? { value: answer } : { deny: 'spawn osascript ENOENT' }
    }
    if (argv[0] === 'zenity' || argv[0] === 'kdialog') return { deny: 'spawn ' + argv[0] + ' ENOENT' }
    if (argv[0] === 'ln') linksOnDisk.set(argv[3].split('/').pop()!, argv[2])
    if (argv[0] === 'rm') linksOnDisk.delete(argv[1].split('/').pop()!)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { files, linksOnDisk, runs, store, toasts }
}

test('+ picks a folder, links it into the workspace and ignores it in git', async ($, on) => {
  const w = stubWorkspace(on, () => ({ exitCode: 0, stdout: '/Users/me/notes\n', stderr: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'LINKED FOLDERS' })).toBeDefined()

  await ui.press({ key: 'link-add' })
  const picker = w.runs.find((r) => r[0] === 'osascript')!
  expect(picker[picker.length - 1]).toMatch(/^POSIX path of \(choose folder/)
  expect(w.runs.some((r) => r[0] === 'ln' && r[1] === '-sn' && r[2] === '/Users/me/notes' && r[3] === '/work/notes')).toBe(true)
  expect(w.files['/work/.gitignore']).toBe('node_modules/\n\n' + HEADER + '\n/notes\n')
  expect(await ui.find({ type: 'Text', text: /^notes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '→ /Users/me/notes' })).toBeDefined()
  expect(w.store['links:/work']).toEqual([expect.objectContaining({ name: 'notes', target: '/Users/me/notes' })])
})

test('renaming a link moves the link and its .gitignore entry', async ($, on) => {
  const w = stubWorkspace(on, () => ({ exitCode: 0, stdout: '/Users/me/notes\n', stderr: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })

  await ui.press({ key: 'link-edit-notes' })
  await ui.input({ key: 'link-name-notes', text: 'docs' })
  expect(w.runs.some((r) => r[0] === 'ln' && r[3] === '/work/docs')).toBe(true)
  expect(w.runs.some((r) => r[0] === 'rm' && r[1] === '/work/notes')).toBe(true)
  expect([...w.linksOnDisk.keys()]).toEqual(['docs'])
  expect(w.files['/work/.gitignore']).toBe('node_modules/\n\n' + HEADER + '\n/docs\n')
  expect(await ui.find({ type: 'Text', text: /^docs/ })).toBeDefined()
  expect(await ui.find({ key: 'link-edit-docs' })).toBeDefined()

  // A name already taken in the workspace is refused, and nothing moves
  await ui.press({ key: 'link-edit-docs' })
  await ui.input({ key: 'link-name-docs', text: 'src' })
  expect(w.toasts.some((t) => /already exists/.test(t))).toBe(true)
  expect([...w.linksOnDisk.keys()]).toEqual(['docs'])
})

test('names that differ only in case count as taken, as on a macOS disk', async ($, on) => {
  // osascript answers with a trailing slash
  let pick = '/Users/me/notes/'
  const w = stubWorkspace(on, () => ({ exitCode: 0, stdout: pick + '\n', stderr: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })
  expect(w.runs.some((r) => r[0] === 'ln' && r[2] === '/Users/me/notes' && r[3] === '/work/notes')).toBe(true)

  // Renaming onto "SRC" when "src" exists is refused before ln runs
  await ui.press({ key: 'link-edit-notes' })
  await ui.input({ key: 'link-name-notes', text: 'SRC' })
  expect(w.toasts.some((t) => /SRC already exists/.test(t))).toBe(true)
  expect(w.runs.filter((r) => r[0] === 'ln').length).toBe(1)

  // A case-only rename goes through a temporary name, never onto the old link
  await ui.press({ key: 'link-edit-notes' })
  await ui.input({ key: 'link-name-notes', text: 'Notes' })
  const lns = w.runs.filter((r) => r[0] === 'ln').map((r) => r[3])
  expect(lns).toEqual(['/work/notes', '/work/notes.sd-rename', '/work/Notes'])
  expect([...w.linksOnDisk.keys()]).toEqual(['Notes'])
  expect(w.files['/work/.gitignore']).toBe('node_modules/\n\n' + HEADER + '\n/Notes\n')
})

test('✕ removes the link alone and its .gitignore entry', async ($, on) => {
  const w = stubWorkspace(on, () => ({ exitCode: 0, stdout: '/Users/me/notes\n', stderr: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })
  await ui.press({ key: 'link-remove-notes' })
  expect(w.runs.filter((r) => r[0] === 'rm')).toEqual([['rm', '/work/notes']])
  expect(w.files['/work/.gitignore']).toBe('node_modules/\n')
  expect(await ui.find({ type: 'Text', text: /^None\. Press \+/ })).toBeDefined()
})

test('a cancelled picker changes nothing', async ($, on) => {
  const w = stubWorkspace(on, () => ({ exitCode: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })
  expect(w.runs.some((r) => r[0] === 'ln')).toBe(false)
  expect(w.files['/work/.gitignore']).toBe('node_modules/\n')
  expect(await ui.find({ key: 'link-path' })).toBeUndefined()
})

test('with no folder picker the pane asks for a typed path', async ($, on) => {
  const w = stubWorkspace(on, () => null)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })
  expect(await ui.find({ key: 'link-path' })).toBeDefined()
  await ui.input({ key: 'link-path', text: '"/Users/me/notes/"' })
  expect(w.runs.some((r) => r[0] === 'ln' && r[2] === '/Users/me/notes' && r[3] === '/work/notes')).toBe(true)
  expect(await ui.find({ key: 'link-path' })).toBeUndefined()
})

test('linking the workspace itself or a missing folder is refused', async ($, on) => {
  let pick = '/work/src'
  const w = stubWorkspace(on, () => ({ exitCode: 0, stdout: pick + '\n', stderr: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'link-add' })
  pick = '/nowhere'
  await ui.press({ key: 'link-add' })
  expect(w.runs.some((r) => r[0] === 'ln')).toBe(false)
  expect(w.toasts.some((t) => /is the workspace, inside it/.test(t))).toBe(true)
  expect(w.toasts.some((t) => /not a folder: \/nowhere/.test(t))).toBe(true)
})
