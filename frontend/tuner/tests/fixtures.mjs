/**
 * A fixed source list, served to the page instead of the real backend.
 *
 * The UI tests are about the canvas, not about what happens to be in Postgres.
 * Stubbing `/api/sources` keeps them repeatable on any machine and stops them
 * failing the moment someone deletes a source.
 */
export const SOURCES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Fixture Corpus',
    description: 'stubbed for tests',
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    documents: [
      { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'alpha.pdf', size: 1234,
        kind: 'pdf', status: 'ready', chunks: 12, addedAt: '2026-01-01T00:00:00Z' },
      { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'beta.txt', size: 900,
        kind: 'txt', status: 'ready', chunks: 7, addedAt: '2026-01-01T00:00:00Z' },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Empty Corpus',
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    documents: [],
  },
]

/** Total vectors in the first fixture, as the file tree renders it. */
export const FIXTURE_VECTORS = 19

export async function stubBackend(page) {
  await page.route('**/api/sources', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SOURCES) }),
  )
  await page.route('**/api/workflows', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ name: 'Fixture workflow', flows: 2, updatedAt: '2026-01-01T00:00:00Z' }]),
    }),
  )
  await page.route('**/api/workflows/*/flows', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { name: 'main.flow', size: 33, updatedAt: '2026-01-01T00:00:00Z', isMain: true },
        { name: 'triage.flow', size: 120, updatedAt: '2026-01-01T00:00:00Z', isMain: false },
      ]),
    }),
  )
  // The editor reads whichever flow is open; both start empty.
  await page.route('**/api/workflows/*/flows/*', (route) => {
    const name = decodeURIComponent(route.request().url().split('/').pop())
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ name, size: 33, updatedAt: '2026-01-01T00:00:00Z', isMain: name === 'main.flow' }) })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ name, isMain: name === 'main.flow', graph: { nodes: [], edges: [] } }),
    })
  })
}
