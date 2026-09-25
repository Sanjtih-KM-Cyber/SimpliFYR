import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { getHealth } from './api/client'
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel'
import { ToastProvider } from './components/ui'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import AddConnection from './pages/AddConnection'
import Analytics from './pages/Analytics'
import ConnectionLayout from './pages/ConnectionLayout'
import ConnectionLive from './pages/ConnectionLive'
import ConnectionOverview from './pages/ConnectionOverview'
import { ConnectionLearning, ConnectionLogs, ConnectionMappings } from './pages/ConnectionTabs'
import Connections from './pages/Connections'
import Dashboard from './pages/Dashboard'
import Destinations from './pages/Destinations'
import NeedsReview from './pages/NeedsReview'
import Profiles from './pages/Profiles'
import Settings, { SettingsGeneral } from './pages/Settings'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/connections', label: 'Connections' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/needs-review', label: 'Review Queue' },
  { to: '/settings', label: 'Settings' },
]

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      <span className="relative flex h-2.5 w-2.5">
        {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${ok ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]' : 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.45)]'}`}></span>
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
    <div className="isolate flex min-h-screen overflow-hidden bg-slate-950 font-sans text-slate-300">
      <aside className="relative z-20 flex w-[220px] shrink-0 flex-col border-r border-white/[0.12] bg-slate-950/80 shadow-[18px_0_55px_-32px_rgba(0,0,0,0.95)] backdrop-blur-xl saturate-[170%]">
        <div className="border-b border-white/[0.1] bg-white/[0.025] px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400 via-cyan-500 to-blue-600 shadow-[0_12px_28px_-10px_rgba(6,182,212,0.75)]">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white">
                <path d="M4 12V8a4 4 0 014-4h8a4 4 0 014 4v8a4 4 0 01-4 4h-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <path d="M4 12h8m0 0v8m0-8l8-8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-[0.01em] text-white">Simplifyr</h1>
              <p className="mt-0.5 text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase">Universal SIEM</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5 px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isActive
                  ? 'border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.16] to-cyan-400/[0.05] font-semibold text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_-18px_rgba(6,182,212,0.8)]'
                  : 'border-transparent text-slate-400 hover:border-white/[0.08] hover:bg-white/[0.055] hover:text-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/[0.1] bg-black/15 px-5 py-4">
          <div className="flex flex-col gap-3.5">
            <StatusDot ok={Boolean(health?.status === 'ok')} label={`API ${health ? 'v' + health.version : 'Offline'}`} />
            <StatusDot ok={Boolean(health?.database === 'ok')} label="Database" />
          </div>
          <button
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard Shortcuts"
            className="mt-6 flex items-center gap-2 rounded-xl px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition-all duration-300 ease-in-out hover:bg-white/[0.055] hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Shortcuts (Ctrl+I)
          </button>
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-aurora">
        {/* Subtle noise overlay for texture */}
        <div className="pointer-events-none absolute inset-0 z-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCI+PHJlY3Qgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIwLjAxIi8+PC9zdmc+')] opacity-40"></div>
        <div className="relative z-10 mx-auto min-h-full max-w-[1600px] p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/connections/new" element={<AddConnection />} />
            <Route path="/connections/:sourceName" element={<ConnectionLayout />}>
              <Route index element={<ConnectionOverview />} />
              <Route path="mappings" element={<ConnectionMappings />} />
              <Route path="learning" element={<ConnectionLearning />} />
              <Route path="logs" element={<ConnectionLogs />} />
              <Route path="live" element={<ConnectionLive />} />
            </Route>
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/needs-review" element={<NeedsReview />} />
            <Route path="/settings" element={<Settings />}>
              <Route index element={<SettingsGeneral />} />
              <Route path="profiles" element={<Profiles />} />
              <Route path="destinations" element={<Destinations />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <KeyboardShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}

export default App
