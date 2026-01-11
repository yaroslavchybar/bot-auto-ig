import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { automationState } from '../store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../helpers/mutex.js'
import { savePid, clearPid } from '../automation/process-manager.js'
import { parseLogOutput } from '../logs/parser.js'
import { workflowsGetById, workflowsStart, workflowsUpdateStatus, workflowLogsCreateBatch } from '../data/convex.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'getting_started', 'run_workflow.py')

const router = Router()

function getPid(proc: any): number | null {
    const pid = proc?.pid
    return typeof pid === 'number' && Number.isFinite(pid) ? pid : null
}

async function stopProcess(proc: any): Promise<void> {
    const pid = getPid(proc)
    if (!pid) return

    if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
            execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve())
        })
        return
    }

    try {
        process.kill(-pid, 'SIGTERM')
    } catch {
        try {
            proc.kill('SIGTERM')
        } catch {
            return
        }
    }

    await new Promise((r) => setTimeout(r, 1500))

    try {
        process.kill(-pid, 'SIGKILL')
    } catch {
        return
    }
}

router.get('/status', (req, res) => {
    res.json({
        status: automationState.status,
        running: automationState.status === 'running',
    })
})

router.post('/run', async (req, res) => {
    const release = await automationMutex.acquire()

    try {
        if (automationState.process) {
            return res.status(400).json({ error: 'Automation already running' })
        }

        const workflowId = String(req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '').trim()
        if (!workflowId) {
            return res.status(400).json({ error: 'workflowId is required' })
        }

        const workflow = await workflowsGetById(workflowId)
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' })
        }

        if (workflow.isTemplate) {
            return res.status(400).json({ error: 'Cannot run a template workflow' })
        }

        const requestedParallel = Number(req.body?.parallelProfiles ?? req.body?.parallel_profiles ?? req.body?.parallel ?? 1)
        const parallelProfiles = Number.isFinite(requestedParallel) ? Math.max(1, Math.min(10, Math.floor(requestedParallel))) : 1

        await workflowsStart(workflowId)

        automationState.status = 'running'
        broadcast({ type: 'status', status: 'running' })
        broadcast({ type: 'log', message: `Starting workflow: ${workflow.name}`, level: 'info', source: 'server' })

        automationState.process = spawn('python', ['-u', PYTHON_RUNNER], {
            cwd: PROJECT_ROOT,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: PROJECT_ROOT },
        })

        const pid = getPid(automationState.process)
        if (pid) savePid(pid)

        const payload = JSON.stringify({
            workflowId,
            workflow: { nodes: workflow.nodes ?? [], edges: workflow.edges ?? [] },
            options: { parallel_profiles: parallelProfiles },
        })
        automationState.process.stdin?.write(payload)
        automationState.process.stdin?.end()

        const flushLogsToConvex = async (parsed: any[]) => {
            const batch = parsed
                .map((l) => ({
                    workflowId,
                    nodeId: (l?.metadata as any)?.node_id ?? (l?.metadata as any)?.nodeId,
                    level: l.level,
                    message: l.message,
                    metadata: l.metadata,
                }))
                .filter((x) => x.message)

            if (batch.length === 0) return
            try {
                await workflowLogsCreateBatch({ logs: batch as any })
            } catch {
            }
        }

        const maybeUpdateStatusFromEvent = async (log: any) => {
            const meta = (log?.metadata as any) || {}
            const eventType = log?.eventType

            if (eventType === 'session_started') {
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running', progress: 0 })
                } catch {
                }
                return
            }

            if (eventType === 'task_started' && (meta.node_id || meta.nodeId)) {
                const currentNodeId = String(meta.node_id ?? meta.nodeId)
                const progress = typeof meta.progress === 'number' ? meta.progress : undefined
                const nodeStates = meta.node_states ?? meta.nodeStates
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running', currentNodeId, progress, nodeStates })
                } catch {
                }
                return
            }

            if (eventType === 'session_ended') {
                const status = meta?.status === 'completed' ? 'completed' : meta?.status === 'failed' ? 'failed' : 'completed'
                try {
                    await workflowsUpdateStatus({ workflowId, status })
                } catch {
                }
            }
        }

        automationState.process.stdout?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            void flushLogsToConvex(parsed)

            for (const log of parsed) {
                void maybeUpdateStatusFromEvent(log)
                broadcast({
                    type: log.eventType ? log.eventType : 'log',
                    message: log.message,
                    level: log.level,
                    source: 'python',
                    ...log.metadata,
                })
            }
        })

        automationState.process.stderr?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)
            void flushLogsToConvex(parsed)
            for (const log of parsed) {
                broadcast({ type: 'log', message: log.message, level: 'error', source: 'python' })
            }
        })

        automationState.process.on('close', async (code) => {
            clearPid()
            automationState.process = null
            automationState.status = 'idle'
            broadcast({ type: 'status', status: 'idle' })
            broadcast({
                type: 'log',
                message: `Workflow finished with code ${code}`,
                level: code === 0 ? 'success' : 'warn',
                source: 'server',
            })

            try {
                const finalStatus = code === 0 ? 'completed' : 'failed'
                await workflowsUpdateStatus({ workflowId, status: finalStatus })
            } catch {
            }
        })

        automationState.process.on('error', async (err) => {
            clearPid()
            automationState.process = null
            automationState.status = 'idle'
            broadcast({ type: 'status', status: 'idle' })
            broadcast({ type: 'log', message: `Workflow error: ${err.message}`, level: 'error', source: 'server' })
            try {
                await workflowsUpdateStatus({ workflowId, status: 'failed', error: String(err?.message || err) })
            } catch {
            }
        })

        res.json({ success: true, message: 'Workflow started' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    } finally {
        release()
    }
})

router.post('/stop', async (req, res) => {
    const release = await automationMutex.acquire()
    try {
        const workflowId = String(req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '').trim()

        if (!automationState.process) {
            if (workflowId) {
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'cancelled' })
                } catch {
                }
            }
            return res.status(400).json({ error: 'No workflow running' })
        }

        automationState.status = 'stopping'
        broadcast({ type: 'status', status: 'stopping' })
        broadcast({ type: 'log', message: 'Stopping workflow...', level: 'warn', source: 'server' })

        await stopProcess(automationState.process)
        automationState.process = null
        clearPid()

        automationState.status = 'idle'
        broadcast({ type: 'status', status: 'idle' })
        broadcast({ type: 'log', message: 'Workflow stopped', level: 'info', source: 'server' })

        if (workflowId) {
            try {
                await workflowsUpdateStatus({ workflowId, status: 'cancelled' })
            } catch {
            }
        }

        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    } finally {
        release()
    }
})

export default router

