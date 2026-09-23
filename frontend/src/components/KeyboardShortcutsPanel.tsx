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
    <kbd className="rounded-[4px] border-b-2 border-slate-700/80 bg-slate-800/80 px-2 py-1 font-mono text-[11px] font-semibold text-cyan-100 shadow-sm">
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
      <div className="space-y-1">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="flex items-center justify-between border-b border-slate-700/30 px-2 py-2.5 text-sm hover:bg-slate-800/30 transition-colors">
            <span className="text-slate-300 text-[13px] font-medium">{s.action}</span>
            <span className="flex items-center gap-1.5">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">+</span>}
                  <Kbd label={k} />
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-md bg-cyan-950/20 border border-cyan-900/30 p-3">
        <p className="text-[12px] leading-relaxed text-slate-400">
          <strong className="text-cyan-500 font-semibold">Note:</strong> Shortcuts are disabled while typing in input fields. Press <Kbd label="Ctrl" /> + <Kbd label="I" /> or <Kbd label="?" /> anytime to view this panel.
        </p>
      </div>
    </Modal>
  )
}
