import { chromium } from 'playwright'
import { stubBackend } from './fixtures.mjs'

/** Removing a wire: by its button, by Delete, and by Backspace. */
let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)))
await stubBackend(page)
await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const edges = () => page.locator('.react-flow__edge').count()
const nodes = () => page.locator('.react-flow__node').count()
const selectedEdges = () => page.locator('.react-flow__edge.selected').count()
const removeButton = page.getByRole('button', { name: 'Remove this wire' })

async function wire() {
  const from = await page.locator('.react-flow__node:has-text("Source") .react-flow__handle-bottom').boundingBox()
  const to = await page.locator('.react-flow__node:has-text("Output") .react-flow__handle-top').boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 6, from.y + 24, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(600)
}

/**
 * A point a given fraction along the wire, in viewport coordinates.
 *
 * Not the centre of the path's bounding box: a bezier does not pass through
 * its own bbox centre, so clicking there hits the canvas — or, worse, a node
 * lying under it, which Delete then removes while the test reads the missing
 * edge as a pass. This asks the path itself where it goes.
 */
const pointOnWire = (fraction) =>
  page.evaluate((f) => {
    const path = document.querySelector('.react-flow__edge-path')
    const point = path.getPointAtLength(path.getTotalLength() * f)
    const m = path.getScreenCTM()
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f }
  }, fraction)

/** Select a wire away from its midpoint, where the remove button sits. */
async function clickWire() {
  await page.mouse.click(1100, 830) // the empty canvas, so nothing else is selected
  await page.waitForTimeout(300)
  const at = await pointOnWire(0.15)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(400)
}

await page.locator('[aria-label="Source"]').click(); await page.waitForTimeout(400)
await page.locator('[aria-label="Output"]').click(); await page.waitForTimeout(700)
await wire()
check('a wire exists to remove', (await edges()) === 1)
check('two widgets to begin with', (await nodes()) === 2)

console.log('--- the button on the wire ---')
check('no button before hovering', (await removeButton.count()) === 0)
const middle = await pointOnWire(0.5)
await page.mouse.move(middle.x, middle.y)
await page.waitForTimeout(400)
check('hovering reveals a remove button', (await removeButton.count()) === 1)
await removeButton.click()
await page.waitForTimeout(600)
check('clicking it removes the wire', (await edges()) === 0, `${await edges()} edges`)
check('the button goes with it', (await removeButton.count()) === 0)
check('and both widgets stay', (await nodes()) === 2, `${await nodes()} nodes`)

console.log('\n--- the Delete key ---')
await wire()
await clickWire()
check('clicking a wire selects it', (await selectedEdges()) === 1)
check('and deselects the widget', (await page.locator('.react-flow__node.selected').count()) === 0)
await page.keyboard.press('Delete')
await page.waitForTimeout(500)
check('Delete removes the selected wire', (await edges()) === 0, `${await edges()} edges`)
check('and leaves the widgets alone', (await nodes()) === 2, `${await nodes()} nodes`)

console.log('\n--- Backspace still works ---')
await wire()
await clickWire()
await page.keyboard.press('Backspace')
await page.waitForTimeout(500)
check('Backspace removes the selected wire', (await edges()) === 0, `${await edges()} edges`)
check('and leaves the widgets alone', (await nodes()) === 2, `${await nodes()} nodes`)

console.log('\n--- selecting a widget takes Delete back ---')
await wire()
await clickWire()
await page.locator('.react-flow__node:has-text("Output")').click()
await page.waitForTimeout(400)
check('clicking a widget deselects the wire', (await selectedEdges()) === 0)

console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
