import { ScrapingPage } from '@/features/scraping/ScrapingPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'scraping',
  breadcrumb: 'Scraping',
}

export default function ScrapingRoute() {
  return <ScrapingPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Scraping Error" />
}
