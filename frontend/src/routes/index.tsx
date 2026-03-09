import { redirect } from 'react-router'

export function clientLoader() {
  throw redirect('/profiles')
}

export default function IndexRoute() {
  return null
}
