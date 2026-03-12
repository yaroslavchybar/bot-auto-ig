import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { ScrapedDataPage } from '@/features/scraped-data/ScrapedDataPage'

export const handle = {
  navId: 'scraped-data',
  breadcrumb: 'Scraped Data',
}

export default function ScrapedDataRoute() {
  return <ScrapedDataPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Scraped Data Error" />
}
