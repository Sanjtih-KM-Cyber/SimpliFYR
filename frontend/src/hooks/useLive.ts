import { useEffect, useRef, useState } from 'react'
import { getHealth, wsBase } from '../api/client'

export interface LiveEvent {
  event_id: string
  source: string | null
  status: string
  received_at: string
  environment: string
}

interface UseLiveOptions {
  source?: string
  enabled?: boolean
  onEvent?: (msg: LiveEvent) => void
  /** Give up after this many consecutive failures (polling fallbacks cover data). */
  maxRetries?: number
}

function wsUrl(source?: string): string {
  const url = `${wsBase()}/ws/live`
  return source ? `${url}?source=${encodeURIComponent(source)}` : url
}

/** Live event stream over the backend WebSocket, with reconnect + heartbeat skip.
 *
 * Retries are capped (default 8, ~2 min of backoff): when the backend is down
 * or restarting, the hook stops hammering it instead of flooding the console
 * with handshake errors. Pages already poll as a fallback, and remounting
 * (navigation) starts a fresh retry budget.
 */
export function useLive({ source, enabled = true, onEvent, maxRetries = 8 }: UseLiveOptions) {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
  const [dead, setDead] = useState(false)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled) return
    let socket: WebSocket | null = null
    let closed = false
    let retries = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (closed) return
      let url: string
      try {
        url = wsUrl(source)
      } catch {
        schedule()
        return
      }
      try {
        socket = new WebSocket(url)
      } catch {
        schedule()
        return
      }
      socket.onopen = () => {
        setConnected(true)
        setDead(false)
        retries = 0
      }
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg?.type === 'ping') return
          if (msg?.event_id) {
            setLastEvent(msg as LiveEvent)
            handler.current?.(msg as LiveEvent)
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      socket.onclose = () => {
        setConnected(false)
        schedule()
      }
      socket.onerror = () => {
        // Handshake failures already surface as onclose; just ensure cleanup.
        // (Deliberately no console noise here — DevTools logs the network
        // error itself, and schedule() caps the retries.)
        try {
          socket?.close()
        } catch {
          /* already gone */
        }
      }
    }

    function schedule() {
      if (closed) return
      retries += 1
      if (retries > maxRetries) {
        setDead(true)
        return
      }
      timer = setTimeout(connect, Math.min(1000 * 2 ** retries, 15000))
    }

    // Health-gate: when the backend is down there is no handshake to
    // attempt — skip socket creation entirely (zero console errors) and
    // report dead. Polling fallbacks keep data fresh; remounting retries.
    getHealth()
      .then(() => {
        if (!closed) connect()
      })
      .catch(() => {
        if (!closed) setDead(true)
      })
    return () => {
      closed = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* already gone */
      }
    }
  }, [source, enabled, maxRetries])

  return { connected, lastEvent, dead }
}
