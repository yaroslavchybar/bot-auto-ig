import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { activeDisplays, workflowWorkers } from '../store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../helpers/mutex.js'
import { parseLogOutput } from '../logs/parser.js'
import {
    workflowArtifactsGetStorageUrl,
    workflowArtifactsListByWorkflow,
    workflowsGetById,
    workflowsStart,
    workflowsUpdateStatus,
} from '../data/convex.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'runners', 'run_workflow.py')

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

function displayKey(workflowId: string, profileName: string): string {
    return `${workflowId}:${profileName}`
}

function clearWorkflowDisplays(workflowId: string): void {
    for (const [key, session] of activeDisplays.entries()) {
        if (session.workflowId === workflowId) {
            activeDisplays.delete(key)
        }
    }
}

function normalizeOptionalParallelProfiles(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return undefined
    return Math.max(1, Math.min(10, Math.floor(parsed)))
}

function normalizeWorkflowTerminalStatus(value: unknown): 'completed' | 'failed' | 'cancelled' {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (normalized === 'failed') return 'failed'
    if (normalized === 'cancelled') return 'cancelled'
    return 'completed'
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

router.get('/artifacts', async (req, res) => {
    try {
        const workflowId = String((req.query as any)?.workflowId ?? (req.query as any)?.workflow_id ?? (req.query as any)?.id ?? '').trim()
        if (!workflowId) {
            return res.status(400).json({ error: 'workflowId is required' })
        }

        const artifacts = await workflowArtifactsListByWorkflow(workflowId)
        return res.json(artifacts)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return res.status(500).json({ error: message })
    }
})

router.get('/artifacts/storage-url', async (req, res) => {
    try {
        const storageId = String((req.query as any)?.storageId ?? '').trim()
        if (!storageId) {
            return res.status(400).json({ error: 'storageId is required' })
        }

        const url = await workflowArtifactsGetStorageUrl(storageId)
        if (!url) {
            return res.status(404).json({ error: 'Artifact URL is not ready' })
        }

        return res.json({ url })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return res.status(500).json({ error: message })
    }
})

router.get('/artifacts/download', async (req, res) => {
    try {
        const storageId = String((req.query as any)?.storageId ?? '').trim()
        const fileName = String((req.query as any)?.fileName ?? 'artifact.json').trim() || 'artifact.json'
        if (!storageId) {
            return res.status(400).json({ error: 'storageId is required' })
        }

        const url = await workflowArtifactsGetStorageUrl(storageId)
        if (!url) {
            return res.status(404).json({ error: 'Artifact URL is not ready' })
        }

        const upstream = await fetch(url)
        if (!upstream.ok) {
            return res.status(502).json({ error: `Failed to download artifact (${upstream.status})` })
        }

        const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
        const arrayBuffer = await upstream.arrayBuffer()
        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        return res.send(Buffer.from(arrayBuffer))
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return res.status(500).json({ error: message })
    }
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

        const parallelProfiles = normalizeOptionalParallelProfiles(
            req.body?.parallelProfiles ?? req.body?.parallel_profiles ?? req.body?.parallel,
        )

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
            workflow: {
                name: workflow.name,
                nodes: workflow.nodes ?? [],
                edges: workflow.edges ?? [],
                nodeStates: workflow.nodeStates ?? {},
                currentNodeId: workflow.currentNodeId ?? null,
            },
            options: {
                ...(parallelProfiles === undefined ? {} : { parallel_profiles: parallelProfiles }),
                node_states: workflow.nodeStates ?? {},
                current_node_id: workflow.currentNodeId ?? null,
                workflow_name: workflow.name,
            },
        })
        proc.stdin?.write(payload)
        proc.stdin?.end()

        let currentProfile: string | null = null;

        const maybeUpdateStatusFromEvent = async (log: any) => {
            const meta = (log?.metadata as any) || {}
            const eventType = log?.eventType
            const nextNodeStates = meta.node_states ?? meta.nodeStates
            const nextCurrentNodeId = meta.node_id ?? meta.nodeId

            if (eventType === 'session_started') {
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running' })
                } catch {
                }
                return
            }

            if (eventType === 'profile_started') {
                currentProfile = meta.profile || null;
            } else if (eventType === 'profile_completed') {
                currentProfile = null;
            }

            if ((eventType === 'task_started' || eventType === 'task_completed' || eventType === 'task_progress') && nextCurrentNodeId) {
                const currentNodeId = String(nextCurrentNodeId)
                const nodeStates = nextNodeStates
                try {
                    await workflowsUpdateStatus({ workflowId, status: 'running', currentNodeId, nodeStates })
                } catch {
                }
                return
            }

            if (eventType === 'session_ended') {
                const status = normalizeWorkflowTerminalStatus(meta?.status)
                try {
                    await workflowsUpdateStatus({
                        workflowId,
                        status,
                        currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
                        nodeStates: nextNodeStates,
                    })
                } catch {
                }
                return
            }

            if (nextNodeStates !== undefined) {
                try {
                    await workflowsUpdateStatus({
                        workflowId,
                        status: 'running',
                        currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
                        nodeStates: nextNodeStates,
                    })
                } catch {
                }
            }
        }

        const maybeTrackDisplaysFromEvent = (log: any) => {
            const meta = (log?.metadata as any) || {}
            const eventType = String(log?.eventType || '')
            const profileName = String(meta.profile ?? meta.profileName ?? '').trim()
            const key = profileName ? displayKey(workflowId, profileName) : null

            if (eventType === 'display_allocated' && key) {
                const vncPort = Number(meta.vnc_port ?? meta.vncPort)
                const displayNum = Number(meta.display_num ?? meta.displayNum)
                if (!Number.isFinite(vncPort) || !Number.isFinite(displayNum)) {
                    return
                }
                activeDisplays.set(key, {
                    workflowId,
                    profileName,
                    vncPort,
                    displayNum,
                    status: 'active',
                })
                return
            }

            if ((eventType === 'display_released' || eventType === 'profile_completed') && key) {
                activeDisplays.delete(key)
            }
        }

        proc.stdout?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                const stopRequested = Boolean((proc as any).__stopRequested)
                if (stopRequested && isStopNoiseLog(log?.message)) continue
                void maybeUpdateStatusFromEvent(log)
                maybeTrackDisplaysFromEvent(log)
                broadcast({
                    workflowId,
                    type: log.eventType ? log.eventType : 'log',
                    message: log.message,
                    level: log.level,
                    source: 'python',
                    profileName: currentProfile,
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
                broadcast({
                    type: 'log',
                    workflowId,
                    message: log.message,
                    level: log.explicitLevel ? log.level : 'error',
                    source: 'python',
                })
            }
        })

        proc.on('close', async (code) => {
            workflowWorkers.delete(workflowId)
            clearWorkflowDisplays(workflowId)
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
            clearWorkflowDisplays(workflowId)
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
                ; (worker.process as any).__stopRequested = true
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
