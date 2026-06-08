import { homedir } from 'node:os'
import { parseInput } from './src/input.mjs'
import { buildOutput } from './src/render.mjs'
import { gitInfo } from './src/git.mjs'
import { countInfra } from './src/count.mjs'
import { withCache } from './src/cache.mjs'

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
    const deps = {
      home,
      now: () => Math.floor(Date.now() / 1000),
      git: cwd => cwd ? withCache(sid, 'git', 2000, () => gitInfo(cwd)) : null,
      counts: cwd => cwd ? withCache(sid, 'counts', 60000, () => countInfra(cwd, home)) : null,
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
