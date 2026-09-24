import { useEffect, useState } from 'react'
import {
  listConnections,
  listOutputProfiles,
  onboardEvent,
  suggestEventMapping,
} from '../api/client'
import type { EventDetail } from '../api/types'
import { SEMANTIC_FIELDS } from '../api/types'
import { ErrorBanner } from './Status'
import { Modal, useToast } from './ui'
import { useAsync } from '../hooks/useAsync'

interface Row {
  input_field: string
  semantic_field: string
}

/** Give a quarantined event a home: pick (or name) its connection, confirm the
 *  field mapping, publish. Existing connection = new mapping version; new name
 *  = new vendor/source. The event is reprocessed through the new knowledge. */
export function OnboardModal({
  event,
  onClose,
  onDone,
}: {
  event: EventDetail
  onClose: () => void
  onDone: () => void
}) {
  const connections = useAsync(() => listConnections(), [])
  const profiles = useAsync(() => listOutputProfiles(), [])
  const [connection, setConnection] = useState(event.source ?? '')
  const [mappingName, setMappingName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [profileId, setProfileId] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let active = true
    suggestEventMapping(event.id)
      .then((suggestions) => {
        if (!active) return
        setRows(
          suggestions.map((s) => ({
            input_field: s.input_field,
            semantic_field: s.semantic_field,
          })),
        )
        setLoading(false)
      })
      .catch((e: Error) => {
        if (!active) return
        setError(e.message)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [event.id])

  async function submit() {
    const fields = rows.filter((r) => r.input_field.trim() && r.semantic_field.trim())
    if (!connection.trim()) {
      setError('Connection name is required (existing or brand new)')
      return
    }
    if (fields.length === 0) {
      setError('Assign at least one semantic field')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await onboardEvent(event.id, {
        connectionName: connection.trim(),
        mappingName: mappingName.trim() || undefined,
        outputProfileId: profileId ? Number(profileId) : undefined,
        fields,
      })
      toast(`Mapped to ${connection.trim()} (v${res.mapping_version}) — event ${res.event_status}`, 'success')
      onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Onboard event #${event.id}`} onClose={onClose}>
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Name its connection — an existing one creates a new mapping version, a new
        name onboards a new vendor/source. The event is reprocessed immediately.
      </p>
      {error && <ErrorBanner message={error} />}
      <input
        value={connection}
        onChange={(e) => setConnection(e.target.value)}
        placeholder="Connection name (existing or new vendor)"
        list="onboard-connections"
        className="input-glass mb-2 w-full px-3.5 py-2.5 text-sm text-slate-200"
      />
      <datalist id="onboard-connections">
        {(connections.data ?? []).map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <input
        value={mappingName}
        onChange={(e) => setMappingName(e.target.value)}
        placeholder={`Mapping name (defaults to "${connection.trim() || 'Connection'} Mapping")`}
        className="input-glass mb-4 w-full px-3.5 py-2.5 text-sm text-slate-200"
      />
      {loading ? (
        <p className="text-sm text-slate-500">Suggesting mapping…</p>
      ) : (
        <div className="mb-3 space-y-2">
          {rows.map((row, i) => (
            <div key={`${row.input_field}-${i}`} className="flex gap-2">
              <span className="w-1/3 truncate rounded-xl border border-white/[0.1] bg-slate-950/80 px-3 py-2.5 font-mono text-xs text-slate-300">
                {row.input_field}
              </span>
              <select
                value={row.semantic_field}
                onChange={(e) =>
                  setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, semantic_field: e.target.value } : r)))
                }
                className="input-glass flex-1 px-3.5 py-2.5 text-sm text-slate-200"
              >
                <option value="">Semantic field…</option>
                {SEMANTIC_FIELDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      <select
        value={profileId}
        onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : '')}
        className="input-glass mb-5 w-full px-3.5 py-2.5 text-sm text-slate-200"
      >
        <option value="">No output profile (normalized only)…</option>
        {(profiles.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="btn-secondary px-4 py-2"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || loading}
          className="btn-glass bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.9)] hover:bg-emerald-400"
        >
          {busy ? 'Publishing…' : 'Publish mapping'}
        </button>
      </div>
    </Modal>
  )
}
