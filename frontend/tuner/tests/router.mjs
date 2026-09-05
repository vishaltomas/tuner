import { chromium } from 'playwright'
import { stubBackend } from './fixtures.mjs'

let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 220)))
await stubBackend(page)
await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const body = () => page.locator('body').innerText()

console.log('--- the rail offers a Router ---')
check('Router in the rail', (await page.locator('[aria-label="Router"]').count()) === 1)

await page.locator('[aria-label="Router"]').click()
await page.waitForTimeout(900)
const node = page.locator('.react-flow__node:has-text("Router")').first()
check('added to the canvas', (await node.count()) === 1)
check('starts with two routes', (await node.innerText()).includes('2 routes'), (await node.innerText()).replace(/\n/g, ' '))
check('an output per route', (await node.locator('.react-flow__handle-bottom').count()) === 2,
  `${await node.locator('.react-flow__handle-bottom').count()} handles`)
check('routes are named on the node', (await node.innerText()).includes('First') && (await node.innerText()).includes('Otherwise'))

console.log('\n--- the inspector edits the routes ---')
const inspector = await body()
check('deciding model field', inspector.includes('Deciding model'))
check('route conditions are editable', inspector.includes('When to take it'))
check('warns that a route has no condition yet',
  (await node.locator('[data-testid="WarningAmberOutlinedIcon"]').count()) === 1,
  (await node.innerText()).replace(/\n/g, ' '))

await page.getByRole('textbox', { name: 'Route 1', exact: true }).fill('Clinical')
await page.waitForTimeout(300)
const whens = page.getByLabel('When to take it')
await whens.first().fill('patient care, drugs or ventilation')
await page.waitForTimeout(400)
check('renaming a route renames its output', (await node.innerText()).includes('Clinical'),
  (await node.innerText()).replace(/\n/g, ' '))

await page.getByRole('button', { name: 'Add route' }).click()
await page.waitForTimeout(600)
check('adding a route adds an output', (await node.locator('.react-flow__handle-bottom').count()) === 3,
  `${await node.locator('.react-flow__handle-bottom').count()} handles`)
await page.locator('[aria-label="Remove route 3"]').click()
await page.waitForTimeout(600)
check('removing a route removes its output', (await node.locator('.react-flow__handle-bottom').count()) === 2)
check('the last two routes cannot be removed',
  await page.locator('[aria-label="Remove route 1"]').isDisabled())

console.log('\n--- wiring a route ---')
await page.locator('[aria-label="Output"]').click()
await page.waitForTimeout(800)
const out = page.locator('.react-flow__node:has-text("Output")').first()
const from = await node.locator('.react-flow__handle-bottom').first().boundingBox()
const to = await out.locator('.react-flow__handle-top').boundingBox()
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
await page.mouse.down()
await page.mouse.move(from.x + 6, from.y + 24, { steps: 4 })
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(700)
check('a route wires to a widget', (await page.locator('.react-flow__edge').count()) === 1,
  `${await page.locator('.react-flow__edge').count()} edges`)

console.log('\n--- a route leads to one place ---')
const from2 = await node.locator('.react-flow__handle-bottom').first().boundingBox()
await page.mouse.move(from2.x + from2.width / 2, from2.y + from2.height / 2)
await page.mouse.down()
await page.mouse.move(from2.x + 6, from2.y + 24, { steps: 4 })
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 })
await page.waitForTimeout(500)
const refusal = (await out.innerText()).replace(/\n/g, ' ')
await page.mouse.up()
await page.waitForTimeout(400)
check('a second wire from the same route is refused', refusal.includes('Already wired'), refusal)
check('still one edge', (await page.locator('.react-flow__edge').count()) === 1)

console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
