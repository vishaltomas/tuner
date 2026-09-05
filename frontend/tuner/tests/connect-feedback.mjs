import { chromium } from 'playwright'
import { stubBackend } from './fixtures.mjs'
let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? '  PASS' : '  FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e))
await stubBackend(page)
await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
for (const l of ['Source', 'System message', 'Reranker', 'Output']) {
  await page.locator(`[aria-label="${l}"]`).click(); await page.waitForTimeout(180)
}
await page.waitForTimeout(500)

const node = (t) => page.locator(`.react-flow__node:has-text("${t}")`)

/**
 * Start a wire from `from`, hold the pointer over `over`, report what shows.
 *
 * `landOn` picks where the wire is released: the target's input handle, which
 * is the gesture that actually connects, or its body, which is only a hover.
 */
async function hoverWhileConnecting(from, over, landOn = 'body') {
  const a = await node(from).locator('.react-flow__handle-bottom').boundingBox()
  const target = landOn === 'handle'
    ? await node(over).locator('.react-flow__handle-top').boundingBox()
    : await node(over).boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 6, a.y + 22, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 })
  await page.waitForTimeout(450)
  const tip = await page.locator('.MuiTooltip-tooltip').innerText().catch(() => '')
  const border = await node(over).locator('> div').first()
    .evaluate((el) => getComputedStyle(el).borderColor).catch(() => '')
  const body = (await node(over).innerText()).replace(/\n/g, ' ')
  await page.mouse.up()
  await page.waitForTimeout(250)
  return { tip: tip.trim(), border, body }
}

/** error.main is #c02626 in the light theme. */
const ERROR_RED = 'rgb(192, 38, 38)'

console.log('\n--- hovering an invalid target mid-connection ---')
let r = await hoverWhileConnecting('Source', 'System message')
check('tooltip explains the refusal', r.tip.includes('does not take an input'), JSON.stringify(r.tip))
check('node body shows the reason', r.body.includes('does not take an input'), JSON.stringify(r.body))
check('node border turns error red', r.border === ERROR_RED, r.border)
check('no edge was created', (await page.locator('.react-flow__edge').count()) === 0)

console.log('\n--- hovering a valid target mid-connection ---')
r = await hoverWhileConnecting('Source', 'Reranker', 'handle')
check('no refusal tooltip on a valid target', r.tip === '', JSON.stringify(r.tip))
check('valid drop created the edge', (await page.locator('.react-flow__edge').count()) === 1)

console.log('\n--- duplicate wire ---')
r = await hoverWhileConnecting('Source', 'Reranker', 'handle')
check('duplicate is refused with a reason', r.body.includes('Already wired'), JSON.stringify(r.body))
check('still just one edge', (await page.locator('.react-flow__edge').count()) === 1)

console.log('\n--- message clears when not connecting ---')
await page.mouse.move(800, 880)
await page.waitForTimeout(400)
const idle = (await node('System message').innerText()).replace(/\n/g, ' ')
check('idle node shows its summary again', !idle.includes('does not take an input'), JSON.stringify(idle))

await page.screenshot({ path: 'tests/connect-feedback.png' })
console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
