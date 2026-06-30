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

// 是否為本 plugin 寫的 statusLine（--sync 安全判斷，不誤動使用者其他設定）
export function isOurs(command) {
  return typeof command === 'string' && command.includes('statusline.mjs') && command.includes('leon-statusline')
}

// 升級後路徑改變時自動重指：僅當既有 statusLine 是「我們的」且過時才改寫（idempotent、寫前備份）
export function applySync(file, desiredCommand, stamp = String(Date.now())) {
  let j
  try { j = JSON.parse(readFileSync(file, 'utf8')) } catch { return { updated: false, status: 'absent' } }
  const cur = j.statusLine && j.statusLine.command
  if (!isOurs(cur)) return { updated: false, status: 'foreign' }
  if (cur === desiredCommand) return { updated: false, status: 'current' }
  const backup = `${file}.bak-${stamp}`
  copyFileSync(file, backup)
  j.statusLine = { ...j.statusLine, command: desiredCommand }
  writeFileSync(file, JSON.stringify(j, null, 2))
  return { updated: true, status: 'repointed', from: cur, to: desiredCommand, backup }
}

// CLI: node setup.mjs --root <pluginRoot> [--scope user|project|local] [--force] | --sync
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def }
if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  const root = arg('--root', process.env.CLAUDE_PLUGIN_ROOT || '.')
  const command = `node "${join(root, 'statusline.mjs')}"`
  if (process.argv.includes('--sync')) {
    // SessionStart hook 用：靜默（stdout 會被當成 session context 注入），跨 scope 自動重指
    // --report：給 resync-statusline skill 用，逐 scope 印出結果
    const report = process.argv.includes('--report')
    const results = []
    for (const scope of ['user', 'project', 'local']) {
      let r
      try { r = applySync(targetPath(scope), command) } catch { r = { updated: false, status: 'absent' } }
      results.push({ scope, ...r })
    }
    if (report) process.stdout.write(JSON.stringify(results))
  } else {
    const scope = arg('--scope', 'user')
    const force = process.argv.includes('--force')
    process.stdout.write(JSON.stringify(applySetup(targetPath(scope), command, force)))
  }
}
