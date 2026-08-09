// tsserver / LSP probe 的診斷工具 —— 「A 組跑不出負載時，用這支查為什麼」
//
// ## 它查出了什麼（2026-08-09，本案最關鍵的一次診斷）
//
// `ata-storm.mjs` 前兩版的 A 組怎麼跑都只有 0.009 / 0.003 核，完全沒有重現空轉。
// 本工具的四階段量測一次定位到真因：
//
//   1. `capabilities` 階段顯示 `diagnosticsFilesReceived: []` —— 開了 10 個真實檔，
//      **一則 publishDiagnostics 都沒收到**，回傳訊息只有 window/logMessage、
//      initialize 的 result 與 $/typescriptVersion。
//      → 真因：initialize 送的 `capabilities` 是空物件 `{}`（初版簡報寫錯、兩版照抄）。
//        客戶端沒宣告任何 textDocument 能力，server 的診斷管線就不會啟動，
//        tsserver 開檔後直接待機、從未真正解析模組。**前兩版量的都是一個「半睡」的行程。**
//   2. 三個 churn 階段（閒置 / ~/.claude / ~/Desktop）分別是 0.002 / 0.003 / 0.004 核，
//      彼此在雜訊內無法區分 —— 但這是**因為上一點**：沒解析過模組就沒註冊 failed-lookup
//      監看，沒有監看器，寫再多檔案都不會觸發。不可據此推論 churn 在 production 無效。
//   3. `didChange` 階段（每 1.5 秒注入新的無解析 bare import）跳到 **0.301 核**，
//      是 churn 階段的約 100 倍 → 定位出真正能驅動負載的手段，`ata-storm.mjs` 三版據此改寫。
//
// ## 何時用得上
//
// - `ata-storm.mjs` 回報 `reproduced: false` 或 `diagnosticsFilesReceived` 為空時，先跑這支。
// - 日後執行 spec §3.3 的 jsconfig.json 路線、需要重跑實驗時，用來確認 probe 本身是活的。
// - 想比較不同驅動手段（churn 位置、編輯流量）各自的貢獻度時。
//
// 用法：
//   node tools/ata-diagnose.mjs caps    快篩：新的 capabilities 是否真的讓診斷進來（約 25 秒）
//   node tools/ata-diagnose.mjs phases  四階段驅動比較（約 2 分鐘）
//   第 3 個參數可覆寫專案 root，預設為受害專案（唯讀，只讀不寫）
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFrameReader } from './lsp-frames.mjs'

const MODE = process.argv[2]
if (MODE !== 'caps' && MODE !== 'phases') {
  console.error('用法: node tools/ata-diagnose.mjs <caps|phases> [projectRoot]')
  process.exit(2)
}

const OPEN_LIMIT = 10
const SERVER = join(process.env.APPDATA, 'npm', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')
const proj = process.argv[3] || join(homedir(), 'Desktop', 'wlc-timerleak')   // ⚠️ 唯讀

// 與 ata-storm.mjs 相同的真實 client capabilities（沒有這組，診斷管線不會啟動）
const CAPABILITIES = {
  textDocument: {
    synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: false },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
  },
  workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
}

const ps = cmd => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 15000 }).trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))

const listMjs = (dir, acc = []) => {
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (acc.length >= OPEN_LIMIT) return acc
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '.git') listMjs(full, acc) }
    else if (e.name.endsWith('.mjs')) acc.push(full)
  }
  return acc
}

// 整棵行程樹的 CPU 總和（含獨立的 typingsInstaller.js 子行程）
const treeScript = rootPid => `
$root = ${rootPid}
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$set = New-Object System.Collections.Generic.HashSet[int]
[void]$set.Add($root)
$frontier = @($root)
while ($frontier.Count -gt 0) {
  $next = @()
  foreach ($p in $all) {
    if (($frontier -contains [int]$p.ParentProcessId) -and (-not $set.Contains([int]$p.ProcessId))) {
      [void]$set.Add([int]$p.ProcessId); $next += [int]$p.ProcessId
    }
  }
  $frontier = $next
}
$cpu = 0.0
foreach ($id in $set) { $pr = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($pr) { $cpu += [double]$pr.CPU } }
Write-Output $cpu
`

// churn 目錄：A = 原設計位置，B = 受害專案的直接祖先（用來比較 churn 位置是否有差）
const churnHome = join(homedir(), '.claude', '.ata-probe-diag')
const churnDesktop = join(homedir(), 'Desktop', '.ata-probe-diag')

let lsp = null, timer = null
const cleanup = () => {
  if (timer) clearInterval(timer)
  try { if (lsp) lsp.kill() } catch {}
  for (const d of [churnHome, churnDesktop]) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })

