import * as Sentry from '@sentry/react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const dsn = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    // Keep the previous data collection settings when upgrading to Sentry 11.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
  })
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
