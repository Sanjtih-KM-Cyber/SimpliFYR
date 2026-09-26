import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isAnyModalOpen } from '../components/ui/modal-registry'

export const FOCUS_SEARCH_EVENT = 'simplifyr:focus-search'
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useKeyboardShortcuts(onToggleShortcuts: () => void) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'i') {
          e.preventDefault()
          onToggleShortcuts()
        }
        return
      }

      if (e.key === 'Escape') {
        if (isAnyModalOpen()) return
        if (location.pathname !== '/' && window.history.length > 1) {
          e.preventDefault()
          navigate(-1)
        }
        return
      }

      if (isTyping(e.target)) return

      switch (e.key) {
        case '1':
          navigate('/')
          break
        case '2':
          navigate('/connections')
          break
        case '3':
          navigate('/analytics')
          break
        case '4':
          navigate('/settings')
          break
        case 'n':
        case 'N':
          navigate('/connections?new=1')
          break
      case 'r':
      case 'R':
        navigate('/needs-review')
        break
      case '?':
          onToggleShortcuts()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, location.pathname, onToggleShortcuts])
}
