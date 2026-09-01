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
const e = (source, target) => ({ id: `${source}->${target}`, source, target })

// a complete flow
let g = {
  nodes: [n('s1','source',{sourceType:'files',sourceId:'A'}), n('sys','system',{system:'terse'}),
          n('r','retrieval',{topK:15}), n('a','answer')],
  edges: [e('s1','r'), e('r','a'), e('sys','a')],
}
check('complete flow has no problems', resolve(g).problems, [])

// unwired widgets are ignored
g = { nodes: [n('s1','source',{sourceType:'files',sourceId:'A'}), n('s2','source',{sourceType:'files'}), n('a','answer')],
      edges: [e('s1','a')] }
let r = resolve(g)
check('unwired widget not reachable', r.reachable.has('s2'), false)
check('unwired widget raises no problem', r.problems, [])

check('missing answer flagged', resolve({ nodes: [n('s','source')], edges: [] }).problems,
  ['Add an Answer widget — it is where the conversation happens.'])
check('nothing feeding answer flagged', resolve({ nodes: [n('a','answer')], edges: [] }).problems,
  ['Wire a Source or an Agent widget through to the Answer widget.'])

// source types
g = { nodes: [n('s','source',{sourceType:'files'}), n('a','answer')], edges: [e('s','a')] }
check('files source with nothing picked', resolve(g).problems, ['1 connected Source widget has no source picked.'])
g = { nodes: [n('s','source',{sourceType:'txt',text:'  '}), n('a','answer')], edges: [e('s','a')] }
check('empty text source flagged', resolve(g).problems, ['A text Source widget is empty.'])
g = { nodes: [n('s','source',{sourceType:'txt',text:'hello'}), n('a','answer')], edges: [e('s','a')] }
check('filled text source is fine', resolve(g).problems, [])
g = { nodes: [n('s','source',{sourceType:'chat'}), n('a','answer')], edges: [e('s','a')] }
check('chat source needs no config', resolve(g).problems, [])

// agent widgets
g = { nodes: [n('g','agent',{flow:'triage.flow'}), n('a','answer')], edges: [e('g','a')] }
r = resolve(g)
check('agent alone can feed the answer', r.problems, [])
check('agent reports the flow it calls', r.calls, ['triage.flow'])
g = { nodes: [n('g','agent',{}), n('a','answer')], edges: [e('g','a')] }
check('agent with no flow flagged', resolve(g).problems, ['An Agent widget names no flow to run.'])
g = { nodes: [n('g','agent',{flow:'x.flow'}), n('a','answer')], edges: [] }
check('unwired agent is not called', resolve(g).calls, [])

// duplicates
g = { nodes: [n('s','source',{sourceType:'chat'}), n('r1','retrieval'), n('r2','retrieval'), n('a','answer')],
      edges: [e('s','a'), e('r1','a'), e('r2','a')] }
check('two retrieval widgets flagged', resolve(g).problems[0], 'This flow has 2 Retrieval widgets; it may have one.')

// a cycle must not hang
g = { nodes: [n('x','source',{sourceType:'chat'}), n('y','retrieval'), n('a','answer')],
      edges: [e('x','y'), e('y','x'), e('y','a')] }
check('cycle terminates', resolve(g).problems, [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
