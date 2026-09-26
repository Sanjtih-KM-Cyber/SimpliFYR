import { useEffect, useState } from 'react'
import {
  listConnections,
  listOutputProfiles,
  onboardEvent,
  suggestEventMapping,
} from '../api/client'
import type { EventDetail } from '../api/types'
import { ErrorBanner } from './Status'
import { SemanticFieldInput } from './SemanticFieldInput'
import { Modal, useToast } from './ui'
import { useAsync } from '../hooks/useAsync'
import { Spinner } from './Spinner'
import { Dropdown } from './Dropdown'

interface Row {
  input_field: string
  semantic_field: string
}

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
    <Modal open title={`Onboard event #${event.id}`} onClose={onClose} width="max-w-xl">
      <p className="mb-4 text-body-sm text-on-surface-variant">
        Name its connection — an existing one creates a new mapping version, a new
        name onboards a new vendor/source. The event is reprocessed immediately.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="mb-4">
        <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">Connection name</label>
        <input
          value={connection}
          onChange={(e) => setConnection(e.target.value)}
          placeholder="Connection name (existing or new vendor)"
          list="onboard-connections"
          className="input-glass w-full px-3.5 py-2.5 text-body-sm text-on-surface"
        />
        <datalist id="onboard-connections">
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </div>
      <div className="mb-4">
        <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">Mapping name</label>
        <input
          value={mappingName}
          onChange={(e) => setMappingName(e.target.value)}
          placeholder={`Mapping name (defaults to "${connection.trim() || 'Connection'} Mapping")`}
          className="input-glass w-full px-3.5 py-2.5 text-body-sm text-on-surface"
        />
      </div>
      {loading ? (
        <div className="mb-4 flex items-center gap-3 text-body-sm text-on-surface-variant">
          <Spinner size="sm" />
          <span>Suggesting mapping…</span>
        </div>
      ) : (
        <div className="mb-4 space-y-2">
          {rows.map((row, i) => (
            <div key={`${row.input_field}-${i}`} className="flex gap-2">
              <span className="w-1/3 truncate surface-inset rounded-xl px-3 py-2.5 font-mono text-mono-sm text-on-surface-variant border border-outline-variant/50">
                {row.input_field}
              </span>
              <SemanticFieldInput
                value={row.semantic_field}
                onChange={(v) =>
                  setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, semantic_field: v } : r)))
                }
              />
            </div>
          ))}
        </div>
      )}
      <div className="mb-4">
        <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">Output profile</label>
        <Dropdown
          value={profileId}
          onChange={(v) => setProfileId(v ? Number(v) : '')}
          options={[
            { value: '', label: 'No output profile (normalized only)…' },
            ...(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
          placeholder="No output profile (normalized only)…"
          searchable
          className="w-full"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || loading}
          className="btn-primary"
        >
          {busy ? <Spinner size="sm" /> : 'Publish mapping'}
        </button>
      </div>
    </Modal>
  )
}