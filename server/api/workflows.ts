import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { workflowWorkers } from '../store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../helpers/mutex.js'
import { parseLogOutput } from '../logs/parser.js'
import { workflowsGetById, workflowsStart, workflowsUpdateStatus } from '../data/convex.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'getting_started', 'run_workflow.py')

const router = Router()

function getPid(proc: any): number | null {
    const pid = proc?.pid
    return typeof pid === 'number' && Number.isFinite(pid) ? pid : null
}

function waitForExit(proc: any, ms: number): Promise<boolean> {
    if (proc?.exitCode !== null && proc?.exitCode !== undefined) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
        let done = false
        const timer = setTimeout(() => {
            if (done) return
            done = true
            proc?.off?.('exit', onExit)
            resolve(proc?.exitCode !== null && proc?.exitCode !== undefined)
        }, ms)
        const onExit = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(true)
        }
        proc?.once?.('exit', onExit)
    })
}

async function stopProcess(proc: any): Promise<void> {
    const pid = getPid(proc)
    if (!pid) return

    if (process.platform === 'win32') {
        try {
            proc.kill('SIGBREAK')
        } catch {
        }
        const exited = await waitForExit(proc, 2000)
        if (exited) return
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

    const exited = await waitForExit(proc, 5000)
    if (exited) return

    try {
        process.kill(-pid, 'SIGKILL')
    } catch {
        return
    }
}

function isStopNoiseLog(message: string): boolean {
    const m = String(message || '')
    return (
        /Future exception was never retrieved/i.test(m) ||
        /BrokenPipeError/i.test(m) ||
        /Broken pipe/i.test(m) ||
        /Traceback \(most recent call last\)/i.test(m) ||
        /asyncio\/unix_events\.py/i.test(m)
    )
}

router.get('/status', (req, res) => {
    const workflowId = String((req.query as any)?.workflowId ?? (req.query as any)?.workflow_id ?? (req.query as any)?.id ?? '').trim()
    if (workflowId) {
        const worker = workflowWorkers.get(workflowId)
        return res.json({
            workflowId,
            status: worker?.status ?? 'idle',
            running: Boolean(worker),
            startedAt: worker?.startedAt ?? null,
        })
    }

    return res.json({
        running: workflowWorkers.size > 0,
        runningCount: workflowWorkers.size,
        workflows: Array.from(workflowWorkers.entries()).map(([id, w]) => ({
            workflowId: id,
            status: w.status,
            startedAt: w.startedAt,
        })),
    })
})

router.post('/run', async (req, res) => {
    const release = await automationMutex.acquire()

    try {
        const workflowId = String(req.body?.workflowId ?? req.body?.workflow_id ?? req.body?.id ?? '').trim()
        if (!workflowId) {
            return res.status(400).json({ error: 'workflowId is required' })
        }

        if (workflowWorkers.has(workflowId)) {
            return res.status(400).json({ error: 'Workflow already running' })
        }

        const configuredMax = Number(process.env.WORKFLOW_MAX_CONCURRENCY ?? 3)
        const maxConcurrency = Number.isFinite(configuredMax) ? Math.max(1, Math.floor(configuredMax)) : 3
        if (workflowWorkers.size >= maxConcurrency) {
            return res.status(429).json({ error: `Too many workflows running (max ${maxConcurrency})` })
        }

        const workflow = await workflowsGetById(workflowId)
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' })
        }

        const requestedParallel = Number(req.body?.parallelProfiles ?? req.body?.parallel_profiles ?? req.body?.parallel ?? 1)
        const parallelProfiles = Number.isFinite(requestedParallel) ? Math.max(1, Math.min(10, Math.floor(requestedParallel))) : 1

        await workflowsStart(workflowId)

        broadcast({ type: 'workflow_status', workflowId, status: 'running' })
        broadcast({ type: 'log', workflowId, message: `Starting workflow: ${workflow.name}`, level: 'info', source: 'server' })

        const proc = spawn('python', ['-u', PYTHON_RUNNER], {
            cwd: PROJECT_ROOT,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: PROJECT_ROOT },
        })
        workflowWorkers.set(workflowId, { process: proc, status: 'running', startedAt: Date.now() })

        const payload = JSON.stringify({
            workflowId,
            workflow: { nodes: workflow.nodes ?? [], edges: workflow.edges ?? [] },
            options: { parallel_profiles: parallelProfiles },
        })
        proc.stdin?.write(payload)
        proc.stdin?.end()

        const maybeUpdateStatusFromEvent = async (log: any) => {
            const meta = (log?.metadata as any) || {}
            const eventType = log?.eventType

            if (eventType === 'session_started') {
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running' })
                } catch {
                }
                return
            }

            if (eventType === 'task_started' && (meta.node_id || meta.nodeId)) {
                const currentNodeId = String(meta.node_id ?? meta.nodeId)
                const nodeStates = meta.node_states ?? meta.nodeStates
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running', currentNodeId, nodeStates })
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

        proc.stdout?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                const stopRequested = Boolean((proc as any).__stopRequested)
                if (stopRequested && isStopNoiseLog(log?.message)) continue
                void maybeUpdateStatusFromEvent(log)
                broadcast({
                    workflowId,
                    type: log.eventType ? log.eventType : 'log',
                    message: log.message,
                    level: log.level,
                    source: 'python',
                    ...log.metadata,
                })
            }
        })

        proc.stderr?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)
            for (const log of parsed) {
                const stopRequested = Boolean((proc as any).__stopRequested)
                if (stopRequested && isStopNoiseLog(log?.message)) continue
                broadcast({ type: 'log', workflowId, message: log.message, level: 'error', source: 'python' })
            }
        })

        proc.on('close', async (code) => {
            workflowWorkers.delete(workflowId)
            broadcast({ type: 'workflow_status', workflowId, status: 'idle' })
            broadcast({
                type: 'log',
                workflowId,
                message: `Workflow finished with code ${code}`,
                level: code === 0 ? 'success' : 'warn',
                source: 'server',
            })

            try {
                const stopRequested = Boolean((proc as any).__stopRequested)
                const finalStatus = stopRequested ? 'cancelled' : code === 0 ? 'completed' : 'failed'
                await workflowsUpdateStatus({ workflowId, status: finalStatus })
            } catch {
            }
        })

        proc.on('error', async (err) => {
            workflowWorkers.delete(workflowId)
            broadcast({ type: 'workflow_status', workflowId, status: 'idle' })
            broadcast({ type: 'log', workflowId, message: `Workflow error: ${err.message}`, level: 'error', source: 'server' })
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

        const idsToStop = workflowId ? [workflowId] : Array.from(workflowWorkers.keys())
        if (idsToStop.length === 0) return res.status(400).json({ error: 'No workflow running' })

        const stopped: string[] = []

        for (const id of idsToStop) {
            const worker = workflowWorkers.get(id)
            if (!worker) continue
            workflowWorkers.set(id, { ...worker, status: 'stopping' })
            ;(worker.process as any).__stopRequested = true
            broadcast({ type: 'workflow_status', workflowId: id, status: 'stopping' })
            broadcast({ type: 'log', workflowId: id, message: 'Stopping workflow...', level: 'warn', source: 'server' })
            await stopProcess(worker.process)
            stopped.push(id)
        }

        if (workflowId && stopped.length === 0) return res.status(400).json({ error: 'Workflow not running' })
        res.json({ success: true, stopped })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    } finally {
        release()
    }
})

export default router
