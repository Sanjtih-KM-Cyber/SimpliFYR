import { useOutletContext } from 'react-router-dom'
import type { ConnectionDetail } from '../api/types'

export type ConnectionContext = { connection: ConnectionDetail }

export function useConnection() {
  return useOutletContext<ConnectionContext>()
}
