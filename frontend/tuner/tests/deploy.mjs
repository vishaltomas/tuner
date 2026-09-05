import { chromium } from 'playwright'

/**
 * Packaging a workflow, against the real backend.
 *
 * Not stubbed: the export copies files and writes a SQLite database, and a
 * stub would only prove the dialog renders. The build itself is skipped —
 * there is no Docker daemon here, and the point under test is the context.
 */
let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)))
await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const body = () => page.locator('body').innerText()

console.log('--- the toolbar offers it ---')
check('Deploy button', (await page.getByRole('button', { name: 'Deploy' }).count()) === 1)
await page.getByRole('button', { name: 'Deploy' }).click()
await page.waitForTimeout(700)
check('dialog explains what goes in', (await body()).includes('needs no database'))
check('building is opt-out', await page.getByRole('switch').isChecked())

console.log('--- exporting (build off; no daemon here) ---')
await page.getByRole('switch').click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Deploy', exact: true }).last().click()
await page.waitForFunction(
  () => document.body.innerText.includes('Context ready')
     || document.body.innerText.includes('Image built')
     || document.body.innerText.includes('Could not package'),
  null,
  { timeout: 600000 },
)
await page.waitForTimeout(500)
const text = await body()
check('reported a ready context', text.includes('Context ready'), (text.match(/Context ready|Image built|Could not package/) || [])[0])
check('counts what went in', /\d+ flows/.test(text) && /passages/.test(text),
  (text.match(/\d+ flows[^\n]*/) || [''])[0])
check('shows the build command', text.includes('docker build -t tuner-my-workflow'))
check('shows the run command', text.includes('docker run --rm -p 8080:8080'))
check('shows how to ask it', text.includes('/ask'))
check('warns the vectors are a snapshot', text.includes('snapshot'))
await page.screenshot({ path: 'deploy.png' })

console.log('--- copy buttons ---')
check('run command is copyable', (await page.getByLabel(/^Copy:/).count()) >= 1)

console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
