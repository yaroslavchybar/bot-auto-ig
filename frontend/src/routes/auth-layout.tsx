import { Outlet } from 'react-router'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export default function AuthLayout() {
  return <Outlet />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Authentication Error" />
}
