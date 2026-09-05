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
  nodes: [n('in', 'input'), n('src', 'source'), n('emb', 'embed'), n('rr', 'reranker'),
          n('sys', 'system'), n('out', 'output'), n('agt', 'agent')],
  edges: [],
}

check('input -> embed is allowed', connectionIssue(g, 'in', 'emb'), null)
check('embed -> source is allowed', connectionIssue(g, 'emb', 'src'), null)
check('source -> reranker is allowed', connectionIssue(g, 'src', 'rr'), null)
check('reranker -> output is allowed', connectionIssue(g, 'rr', 'out'), null)
check('source -> output is allowed', connectionIssue(g, 'src', 'out'), null)
check('self connection refused', connectionIssue(g, 'src', 'src'), 'A widget cannot connect to itself.')
check('Input takes no input', connectionIssue(g, 'src', 'in'),
  'Input does not take an input — wire it onwards instead.')
check('System takes no input', connectionIssue(g, 'src', 'sys'),
  'System message does not take an input — wire it onwards instead.')
check('Output has no output', connectionIssue(g, 'out', 'rr'),
  'Output has no output to wire from.')
check('unknown node refused', connectionIssue(g, 'src', 'ghost'), 'That widget is no longer on the canvas.')
check('unknown widget kind refused, not crashed',
  connectionIssue({ nodes: [n('a', 'legacy'), n('b', 'output')], edges: [] }, 'a', 'b'),
  'This flow uses a widget this version does not know.')

const dup = { ...g, edges: [e('src', 'rr')] }
check('duplicate wire refused', connectionIssue(dup, 'src', 'rr'), 'Already wired to Reranker.')
check('a second distinct wire still allowed', connectionIssue(dup, 'rr', 'out'), null)

const loopy = {
  nodes: [n('a', 'source'), n('b', 'source'), n('c', 'source')],
  edges: [e('a', 'b'), e('b', 'c')],
}
check('longer loop refused', connectionIssue(loopy, 'c', 'a'), 'That would make a loop.')
check('forward wire in same chain allowed', connectionIssue(loopy, 'a', 'c'), null)

check('source -> agent is allowed', connectionIssue(g, 'src', 'agt'), null)
check('agent -> output is allowed', connectionIssue(g, 'agt', 'out'), null)
check('agent takes an input', connectionIssue(g, 'in', 'agt'), null)

// A Router's routes are separate outputs, so the duplicate rule is per route.
const router = {
  nodes: [n('rt', 'router'), n('x', 'source'), n('y', 'source')],
  edges: [{ id: 'rtx', source: 'rt', target: 'x', sourceHandle: 'a' }],
}
router.nodes[0].config = { routes: [{ id: 'a', label: 'A', when: 'x' }, { id: 'b', label: 'B', when: 'y' }] }
check('a second target on the same route refused',
  connectionIssue(router, 'rt', 'y', 'a'), 'Route A already leads somewhere.')
check('a different route may be wired', connectionIssue(router, 'rt', 'y', 'b'), null)
check('the same pair on a different route is allowed',
  connectionIssue(router, 'rt', 'x', 'b'), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