try {
  mkdirSync(churnHome, { recursive: true })
  mkdirSync(churnDesktop, { recursive: true })

  const files = listMjs(proj)
  if (files.length === 0) throw new Error(`專案下找不到 .mjs：${proj}`)

  lsp = spawn('node', [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] })
  const send = msg => {
    const body = JSON.stringify(msg)
    lsp.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  const methods = new Map()
  const diagFiles = new Set()
  let diagN = 0, initAcked = false
  lsp.stdout.on('data', createFrameReader(m => {
    const key = m.method || (m.id !== undefined ? `result#${m.id}` : 'other')
    methods.set(key, (methods.get(key) || 0) + 1)
    if (m.id === 1 && m.result) initAcked = true
    if (m.method === 'textDocument/publishDiagnostics') {
      diagN++
      diagFiles.add(basename(decodeURIComponent(new URL(m.params.uri).pathname)))
    } else if (m.method && m.id !== undefined) {
      send({ jsonrpc: '2.0', id: m.id, result: null })
    }
  }))

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    processId: process.pid, rootUri: pathToFileURL(proj).href,
    capabilities: CAPABILITIES, initializationOptions: {},
  } })
  send({ jsonrpc: '2.0', method: 'initialized', params: {} })

  const texts = new Map()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    texts.set(f, text)
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: {
      uri: pathToFileURL(f).href, languageId: 'javascript', version: 1, text } } })
  }

  if (MODE === 'caps') {
    // 快篩：只確認診斷管線活著，不量 CPU
    await sleep(12000)
    const f0 = files[0]
    send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
      textDocument: { uri: pathToFileURL(f0).href, version: 2 },
      contentChanges: [{ text: `${texts.get(f0)}\nimport zz from 'ata-missing-pkg-1'\n` }] } })
    await sleep(13000)
    console.log(JSON.stringify({
      mode: 'caps',
      initializeAcked: initAcked,
      diagnosticsNotifications: diagN,
      diagnosticsFilesReceived: [...diagFiles],
      messagesByMethod: Object.fromEntries(methods),
      verdict: diagFiles.size > 0
        ? 'OK：診斷管線已啟動，probe 是活的'
        : 'BAD：一則診斷都沒收到 —— capabilities 沒對，probe 是半睡的（本案初版真因）',
    }, null, 2))
  } else {
    // 四階段：比較各驅動手段的貢獻度
    let tsPid = ''
    for (let i = 0; i < 30 && !tsPid; i++) {
      await sleep(1000)
      tsPid = ps(`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${lsp.pid}" | Where-Object { $_.CommandLine -like '*tsserver.js*' -and $_.CommandLine -notlike '*partialSemantic*' } | Select-Object -First 1).ProcessId`)
    }
    if (!tsPid) throw new Error('找不到 tsserver 子行程')
    const cpu = () => Number(ps(treeScript(tsPid)))

    await sleep(15000)   // 暖機

    const WIN = 25000
    const phase = async (label, churnDir) => {
      let n = 0
      if (churnDir) timer = setInterval(() => {
        try { writeFileSync(join(churnDir, `c${n++}.tmp`), String(Date.now())) } catch {}
      }, 1000)
      const b = cpu(); await sleep(WIN); const a = cpu()
      if (timer) { clearInterval(timer); timer = null }
      return { label, cpuSeconds: Number((a - b).toFixed(2)), rateCores: Number(((a - b) / (WIN / 1000)).toFixed(3)), churnFiles: n }
    }

    const r1 = await phase('idle-no-churn', null)
    const r2 = await phase('churn-in-~/.claude', churnHome)
    const r3 = await phase('churn-in-~/Desktop', churnDesktop)

    // 第四階段：didChange 注入新的無解析 bare import（僅存在於 LSP 記憶體，不落地）
    const f0 = files[0], t0 = texts.get(f0)
    let v = 1
    timer = setInterval(() => {
      v++
      send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
        textDocument: { uri: pathToFileURL(f0).href, version: v },
        contentChanges: [{ text: `${t0}\n// probe ${v}\nimport z${v} from 'ata-missing-pkg-${v}'\n` }] } })
    }, 1500)
    const b4 = cpu(); await sleep(WIN); const a4 = cpu()
    clearInterval(timer); timer = null
    const r4 = { label: 'didChange+new-bare-imports', cpuSeconds: Number((a4 - b4).toFixed(2)), rateCores: Number(((a4 - b4) / (WIN / 1000)).toFixed(3)), versions: v }

    console.log(JSON.stringify({
      mode: 'phases',
      tsPid: Number(tsPid),
      initializeAcked: initAcked,
      diagnosticsNotifications: diagN,
      diagnosticsFilesReceived: [...diagFiles],
      phases: [r1, r2, r3, r4],
      note: diagFiles.size === 0
        ? '⚠️ 一則診斷都沒收到 —— 各階段數字皆不可信，probe 是半睡的（先修 capabilities）'
        : '診斷正常，各階段數字可比較',
    }, null, 2))
  }
} finally {
  cleanup()
}
