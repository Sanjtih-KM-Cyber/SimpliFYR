import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { getHealth } from './api/client'
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel'
import { ToastProvider } from './components/ui'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import AddConnection from './pages/AddConnection'
import Analytics from './pages/Analytics'
import Audit from './pages/Audit'
import ConnectionLayout from './pages/ConnectionLayout'
import ConnectionLive from './pages/ConnectionLive'
import ConnectionOverview from './pages/ConnectionOverview'
import { ConnectionLearning, ConnectionMappings, ConnectionNeedsReview, ConnectionOutputs } from './pages/ConnectionTabs'
import Connections from './pages/Connections'
import Dashboard from './pages/Dashboard'
import Destinations from './pages/Destinations'
import Logs from './pages/Logs'
import NeedsReview from './pages/NeedsReview'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', label: 'Home', key: '1' },
  { to: '/connections', label: 'Connections', key: '2' },
  { to: '/logs', label: 'Logs', key: '3' },
  { to: '/settings', label: 'Settings', key: '4' },
]

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
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
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <aside className="flex w-56 flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-white">Simplifyr</h1>
          <p className="text-xs text-slate-400">Simplify the signal. Preserve the truth.</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
              <span className="rounded border border-slate-700 bg-slate-950 px-1.5 font-mono text-[10px] text-slate-500">
                {item.key}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
          <button
            onClick={() => setShowShortcuts(true)}
            className="mb-2 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            Keyboard shortcuts
            <span className="rounded border border-slate-700 bg-slate-950 px-1.5 font-mono text-[10px] text-slate-500">
              ?
            </span>
          </button>
          <div className="flex items-center gap-2">
            <StatusDot ok={Boolean(health?.status === 'ok')} />
            API {health ? `v${health.version}` : 'offline'}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StatusDot ok={Boolean(health?.database === 'ok')} />
            Database {health ? health.database : '…'}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
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
          <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/audit" element={<Audit />} />
              <Route path="/settings/destinations" element={<Destinations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <KeyboardShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}

export default App
