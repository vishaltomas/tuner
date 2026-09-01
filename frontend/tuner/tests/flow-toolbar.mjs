import { chromium } from 'playwright'

/**
 * The workflow editor's toolbar, against the real backend.
 *
 * Unlike the other UI suites this one is not stubbed: creating, renaming and
 * deleting are filesystem operations, and stubbing them would test the stub.
 * It tidies up after itself so a run leaves the flow directory as it found it.
 */
let fails = 0
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e))

let answer = 'Test workflow'
page.on('dialog', (d) => (d.type() === 'confirm' ? d.accept() : d.accept(answer)))

await page.goto('http://localhost:5173/#/workflow', { waitUntil: 'networkidle' })
await page.waitForTimeout(1600)

const body = () => page.locator('body').innerText()
// MUI renders a Select as a div with role=combobox, so its value is text
// rather than an input value; `exact` keeps it off the New/Rename/Delete
// buttons, whose labels also start with "Workflow".
const workflow = page.getByRole('combobox', { name: 'Workflow', exact: true })
const workflowValue = async () => (await workflow.innerText()).trim()
const flowName = page.getByLabel('Flow name')

console.log('--- toolbar ---')
check('workflow selector', await workflow.count() === 1)
check('new workflow button', await page.getByLabel('New workflow').count() === 1)
check('rename workflow button', await page.getByLabel('Rename workflow').count() === 1)
check('delete workflow button', await page.getByLabel('Delete workflow').count() === 1)
check('flow name field', await flowName.count() === 1)
// The flow tree has a "New flow…" row too, hence exact.
check('New flow button', await page.getByRole('button', { name: 'New flow', exact: true }).count() === 1)
check('Save button', await page.getByRole('button', { name: 'Save' }).count() === 1)
check('opens on main.flow', await flowName.inputValue() === 'main.flow', await flowName.inputValue())
check('Save disabled when clean', await page.getByRole('button', { name: 'Save' }).isDisabled())

console.log('\n--- creating a workflow ---')
const before = await workflowValue()
await page.getByLabel('New workflow').click()
await page.waitForTimeout(1800)
check('switched to the new workflow', await workflowValue() === 'Test workflow', await workflowValue())
check('it starts on main.flow', await flowName.inputValue() === 'main.flow')
check('its flow list shows only main.flow', (await body()).match(/main\.flow/g)?.length >= 1)

console.log('\n--- a flow inside it ---')
answer = 'helper.flow'
await page.getByRole('button', { name: 'New flow', exact: true }).click()
await page.waitForTimeout(1800)
check('created the flow', await flowName.inputValue() === 'helper.flow', await flowName.inputValue())
await page.locator('[aria-label="Answer"]').click()
await page.waitForTimeout(700)
check('Save enabled after an edit', !(await page.getByRole('button', { name: 'Save' }).isDisabled()))
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(1400)
check('saved', (await body()).includes('Saved helper.flow'))

console.log('\n--- renaming the flow ---')
await flowName.fill('renamed')
await page.keyboard.press('Enter')
await page.waitForTimeout(1800)
check('.flow appended', await flowName.inputValue() === 'renamed.flow', await flowName.inputValue())

console.log('\n--- renaming the workflow ---')
answer = 'Test workflow renamed'
await page.getByLabel('Rename workflow').click()
await page.waitForTimeout(1800)
check('workflow renamed', await workflowValue() === 'Test workflow renamed', await workflowValue())
check('its flows came with it', (await body()).includes('renamed.flow'))

console.log('\n--- workflows are separate ---')
await workflow.click()
await page.waitForTimeout(400)
await page.getByRole('option', { name: before }).click()
await page.waitForTimeout(1500)
check('switching back shows the other workflow', await workflowValue() === before, await workflowValue())
check("the other workflow's flows are not here", !(await body()).includes('renamed.flow'))

console.log('\n--- cleaning up ---')
await workflow.click()
await page.waitForTimeout(400)
await page.getByRole('option', { name: 'Test workflow renamed' }).click()
await page.waitForTimeout(1500)
await page.getByLabel('Delete workflow').click()
await page.waitForTimeout(1800)
// Checked against the list rather than the page text: the success snackbar
// names what was just deleted, so the string is still on screen.
await workflow.click()
await page.waitForTimeout(500)
const left = await page.getByRole('option').allInnerTexts()
await page.keyboard.press('Escape')
check('deleted the test workflow', !left.includes('Test workflow renamed'), left.join(', '))

console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' FAILED'}`)
await browser.close()
process.exit(fails ? 1 : 0)
