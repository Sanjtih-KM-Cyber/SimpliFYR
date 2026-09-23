import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { getHealth } from './api/client'
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel'
import { ToastProvider } from './components/ui'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import AddConnection from './pages/AddConnection'
import ConnectionLayout from './pages/ConnectionLayout'
import ConnectionLive from './pages/ConnectionLive'
import ConnectionOverview from './pages/ConnectionOverview'
import { ConnectionLearning, ConnectionMappings, ConnectionNeedsReview, ConnectionOutputs } from './pages/ConnectionTabs'
import Connections from './pages/Connections'
import Dashboard from './pages/Dashboard'
import Logs from './pages/Logs'
import NeedsReview from './pages/NeedsReview'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/connections', label: 'Connections' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
]

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
      <span className="relative flex h-2 w-2">
        {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
      </span>
      {label}
    </div>
  )
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </ToastProvider>
  )
}

function Shell() {
  const [health, setHealth] = useState<{ status: string; version: string; database: string } | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useKeyboardShortcuts(() => setShowShortcuts((v) => !v))

  return (
    <div className="flex min-h-screen bg-slate-950 font-sans text-slate-300">
      <aside className="z-10 flex w-[220px] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl">
        <div className="border-b border-slate-800 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white">
                <path d="M4 12V8a4 4 0 014-4h8a4 4 0 014 4v8a4 4 0 01-4 4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 12h8m0 0v8m0-8l8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide text-white">Simplifyr</h1>
              <p className="text-[10px] font-medium tracking-widest text-slate-500 uppercase">Universal SIEM</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex w-full items-center justify-between rounded-md px-3 py-2 text-[13px] font-medium transition-all ${isActive
                  ? 'bg-cyan-500/10 text-cyan-400 font-semibold tactical-glow border border-cyan-500/20'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 bg-slate-900/30 px-5 py-4">
          <div className="flex flex-col gap-3">
            <StatusDot ok={Boolean(health?.status === 'ok')} label={`API ${health ? 'v' + health.version : 'Offline'}`} />
            <StatusDot ok={Boolean(health?.database === 'ok')} label="Database" />
          </div>
          <button
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard Shortcuts"
            className="mt-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-500 hover:text-cyan-400 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Shortcuts (Ctrl+I)
          </button>
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-aurora">
        {/* Subtle noise overlay for texture */}
        <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjMDAwIiBmaWxsLW9wYWNpdHk9IjAuMDEiLz4KPC9zdmc+')] opacity-50 z-0"></div>
        <div className="relative z-10 p-8 max-w-[1600px] mx-auto min-h-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/connections/new" element={<AddConnection />} />
            <Route path="/connections/:sourceName" element={<ConnectionLayout />}>
              <Route index element={<ConnectionOverview />} />
              <Route path="mappings" element={<ConnectionMappings />} />
              <Route path="output" element={<ConnectionOutputs />} />
              <Route path="learning" element={<ConnectionLearning />} />
              <Route path="needs-review" element={<ConnectionNeedsReview />} />
              <Route path="live" element={<ConnectionLive />} />
            </Route>
            <Route path="/logs" element={<Logs />} />
            <Route path="/needs-review" element={<NeedsReview />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <KeyboardShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}

export default App
