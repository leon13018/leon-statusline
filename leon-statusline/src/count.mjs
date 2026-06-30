import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const EXCLUDE = new Set(['.git', 'node_modules', 'vendor', '.venv', 'dist', 'build'])

export function countClaudeMd(root) {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!EXCLUDE.has(e.name)) stack.push(join(d, e.name))
      } else if (e.name === 'CLAUDE.md') n++
    }
  }
  return n
}

export function countDirFiles(dir, predicate) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.isDirectory() && predicate(e.name)).length
  } catch { return 0 }
}

export function countSkillDirs(skillsDir) {
  let n = 0
  try {
    for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md'))) n++
    }
  } catch {}
  return n
}

export function countMemory(memDir) {
  return countDirFiles(memDir, n => n.endsWith('.md'))
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

export function countHooks(settingsObjs) {
  let n = 0
  for (const s of settingsObjs) {
    const hooks = s && s.hooks
    if (!hooks) continue
    for (const event of Object.keys(hooks)) {
      const arr = hooks[event]
      if (!Array.isArray(arr)) continue
      for (const matcher of arr) n += (matcher.hooks?.length || 0)
    }
  }
  return n
}

export function countEnabledPlugins(settings) {
  const ep = settings && settings.enabledPlugins
  if (!ep) return 0
  if (Array.isArray(ep)) return ep.length
  return Object.values(ep).filter(Boolean).length
}

export function countMcp(claudeJson, projectMcp) {
  const set = new Set()
  for (const k of Object.keys(claudeJson?.mcpServers || {})) set.add(k)
  for (const k of Object.keys(projectMcp?.mcpServers || {})) set.add(k)
  return set.size
}

// 由 cwd 推導本 session 的 memory 目錄（CC 將專案路徑非英數字元換成 '-'）
export function memoryDirFor(cwd, home = homedir()) {
  const enc = String(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  return join(home, '.claude', 'projects', enc, 'memory')
}

// 彙總（全程容錯；缺項回 0）
export function countInfra(cwd, home = homedir()) {
  const proj = cwd
  const userClaude = join(home, '.claude')
  const userSettings = readJson(join(userClaude, 'settings.json'))
  const projSettings = readJson(join(proj, '.claude', 'settings.json'))
  const projSettingsLocal = readJson(join(proj, '.claude', 'settings.local.json'))
  return {
    claudeMd: countClaudeMd(proj),
    memory: countMemory(memoryDirFor(cwd, home)),
    mcp: countMcp(readJson(join(home, '.claude.json')), readJson(join(proj, '.mcp.json'))),
    agent: countDirFiles(join(proj, '.claude', 'agents'), n => n.endsWith('.md'))
         + countDirFiles(join(userClaude, 'agents'), n => n.endsWith('.md')),
    skill: countSkillDirs(join(proj, '.claude', 'skills'))
         + countSkillDirs(join(userClaude, 'skills')),
    hook: countHooks([userSettings, projSettings, projSettingsLocal].filter(Boolean)),
    plugin: countEnabledPlugins(userSettings),
    workflow: countDirFiles(join(proj, '.claude', 'workflows'), n => n.endsWith('.js'))
            + countDirFiles(join(userClaude, 'workflows'), n => n.endsWith('.js')),
  }
}
