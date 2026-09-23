import { useEffect, useRef, useState } from 'react'

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
}

function wsUrl(source?: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${window.location.host}/api/v1/ws/live`
  return source ? `${url}?source=${encodeURIComponent(source)}` : url
}

/** Live event stream over the backend WebSocket, with reconnect + heartbeat skip. */
export function useLive({ source, enabled = true, onEvent }: UseLiveOptions) {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
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
      try {
        socket = new WebSocket(wsUrl(source))
      } catch {
        schedule()
        return
      }
      socket.onopen = () => {
        setConnected(true)
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
        socket?.close()
      }
    }

    function schedule() {
      if (closed) return
      retries += 1
      timer = setTimeout(connect, Math.min(1000 * 2 ** retries, 15000))
    }

    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [source, enabled])

  return { connected, lastEvent }
}
