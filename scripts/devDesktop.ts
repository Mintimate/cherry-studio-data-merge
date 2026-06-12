import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

const rendererUrl = 'http://127.0.0.1:5173'
const electronBin = path.resolve('node_modules/.bin/electron')

function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 24) {
    throw new Error(`当前 Node.js 是 ${process.version}，请切换到 Node.js 24 后再运行 yarn desktop。`)
  }
}

function run(name: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`)
    }
  })

  return child
}

async function waitForRenderer() {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(rendererUrl)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('Vite dev server did not become ready in time.')
}

async function main() {
  assertNodeVersion()

  const vite = run('vite', 'yarn', ['dev', '--host', '127.0.0.1'])

  try {
    await waitForRenderer()
    const build = run('electron build', 'yarn', ['build:electron'])
    const [code] = (await once(build, 'exit')) as [number]
    if (code !== 0) {
      throw new Error('Electron 主进程构建失败。')
    }

    const electron = run('electron', electronBin, ['.'], {
      VITE_DEV_SERVER_URL: rendererUrl,
    })

    await once(electron, 'exit')
  } finally {
    vite.kill()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
