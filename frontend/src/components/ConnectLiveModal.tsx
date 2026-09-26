import { getConfig } from '../api/client'
import { Modal } from './ui'
import { useAsync } from '../hooks/useAsync'

export function ConnectLiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useAsync(() => getConfig(), [])
  const c = config.data
  const origin = window.location.origin

  function copy(text: string) {
    navigator.clipboard.writeText(text)
  }

  return (
    <Modal open={open} title="Live Log Ingestion" onClose={onClose} width="max-w-2xl">
      <p className="mb-5 text-body-md leading-relaxed text-on-surface-variant">
        Direct live device logs to the framework exactly once. The ingestion pipeline matches events to configured sources autonomously using vector fingerprinting.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="surface-panel rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-label-lg font-semibold text-on-surface">Syslog (UDP)</h4>
            <span className={`h-2 w-2 rounded-full ${c?.syslog_enabled ? 'bg-success animate-pulse' : 'bg-on-surface-variant/30'}`}></span>
          </div>
          {c?.syslog_enabled ? (
            <>
              <p className="mb-2 text-body-sm text-on-surface-variant">Endpoint address:</p>
              <div className="flex items-center gap-2 surface-inset rounded-xl px-3 py-2 font-mono text-body-sm text-success">
                {c.syslog_udp_host}:{c.syslog_udp_port}
                <button
                  onClick={() => copy(`${c.syslog_udp_host}:${c.syslog_udp_port}`)}
                  className="ml-auto control-icon h-8 w-8"
                  aria-label="Copy address"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg>
                </button>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-on-surface-variant/60 italic">Syslog daemon disabled in Configuration spec.</p>
          )}
        </section>

        <section className="surface-panel rounded-xl p-4">
          <h4 className="mb-3 text-label-lg font-semibold text-on-surface">HTTP REST</h4>
          <p className="mb-2 text-body-sm text-on-surface-variant">POST payload to:</p>
          <div className="flex items-center gap-2 surface-inset rounded-xl px-3 py-2 font-mono text-body-sm text-primary truncate">
            {origin}/api/v1/ingest
            <button
              onClick={() => copy(`${origin}/api/v1/ingest`)}
              className="ml-auto control-icon h-8 w-8"
              aria-label="Copy endpoint"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg>
            </button>
          </div>
          <p className="mt-3 text-label-sm text-on-surface-variant/70">
            Requires <code className="surface-inset rounded px-1 px-1.5 font-mono text-label-sm text-on-surface">raw</code> and <code className="surface-inset rounded px-1 px-1.5 font-mono text-label-sm text-on-surface">source</code> form payload.
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end pt-4 border-t border-outline-variant/50">
        <button onClick={onClose} className="btn-text text-label-sm">
          Close panel
        </button>
      </div>
    </Modal>
  )
}