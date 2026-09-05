import { resolve } from '../src/sections/workflow/resolve.ts'
let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}
const n = (id, kind, config = {}) => ({ id, kind, position: { x: 0, y: 0 }, config })
const e = (a, b) => ({ id: `${a}->${b}`, source: a, target: b })
const g = (nodes, edges) => ({ nodes, edges })

console.log('--- the two ends ---')
check('missing Input flagged', resolve(g([n('o', 'output')], [])).problems,
  ['Add an Input widget — a run has to start somewhere.'])
check('missing Output flagged', resolve(g([n('i', 'input')], [])).problems,
  ['Add an Output widget — a run has to end somewhere.'])
let r = resolve(g([n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }), n('o', 'output')],
  [e('s', 'o')]))
check('unwired Input flagged', r.problems[0], 'Wire the Input widget through to the Output widget.')

console.log('\n--- a complete flow ---')
const complete = g(
  [n('i', 'input'), n('e', 'embed', { model: 'm' }),
   n('s', 'source', { sourceType: 'files', sourceIds: ['A'], method: 'mmr', docs: 10 }),
   n('r', 'reranker', { model: 'cross-encoder/x', keep: 5 }), n('o', 'output')],
  [e('i', 'e'), e('e', 's'), e('s', 'r'), e('r', 'o')],
)
check('no problems', resolve(complete).problems, [])
check('everything is reachable', resolve(complete).reachable.size, 5)

console.log('\n--- main.flow must be chat at both ends ---')
const payloadEnds = g(
  [n('i', 'input', { mode: 'payload' }), n('s', 'source', { sourceType: 'txt', text: 'x' }),
   n('o', 'output', { mode: 'payload', payloadType: 'json' })],
  [e('i', 's'), e('s', 'o')],
)
check('payload ends fine in a called flow', resolve(payloadEnds).problems, [])
check('payload Input refused in main.flow',
  resolve(payloadEnds, { isMain: true }).problems,
  ['The Input widget in main.flow must be set to Chat.',
   'The Output widget in main.flow must be set to Chat.'])

console.log('\n--- embedding is required to retrieve ---')
check('files Source without Embed', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'files', sourceIds: ['A'] }), n('o', 'output')],
  [e('i', 's'), e('s', 'o')])).problems[0],
  'Wire an Embed widget in — it turns the question into a vector to search with.')
check('blank Embed model is allowed', resolve(g(
  [n('i', 'input'), n('e', 'embed', {}), n('s', 'source', { sourceType: 'txt', text: 'x' }), n('o', 'output')],
  [e('i', 'e'), e('e', 's'), e('s', 'o')])).problems, [])
check('text Source needs no Embed', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }), n('o', 'output')],
  [e('i', 's'), e('s', 'o')])).problems, [])

console.log('\n--- source properties ---')
check('no sources picked', resolve(g(
  [n('i', 'input'), n('e', 'embed', { model: 'm' }),
   n('s', 'source', { sourceType: 'files', sourceIds: [] }), n('o', 'output')],
  [e('i', 'e'), e('e', 's'), e('s', 'o')])).problems,
  ['1 connected Source widget has no sources picked.'])
check('several sources accepted', resolve(g(
  [n('i', 'input'), n('e', 'embed', { model: 'm' }),
   n('s', 'source', { sourceType: 'files', sourceIds: ['A', 'B', 'C'], docs: 20 }), n('o', 'output')],
  [e('i', 'e'), e('e', 's'), e('s', 'o')])).problems, [])
check('empty text Source', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: '  ' }), n('o', 'output')],
  [e('i', 's'), e('s', 'o')])).problems, ['A text Source widget is empty.'])

console.log('\n--- reranker ---')
check('Reranker with no model', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }), n('r', 'reranker', {}), n('o', 'output')],
  [e('i', 's'), e('s', 'r'), e('r', 'o')])).problems, ['The Reranker widget names no model.'])

console.log('\n--- agents and duplicates ---')
r = resolve(g([n('i', 'input'), n('a', 'agent', { flow: 'triage.flow' }), n('o', 'output')],
  [e('i', 'a'), e('a', 'o')]))
check('agent alone can feed the output', r.problems, [])
check('reports the flow it calls', r.calls, ['triage.flow'])
check('agent with no flow', resolve(g(
  [n('i', 'input'), n('a', 'agent', {}), n('o', 'output')], [e('i', 'a'), e('a', 'o')])).problems,
  ['An Agent widget names no flow to run.'])
check('two Rerankers flagged', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }),
   n('r1', 'reranker', { model: 'm' }), n('r2', 'reranker', { model: 'm' }), n('o', 'output')],
  [e('i', 's'), e('s', 'r1'), e('s', 'r2'), e('r1', 'o'), e('r2', 'o')])).problems[0],
  'This flow has 2 Reranker widgets; it may have one.')

console.log('\n--- router ---')
const ROUTES = [{ id: 'a', label: 'Clinical', when: 'patient care' },
                { id: 'b', label: 'General', when: 'anything else' }]
const routed = (edges) => g(
  [n('i', 'input'), n('r', 'router', { routes: ROUTES }),
   n('x', 'source', { sourceType: 'txt', text: 'x' }),
   n('y', 'source', { sourceType: 'txt', text: 'y' }), n('o', 'output')], edges)
const wired = [e('i', 'r'), { ...e('r', 'x'), sourceHandle: 'a' },
               { ...e('r', 'y'), sourceHandle: 'b' }, e('x', 'o'), e('y', 'o')]
check('a fully wired router is fine', resolve(routed(wired)).problems, [])
check('one route flagged', resolve(g(
  [n('i', 'input'), n('r', 'router', { routes: [ROUTES[0]] }),
   n('x', 'source', { sourceType: 'txt', text: 'x' }), n('o', 'output')],
  [e('i', 'r'), { ...e('r', 'x'), sourceHandle: 'a' }, e('x', 'o')])).problems,
  ['A Router needs at least two routes — with one there is nothing to decide.'])
check('route with no condition flagged', resolve(g(
  [n('i', 'input'), n('r', 'router', { routes: [{ id: 'a', label: 'A', when: '' }, ROUTES[1]] }),
   n('x', 'source', { sourceType: 'txt', text: 'x' }),
   n('y', 'source', { sourceType: 'txt', text: 'y' }), n('o', 'output')],
  [e('i', 'r'), { ...e('r', 'x'), sourceHandle: 'a' }, { ...e('r', 'y'), sourceHandle: 'b' },
   e('x', 'o'), e('y', 'o')])).problems,
  ['A route on a Router does not say when to take it.'])
check('unwired route flagged', resolve(routed(
  [e('i', 'r'), { ...e('r', 'x'), sourceHandle: 'a' }, e('x', 'o')])).problems,
  ['Route General on a Router leads nowhere.'])

console.log('\n--- unwired widgets and cycles ---')
r = resolve(g([n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }),
               n('orphan', 'source', { sourceType: 'files', sourceIds: [] }), n('o', 'output')],
  [e('i', 's'), e('s', 'o')]))
check('orphan excluded', r.reachable.has('orphan'), false)
check('orphan raises no problem', r.problems, [])
check('cycle terminates', resolve(g(
  [n('i', 'input'), n('s', 'source', { sourceType: 'txt', text: 'x' }), n('a', 'agent', { flow: 'x.flow' }), n('o', 'output')],
  [e('i', 's'), e('s', 'a'), e('a', 's'), e('a', 'o')])).problems, [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
