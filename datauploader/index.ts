import './src/env.js'
import { mkdir } from 'node:fs/promises'
import { createApp } from './src/app.js'
import { config } from './src/config.js'
import { createConvexClient } from './src/convex.js'
import { withCors } from './src/http.js'

// Data Uploader service entry point.
await mkdir(config.uploadDir, { recursive: true })

const handler = withCors(
    createApp({ client: createConvexClient(), uploadDir: config.uploadDir }),
)

const server = Bun.serve({
    port: config.port,
    fetch: handler,
})

console.log(`Data Uploader listening on http://localhost:${server.port}`)
