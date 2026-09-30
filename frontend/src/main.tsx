import { initializeSentry } from './lib/sentry'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { normalizeLocation } from './lib/router'
import './index.css'

initializeSentry()

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

normalizeLocation()

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
