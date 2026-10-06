import { expect, test } from 'claude-code/testing'
import { classifyToolResult, matchProcess, parseNetstat, parseProcessList, parseTaskNotification, promptFromMessages } from '../hooks/lib.js'

// Captured from a real Windows session: Claude Code's Bash tool running `python -m http.server 8765` in the background
const SHELL =
  '"C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe" -c "source /c/Users/me/.claude/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && ' +
  "shopt -u extglob 2>/dev/null || true && eval 'python -m http.server 8765' < /dev/null && pwd -P >| /c/Users/me/AppData/Local/Temp/claude-1890-cwd\""
const PROCS = [
  '37436\t1\t"C:\\Program Files\\Git\\bin\\bash.exe" -c "unrelated"',
  '13504\t8200\t' + SHELL,
  '12548\t13504\tC:\\Python312\\python.exe -m http.server 8765',
  '999\t1\tC:\\Python312\\python.exe -m pip list',
].join('\r\n')
const NETSTAT = [
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:8765           0.0.0.0:0              LISTENING       12548',
  '  TCP    [::]:8765              [::]:0                 LISTENING       12548',
  '  TCP    127.0.0.1:50000        127.0.0.1:50001        ESTABLISHED     12548',
].join('\r\n')

test('finds the server under the shell that ran it, with its port', () => {
  const hit = matchProcess('python -m http.server 8765', parseProcessList(PROCS, true), parseNetstat(NETSTAT))
  expect(hit).toEqual({ rootPid: 13504, pid: 12548, ports: [8765], pids: [13504, 12548] })
})

test('does not match a different command of the same program', () => {
  const hit = matchProcess('python -m http.server 9000', parseProcessList(PROCS, true), parseNetstat(NETSTAT))
  expect(hit).toBe(null)
})

test('reads a background task notification', () => {
  const note = parseTaskNotification('<task-notification><task-id>b7x2</task-id><status>failed</status><summary>exit code 1</summary></task-notification>')
  expect(note).toEqual({ id: 'b7x2', status: 'failed', exitCode: 1 })
})

test('classifies errors in successful output, and leaves clean output alone', () => {
  expect(classifyToolResult('WebFetch', { result: {}, text: 'Request failed with status code 500' })?.kind).toBe('HTTP 500')
  expect(classifyToolResult('PowerShell', { result: {}, text: "'foo' is not recognized as the name of a cmdlet" })?.kind).toBe('command not found')
  expect(classifyToolResult('Bash', { result: {}, text: 'all good' })).toBe(null)
  // Reading a file that mentions 404 is not an error
  expect(classifyToolResult('Read', { result: {}, text: 'HTTP/1.1 404 Not Found' })).toBe(null)
})

test('promptFromMessages finds the whole prompt a headline was cut from', () => {
  const long = 'on the task where we show the prompt beneath the task row, we truncate it, can we make the ... clickable so it expands'
  const messages = [
    { role: 'user', text: 'an older request' },
    { role: 'user', text: long + '\r\nand a way to close it again (collapse)\n<system-reminder>hook context</system-reminder>' },
    { role: 'assistant', text: 'working on it' },
    { role: 'user', text: '' },
  ]
  expect(promptFromMessages(messages, long.slice(0, 100))).toBe(long + '\nand a way to close it again (collapse)')
  expect(promptFromMessages(messages, 'not there')).toBe('')
  expect(promptFromMessages(undefined, 'x')).toBe('')
})
