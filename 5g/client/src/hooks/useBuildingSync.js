/**
 * src/hooks/useBuildingSync.js
 *
 * Custom React hook — the only bridge between the UI slider and Docker.
 *
 * When buildingCount changes in HomePage, this hook:
 *   1. Waits debounceMs (default 500ms) for the slider to settle
 *   2. Cancels any previous in-flight request (AbortController)
 *   3. POSTs the new count to /api/buildings
 *      → handled by src/setupProxy.js (CRA dev-server middleware)
 *      → writes ./state/buildings.txt
 *      → scale_network.sh --watch detects the change and scales Docker
 *
 * Returns a status object for the UI sync badge in the header.
 *
 * @example
 *   const { status, lastSynced } = useBuildingSync(buildingCount)
 */

import { useEffect, useRef, useState } from 'react'

/**
 * @param {number} buildingCount   — live value from HomePage useState
 * @param {object} options
 * @param {number} options.debounceMs    — ms to wait after last slider move (default 500)
 * @param {string} options.endpoint      — route handled by setupProxy.js (default /api/buildings)
 * @param {number} options.maxBuildings  — ceiling clamped before sending (default 20)
 *
 * @returns {{ status: 'idle'|'syncing'|'synced'|'error', lastSynced: number|null, error: string|null }}
 */
export function useBuildingSync(buildingCount, {
  debounceMs    = 500,
  endpoint      = '/api/buildings',   // relative → resolves to http://localhost:3000/api/buildings
  maxBuildings  = 20,
} = {}) {
  const [status,     setStatus]     = useState('idle')   // idle | syncing | synced | error
  const [lastSynced, setLastSynced] = useState(null)
  const [error,      setError]      = useState(null)

  const abortRef = useRef(null)   // cancel previous POST when slider moves again
  const timerRef = useRef(null)   // debounce timer

  useEffect(() => {
    clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      // Cancel any previous in-flight fetch
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()

      // Clamp locally so the UI badge updates without waiting for a round-trip
      const clamped = Math.min(maxBuildings, Math.max(0, Math.round(buildingCount)))

      setStatus('syncing')
      setError(null)

      try {
        const res = await fetch(endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ buildings: clamped }),
          signal:  abortRef.current.signal,
        })

        if (!res.ok) {
          const text = await res.text().catch(() => `HTTP ${res.status}`)
          throw new Error(text)
        }

        setStatus('synced')
        setLastSynced(clamped)
        setError(null)
      } catch (err) {
        // AbortError = intentionally cancelled because slider moved again — ignore
        if (err.name === 'AbortError') return

        console.warn('[useBuildingSync] POST failed:', err.message)
        setStatus('error')
        setError(err.message)
      }
    }, debounceMs)

    // Clean up timer if buildingCount changes again before the delay fires
    return () => clearTimeout(timerRef.current)
  }, [buildingCount, debounceMs, endpoint, maxBuildings])

  // Clean up on component unmount
  useEffect(() => () => {
    clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
  }, [])

  return { status, lastSynced, error }
}