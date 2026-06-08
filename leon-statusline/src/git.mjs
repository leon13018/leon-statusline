import { spawnSync } from 'node:child_process'

function defaultRunner(args, cwd) {
  const r = spawnSync('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', timeout: 2000 })
  if (r.error || r.status !== 0) return null
  return r.stdout.trim()
}

export function gitInfo(cwd, runner = defaultRunner) {
  try {
    const branch = runner(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    if (!branch) return null
    const porcelain = runner(['status', '--porcelain'], cwd) ?? ''
    let staged = 0, modified = 0
    for (const line of porcelain.split('\n')) {
      if (!line) continue
      const x = line[0], y = line[1]
      if (x === '?' && y === '?') { modified++; continue }
      if (x !== ' ' && x !== '?') staged++
      if (y !== ' ' && y !== '?') modified++
    }
    let ahead = 0, behind = 0
    const ab = runner(['rev-list', '--left-right', '--count', '@{u}...HEAD'], cwd)
    if (ab) {
      const [b, a] = ab.split(/\s+/).map(n => parseInt(n, 10) || 0)
      behind = b; ahead = a
    }
    return { branch, staged, modified, ahead, behind }
  } catch {
    return null
  }
}
