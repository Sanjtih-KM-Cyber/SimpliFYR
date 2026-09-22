import { Modal } from './ui/Modal'

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['1'], action: 'Home' },
  { keys: ['2'], action: 'Connections' },
  { keys: ['3'], action: 'Logs' },
  { keys: ['4'], action: 'Settings' },
  { keys: ['N'], action: 'New Connection' },
  { keys: ['R'], action: 'Needs Review' },
  { keys: ['/'], action: 'Search logs' },
  { keys: ['Esc'], action: 'Close / Back' },
  { keys: ['Ctrl', 'I'], action: 'Toggle this panel' },
]

function Kbd({ label }: { label: string }) {
  return (
    <kbd className="rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-200">
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
    <Modal open={open} title="Keyboard Shortcuts" onClose={onClose}>
      <div className="space-y-2">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="flex items-center justify-between text-sm">
            <span className="text-slate-300">{s.action}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 && <span className="text-xs text-slate-500">+</span>}
                  <Kbd label={k} />
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
        Shortcuts are ignored while typing in an input. Press Ctrl+I or ? anytime to see this
        panel.
      </p>
    </Modal>
  )
}
