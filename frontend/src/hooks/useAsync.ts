import { useCallback, useEffect, useState } from 'react'

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fn()
      .then((d) => {
        if (active) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, ...deps])

  return { data, error, loading, reload }
}