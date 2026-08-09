import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseInput } from './src/input.mjs'
import { buildOutput } from './src/render.mjs'
import { gitInfo } from './src/git.mjs'
import { countInfra, readJson } from './src/count.mjs'
import { withCache, readSharedState, writeSharedState } from './src/cache.mjs'
import { autoCompactThreshold, autoCompactWindow } from './src/compact.mjs'
import { sampleProcesses } from './src/procscan.mjs'
import { detect } from './src/runaway.mjs'

async function main() {
  let out = ''
  try {
    const raw = await new Promise(res => {
      let buf = ''
      process.stdin.on('data', c => (buf += c))
      process.stdin.on('end', () => res(buf))
      process.stdin.on('error', () => res(buf))
      setTimeout(() => res(buf), 1500) // 永不卡死
    })
    const d = parseInput(raw)
    const sid = d.session_id
    const home = homedir()
    // 每次 render 即時讀 user settings 的 autoCompactWindow（隨 /autocompact 立即反映）
    const userSettings = readJson(join(home, '.claude', 'settings.json'))
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
      autoCompactThreshold: autoCompactThreshold(),
      autoCompactWindow: autoCompactWindow([userSettings]),
      // 失控行程守衛：跨 session 共用狀態，內部自帶節流（最多每 60 秒實際取樣一次）
      runaway: () => detect({
        now: Date.now(),
        readState: () => readSharedState('runaway-state'),
        writeState: s => writeSharedState('runaway-state', s),
        sample: () => sampleProcesses(),
      }),
    }
    out = buildOutput(d, deps)
    if (!out) out = d.model?.display_name || 'claude'
  } catch {
    out = 'claude'
  }
  process.stdout.write(out)
  process.exit(0)
}

main()
