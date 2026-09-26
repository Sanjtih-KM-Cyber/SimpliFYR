import { Modal } from './ui/Modal'

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['1'], action: 'Home' },
  { keys: ['2'], action: 'Connections' },
  { keys: ['3'], action: 'Analytics' },
  { keys: ['4'], action: 'Settings' },
  { keys: ['N'], action: 'New Connection' },
  { keys: ['R'], action: 'Needs Review' },
  { keys: ['/'], action: 'Connections' },
  { keys: ['Esc'], action: 'Close / Back' },
  { keys: ['Ctrl', 'I'], action: 'Toggle this panel' },
]

function Kbd({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1 font-mono text-mono-sm font-semibold text-on-surface shadow-[inset_0_1px_0_var(--color-outline-variant),0_2px_4px_rgba(15,23,42,0.1)]">
      {label}
    </kbd>
  )
}

export function KeyboardShortcutsPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} title="Keyboard Shortcuts" onClose={onClose} width="max-w-md">
      <div className="space-y-1.5">
        {SHORTCUTS.map((s, idx) => (
          <div key={`${s.keys.join('+')}-${idx}`} className="flex items-center justify-between rounded-xl border border-transparent px-3 py-2.5 text-body-sm transition-colors duration-200 ease-standard hover:border-outline-variant/50 hover:bg-surface-container-low/50">
            <span className="text-body-sm font-medium text-on-surface">{s.action}</span>
            <span className="flex items-center gap-1.5">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-label-sm font-semibold text-on-surface-variant/70">+</span>}
                  <Kbd label={k} />
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 surface-inset rounded-2xl p-3.5">
        <p className="text-body-sm leading-relaxed text-on-surface-variant">
          <strong className="font-semibold text-primary">Note:</strong> Shortcuts are disabled while typing in input fields. Press <Kbd label="Ctrl" /> + <Kbd label="I" /> or <Kbd label="?" /> anytime to view this panel.
        </p>
      </div>
    </Modal>
  )
}