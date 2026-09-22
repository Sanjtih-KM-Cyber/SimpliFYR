import { useParams } from 'react-router-dom'
import Knowledge from './Knowledge'
import Mappings from './Mappings'
import NeedsReview from './NeedsReview'
import Outputs from './Outputs'

function useSourceName(): string {
  const { sourceName = '' } = useParams()
  return sourceName
}

export function ConnectionMappings() {
  return <Mappings sourceFilter={useSourceName()} />
}

export function ConnectionOutputs() {
  return <Outputs embedded sourceName={useSourceName()} />
}

export function ConnectionLearning() {
  return <Knowledge sourceFilter={useSourceName()} />
}

export function ConnectionNeedsReview() {
  return <NeedsReview sourceFilter={useSourceName()} />
}
