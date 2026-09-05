import { chromium } from 'playwright'
import { stubBackend } from './fixtures.mjs'
let fails = 0
const check = (name, ok, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })
await stubBackend(page)
await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const canvas = page.locator('.react-flow__pane')
const nodes = () => page.locator('.react-flow__node').count()
const edges = () => page.locator('.react-flow__edge').count()

console.log('\n--- widget drag from right rail ---')
for (const label of ['Output', 'Reranker', 'System message']) {
  const b = await nodes()
  await page.locator(`[aria-label="${label}"]`).dragTo(canvas)
  await page.waitForTimeout(350)
  check(`drag "${label}"`, (await nodes()) === b + 1, `${b} -> ${await nodes()}`)
}

console.log('\n--- nodes are actually visible ---')
const first = page.locator('.react-flow__node').first()
const vis = await first.evaluate((el) => getComputedStyle(el).visibility)
check('node visibility is visible', vis === 'visible', `visibility=${vis}`)
check('node has readable text', (await first.innerText()).trim().length > 0,
  JSON.stringify((await first.innerText()).replace(/\n/g, ' ')))
check('node is on screen', await first.isVisible())

console.log('\n--- wiring nodes together ---')
const e0 = await edges()
const from = await page.locator('.react-flow__handle-bottom').first().boundingBox()
const to = await page.locator('.react-flow__handle-top').first().boundingBox()
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
await page.mouse.down()
await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 })
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
await page.mouse.up()
await page.waitForTimeout(400)
check('handle drag creates an edge', (await edges()) > e0, `${e0} -> ${await edges()}`)

console.log('\n--- limits & click-add ---')
const b3 = await nodes()
await page.locator('[aria-label="Output"]').dragTo(canvas)
await page.waitForTimeout(300)
check('second Output refused', (await nodes()) === b3, `${b3} -> ${await nodes()}`)
await page.locator('[aria-label="Source"]').click()
await page.waitForTimeout(300)
check('click adds a node', (await nodes()) === b3 + 1, `${b3} -> ${await nodes()}`)

console.log('\n--- moving a node ---')
// On a fresh page, so no later node can be sitting over the one being grabbed.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('[aria-label="Output"]').dragTo(canvas, { targetPosition: { x: 500, y: 400 } })
await page.waitForTimeout(500)
const solo = page.locator('.react-flow__node').first()
const box = await solo.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 6)
}
await page.mouse.up()
await page.waitForTimeout(400)
const moved = await solo.boundingBox()
check('node can be dragged on canvas', Math.abs(moved.x - box.x) > 20, `dx=${Math.round(moved.x - box.x)}`)

await page.screenshot({ path: 'tests/last-run.png' })
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
