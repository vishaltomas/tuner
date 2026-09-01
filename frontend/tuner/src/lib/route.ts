import { useSyncExternalStore } from 'react'

/**
 * The two pages this app has.
 *
 * The workflow editor is its own page rather than a pane inside the main
 * shell: it needs the whole viewport for a canvas with a rail either side,
 * and the sidebar and top bar would be taking width from it the entire time.
 */
export type Route = 'app' | 'workflow'

/**
 * Hash routing, hand-rolled.
 *
 * Two pages does not warrant a router: the hash gives a real URL to link and
 * bookmark, and the browser's own back and forward buttons work, which is what
 * "a different page" has to mean to be worth the name. Swap this for a router
 * if a third page ever needs parameters of its own.
 */
export function currentRoute(): Route {
  return window.location.hash.replace(/^#\/?/, '') === 'workflow' ? 'workflow' : 'app'
}

export function navigate(route: Route): void {
  window.location.hash = route === 'workflow' ? '#/workflow' : ''
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, () => 'app' as const)
}
