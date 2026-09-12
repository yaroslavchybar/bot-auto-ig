import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shutdownSignal, sleep } from './lifecycle.js'
import { BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT } from './config.js'

export type Display = {
  display: string
  displayNum: number
  vncPort: number
  close: () => Promise<void>
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    const finish = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(250, () => finish(false))
  })
}

/** Give each visible Linux browser its own desktop and noVNC endpoint. */
export async function allocateDisplay(): Promise<Display | undefined> {
  if (process.platform !== 'linux') return undefined
  for (let index = 1; index <= 50; index++) {
    shutdownSignal.throwIfAborted()
    const displayNum = 99 + index
    const vncPort = 6080 + index
    const rfbPort = 5900 + index
    const lockPath = path.join(os.tmpdir(), `ig-bot-display-${displayNum}.lock`)
    try {
      const lock = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(lock, String(process.pid))
      fs.closeSync(lock)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const pid = Number(fs.readFileSync(lockPath, 'utf8'))
        try {
          if (pid > 0) process.kill(pid, 0)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ESRCH')
            fs.unlinkSync(lockPath)
        }
        continue
      }
      throw error
    }
    const children: ChildProcess[] = []
    let closing: Promise<void> | undefined
    const close = () =>
      (closing ??= (async () => {
        await Promise.all(
          children.map(
            (child) =>
              new Promise<void>((resolve) => {
                if (child.exitCode !== null || child.signalCode || !child.pid)
                  return resolve()
                const timer = setTimeout(() => {
                  child.kill('SIGKILL')
                  resolve()
                }, 1500)
                child.once('exit', () => {
                  clearTimeout(timer)
                  resolve()
                })
                child.kill('SIGTERM')
              }),
          ),
        )
        fs.unlinkSync(lockPath)
      })())
    let failure: Error | undefined
    const start = (command: string, args: string[]) => {
      const child = spawn(command, args, { stdio: 'ignore' })
      child.once('error', (error) => {
        failure = error
      })
      child.once('exit', (code) => {
        if (!closing) failure = new Error(`${command} exited with code ${code}`)
      })
      children.push(child)
    }
    const ready = async (port: number) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (failure) throw failure
        if (await listening(port)) return
        await sleep(100)
      }
      throw new Error(`Display did not start on port ${port}`)
    }
    try {
      if ((await listening(vncPort)) || (await listening(rfbPort))) {
        await close()
        continue
      }
      start('Xtigervnc', [
        `:${displayNum}`,
        '-geometry',
        `${BROWSER_WINDOW_WIDTH}x${BROWSER_WINDOW_HEIGHT}`,
        '-depth',
        '24',
        '-rfbport',
        String(rfbPort),
        '-SecurityTypes',
        'None',
        '-AlwaysShared',
        '-localhost',
      ])
      await ready(rfbPort)
      start('fluxbox', ['-display', `:${displayNum}`])
      start('websockify', [
        '--web=/usr/share/novnc',
        String(vncPort),
        `127.0.0.1:${rfbPort}`,
      ])
      await ready(vncPort)
      return { display: `:${displayNum}`, displayNum, vncPort, close }
    } catch (error) {
      await close()
      throw error
    }
  }
  throw new Error('No browser displays available')
}
