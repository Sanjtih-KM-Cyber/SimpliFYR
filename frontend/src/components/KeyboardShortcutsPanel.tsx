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
    <kbd className="rounded-lg border border-white/[0.12] border-b-slate-600/80 bg-slate-800/90 px-2 py-1 font-mono text-[11px] font-semibold text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_4px_rgba(0,0,0,0.2)]">
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
          <div key={`${s.keys.join('+')}-${idx}`} className="flex items-center justify-between rounded-xl border border-transparent px-3 py-2.5 text-sm transition-all duration-300 ease-in-out hover:border-white/[0.06] hover:bg-white/[0.045]">
            <span className="text-[13px] font-medium text-slate-300">{s.action}</span>
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
      <div className="mt-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] p-3.5">
        <p className="text-[12px] leading-relaxed text-slate-400">
          <strong className="font-semibold text-cyan-300">Note:</strong> Shortcuts are disabled while typing in input fields. Press <Kbd label="Ctrl" /> + <Kbd label="I" /> or <Kbd label="?" /> anytime to view this panel.
        </p>
      </div>
    </Modal>
  )
}
