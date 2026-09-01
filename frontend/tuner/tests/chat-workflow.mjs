import { chromium } from 'playwright'
let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e))
let posted = null
await page.route('**/api/chat', async (route) => {
  if (route.request().method() === 'POST') posted = route.request().postDataJSON()
  await route.continue()
})
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Chat' }).click()
await page.waitForTimeout(1400)

const body = () => page.locator('body').innerText()
const picker = page.getByRole('combobox', { name: 'Answering with' })
check('Chat has a workflow picker', await picker.count() === 1)

await picker.click()
await page.waitForTimeout(500)
const options = await page.getByRole('option').allInnerTexts()
check('workflow names are listed', options.some((o) => o.includes('My workflow')), options.join(' | '))
await page.getByRole('option', { name: 'My workflow' }).click()
await page.waitForTimeout(900)
check('picked workflow shown in the header', (await body()).includes('My workflow'))
check('manual source picker hidden', !(await body()).includes('Pick the knowledge base to answer from.'))

await page.getByLabel('Message').fill('What tidal volume is recommended for ARDS?')
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
check('posts the workflow name', posted?.workflow === 'My workflow', JSON.stringify(posted))
check('use_flow set', posted?.use_flow === true)
check('no client-side source expansion', posted?.source_ids?.length === 0)

await page.waitForFunction(() => !document.body.innerText.includes('Retrieving passages'), null, { timeout: 240000 })
await page.waitForTimeout(700)
const text = await body()
const answered = text.includes('passages retrieved')
const credits = text.includes('out of inference credit')
check('chat reached the backend', answered || credits, credits ? 'HF credits exhausted (reached the model)' : 'answered')
await page.screenshot({ path: 'chat-wf.png' })

await picker.click(); await page.waitForTimeout(400)
await page.getByRole('option', { name: 'None — set sources by hand' }).click()
await page.waitForTimeout(800)
check('unpicking restores the manual rail', (await body()).includes('Pick the knowledge base to answer from.'))

console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
