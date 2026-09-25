import { getConfig } from '../api/client'
import { Modal } from './ui'
import { useAsync } from '../hooks/useAsync'

/** Live ingestion endpoints: where devices point syslog / HTTP REST so
 *  their logs stream into the pipeline (and the Live Logs tail). */
export function ConnectLiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useAsync(() => getConfig(), [])
  const c = config.data
  const origin = window.location.origin

  return (
    <Modal open={open} title="Live Log Ingestion" onClose={onClose} width="max-w-2xl">
      <p className="mb-5 text-[13px] leading-relaxed text-slate-400">
        Direct live device logs to the framework exactly once. The ingestion pipeline matches events to configured sources autonomously using vector fingerprinting.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-300">Syslog (UDP)</h4>
            <span className={`h-2 w-2 rounded-full ${c?.syslog_enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
          </div>
          {c?.syslog_enabled ? (
            <>
              <p className="text-[12px] text-slate-400 mb-2">Endpoint address:</p>
              <div className="flex items-center gap-2 rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[13px] text-emerald-400 select-all">
                {c.syslog_udp_host}:{c.syslog_udp_port}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-slate-500 italic">Syslog daemon disabled in Configuration spec.</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-slate-300">HTTP REST</h4>
          <p className="text-[12px] text-slate-400 mb-2">POST payload to:</p>
          <div className="flex items-center gap-2 rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[13px] text-cyan-400 select-all truncate">
            {origin}/api/v1/ingest
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Requires <code className="bg-slate-900 px-1 rounded">raw</code> and <code className="bg-slate-900 px-1 rounded">source</code> form payload.
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end pt-4 border-t border-slate-800">
        <button onClick={onClose} className="text-[13px] font-medium text-slate-400 hover:text-white transition-colors">Close panel</button>
      </div>
    </Modal>
  )
}
