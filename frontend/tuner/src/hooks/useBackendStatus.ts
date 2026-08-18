import { useSyncExternalStore } from 'react'
import { getBackendStatus, watchBackendStatus } from '../lib/api'

/** Live view of whether the embedding backend is answering. */
export function useBackendStatus() {
  return useSyncExternalStore(watchBackendStatus, getBackendStatus, () => 'checking' as const)
}
