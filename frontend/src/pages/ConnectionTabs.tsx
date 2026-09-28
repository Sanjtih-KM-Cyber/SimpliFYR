import { useParams } from 'react-router-dom'
import Analytics from './Analytics'
import Knowledge from './Knowledge'
import Logs from './Logs'
import Mappings from './Mappings'

function useSourceName(): string {
  const { sourceName = '' } = useParams()
  return sourceName
}

export function ConnectionMappings() {
  return <Mappings sourceFilter={useSourceName()} />
}

export function ConnectionLearning() {
  return <Knowledge sourceFilter={useSourceName()} />
}

export function ConnectionAnalytics() {
  const raw = useSourceName()
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    name = raw
  }
  return <Analytics sourceFilter={name} />
}

export function ConnectionLogs() {
  const raw = useSourceName()
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    name = raw
  }
  return <Logs sourceFilter={name} />
}
