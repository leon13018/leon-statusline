import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export function targetPath(scope, home = homedir(), projectDir = process.cwd()) {
  if (scope === 'project') return join(projectDir, '.claude', 'settings.json')
  if (scope === 'local') return join(projectDir, '.claude', 'settings.local.json')
  return join(home, '.claude', 'settings.json')
}

export function mergeStatusLine(existing, command) {
  return { ...(existing || {}), statusLine: { type: 'command', command, refreshInterval: 10 } }
}

export function applySetup(file, command, force, stamp = String(Date.now())) {
  let existing = null
  try { existing = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  if (existing && existing.statusLine && !force) {
    return { existing: true, written: false, path: file }
  }
  let backup = null
  if (existsSync(file)) { backup = `${file}.bak-${stamp}`; copyFileSync(file, backup) }
  else { mkdirSync(dirname(file), { recursive: true }) }
  writeFileSync(file, JSON.stringify(mergeStatusLine(existing, command), null, 2))
  return { existing: !!(existing && existing.statusLine), written: true, path: file, backup }
}

// CLI: node setup.mjs --root <pluginRoot> [--scope user|project|local] [--force]
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def }
if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  const root = arg('--root', process.env.CLAUDE_PLUGIN_ROOT || '.')
  const scope = arg('--scope', 'user')
  const force = process.argv.includes('--force')
  const command = `node "${join(root, 'statusline.mjs')}"`
  const r = applySetup(targetPath(scope), command, force)
  process.stdout.write(JSON.stringify(r))
}
