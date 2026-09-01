import { connectionIssue } from '../src/sections/workflow/resolve.ts'
let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}
const n = (id, kind) => ({ id, kind, position: { x: 0, y: 0 }, config: {} })
const e = (source, target) => ({ id: `${source}->${target}`, source, target })
const g = {
  nodes: [n('src', 'source'), n('sys', 'system'), n('ret', 'retrieval'),
          n('ans', 'answer'), n('agt', 'agent')],
  edges: [],
}

check('source -> retrieval is allowed', connectionIssue(g, 'src', 'ret'), null)
check('source -> answer is allowed', connectionIssue(g, 'src', 'ans'), null)
check('retrieval -> answer is allowed', connectionIssue(g, 'ret', 'ans'), null)
check('self connection refused', connectionIssue(g, 'ret', 'ret'), 'A widget cannot connect to itself.')
check('target with no input refused', connectionIssue(g, 'ret', 'src'),
  'Source does not take an input — wire it onwards instead.')
check('system as a target refused', connectionIssue(g, 'src', 'sys'),
  'System message does not take an input — wire it onwards instead.')
check('source with no output refused', connectionIssue(g, 'ans', 'ret'),
  'Answer has no output to wire from.')
check('unknown node refused', connectionIssue(g, 'src', 'ghost'), 'That widget is no longer on the canvas.')

const dup = { ...g, edges: [e('src', 'ret')] }
check('duplicate wire refused', connectionIssue(dup, 'src', 'ret'), 'Already wired to Retrieval.')
check('a second distinct wire still allowed', connectionIssue(dup, 'ret', 'ans'), null)

const chain = { ...g, edges: [e('src', 'ret'), e('ret', 'ans')] }
check('loop refused', connectionIssue(chain, 'ans', 'src'), 'Answer has no output to wire from.')
const loopy = {
  nodes: [n('a', 'retrieval'), n('b', 'retrieval'), n('c', 'retrieval')],
  edges: [e('a', 'b'), e('b', 'c')],
}
check('longer loop refused', connectionIssue(loopy, 'c', 'a'), 'That would make a loop.')
check('forward wire in same chain allowed', connectionIssue(loopy, 'a', 'c'), null)

check('source -> agent is allowed', connectionIssue(g, 'src', 'agt'), null)
check('agent -> answer is allowed', connectionIssue(g, 'agt', 'ans'), null)
check('agent takes an input', connectionIssue(g, 'ret', 'agt'), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
