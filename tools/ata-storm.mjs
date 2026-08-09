// A/B 對照：量測 tsserver 行程樹在真實編輯流量 + 家目錄 churn 下的 CPU 消耗
// 用法：node tools/ata-storm.mjs <on|off> [projectRoot]
//   off = A 組（現況，不帶選項）   on = B 組（disableAutomaticTypingAcquisition: true）
//
// 修訂三版（2026-08-09）：
//   v1 合成 scratch 專案（單一 2 行檔）        → A 組 0.009 核，未重現空轉
//   v2 改真實受害專案（10 檔／整棵行程樹／180 秒窗）→ A 組 0.003 核，仍未重現
//   v3 查出真因：initialize 送的 capabilities 是空物件 `{}`，客戶端沒宣告任何 textDocument
//      能力，server 的診斷管線從未啟動 —— tsserver 開檔後直接待機，從未真正解析模組，
//      因此也未註冊任何 failed-lookup 監看，churn 自然打不到東西（這證明的是「壞掉的
//      probe 上 churn 無效」，不是 churn 在 production 無效；production 的診斷堆疊
//      FSWatcher._handle.onchange → scheduleInvalidateResolutionOfFailedLookupLocation
//      仍然成立）。本版補上真實 client capabilities，並改以 didChange 注入無解析
//      bare import 當主驅動，churn 維持同時開啟。
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFrameReader } from './lsp-frames.mjs'

const MODE = process.argv[2]
if (MODE !== 'on' && MODE !== 'off') {
  console.error('用法: node tools/ata-storm.mjs <on|off> [projectRoot]')
  process.exit(2)
}

const WARMUP_MS = 20_000              // 暖機：didOpen 後靜置，讓初次索引沉澱，不計入
const DURATION_MS = 180_000           // 主觀測窗（didChange + churn 同時驅動）
const CHURN_ONLY_MS = 60_000          // 收尾觀測窗（停掉 didChange，只留 churn）—— 資訊性，不進判準
const CHURN_PERIOD_MS = 3750          // 8 檔 / 30 秒（實測 churn 速率）
const EDIT_PERIOD_MS = 1500           // didChange 節奏
const OPEN_LIMIT = 10                 // didOpen 的真實檔案數
const REPRO_MIN_RATE = 0.05           // A 組低於此值 = 沒重現空轉，A/B 比較無意義
const SERVER = join(process.env.APPDATA, 'npm', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')

// 受害專案：真實形狀（無 tsconfig/jsconfig/package.json/node_modules、大量 bare import）
// ⚠️ 唯讀。只讀取內容送 didOpen；didChange 僅改 LSP 記憶體內的文件版本，絕不落地。
const proj = process.argv[3] || join(homedir(), 'Desktop', 'wlc-timerleak')

const ps = cmd => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 15000 }).trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 遞迴列出 .mjs（略過 .git，每層字典序排序，確保兩組開同一批檔）
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

// 整棵行程樹的 CPU 總和：每次呼叫都重新展開 ParentProcessId（過程中可能長出新子行程，
// 例如獨立的 typingsInstaller.js）
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
$live = @()
foreach ($id in $set) {
  $pr = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($pr) { $cpu += [double]$pr.CPU; $live += $id }
}
Write-Output ("{0}|{1}" -f $cpu, ($live -join ','))
`

// churn 目錄設在家目錄下，用意是命中 failed-lookup 監看。
// ⚠️ 但這條因果在本 probe 上**量不到**：收尾窗（停掉 didChange、只留 churn）實測僅
// 0.003 / 0.001 核，與閒置無異。這不代表 churn 在 production 無效 —— spec §1 診斷抓到的
// FSWatcher._handle.onchange → scheduleInvalidateResolutionOfFailedLookupLocation
// 是真實檔案系統事件觸發的；合理解釋是本目錄未落在 production 實際被監看的失敗查找位置上。
// churn 在 production 的貢獻度，本實驗未能量到，亦未否證。措辭與 spec §3.2 一致。
const churn = join(homedir(), '.claude', '.ata-probe')
mkdirSync(churn, { recursive: true })

let lsp = null, churnTimer = null, editTimer = null
const cleanup = () => {
  if (churnTimer) clearInterval(churnTimer)
  if (editTimer) clearInterval(editTimer)
  try { if (lsp) lsp.kill() } catch {}
  try { rmSync(churn, { recursive: true, force: true }) } catch {}   // 只清自己造的 churn 目錄
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })

try {
  const files = listMjs(proj)
  if (files.length === 0) throw new Error(`專案下找不到 .mjs：${proj}`)

  lsp = spawn('node', [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] })

  const send = msg => {
    const body = JSON.stringify(msg)
    lsp.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  // 解析 server → client 訊息：統計 publishDiagnostics，並回覆 server 發來的請求（避免它卡住）
  const diagFiles = new Set()
  let diagNotifications = 0
  lsp.stdout.on('data', createFrameReader(m => {
    if (m.method === 'textDocument/publishDiagnostics') {
      diagNotifications++
      diagFiles.add(basename(decodeURIComponent(new URL(m.params.uri).pathname)))
    } else if (m.method && m.id !== undefined) {
      send({ jsonrpc: '2.0', id: m.id, result: null })   // 泛用回覆，避免 server 等待
    }
  }))

  send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      processId: process.pid,
      rootUri: pathToFileURL(proj).href,
      // v3 修正：v1/v2 這裡是空物件 `{}`，導致診斷管線從未啟動、tsserver 待機
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: false },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        },
        workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
      },
      initializationOptions: MODE === 'on' ? { disableAutomaticTypingAcquisition: true } : {},
    },
  })
  send({ jsonrpc: '2.0', method: 'initialized', params: {} })

  // 開 10 個真實檔（貼近 Claude Code 一個 session 會開很多檔的實況）
  const texts = new Map()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    texts.set(f, text)
    send({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: { textDocument: {
        uri: pathToFileURL(f).href, languageId: 'javascript', version: 1, text,
      } },
    })
  }

  // 等待全語意 tsserver 子行程出現（排除 partialSemantic 那隻）
  let tsPid = ''
  for (let i = 0; i < 30 && !tsPid; i++) {
    await sleep(1000)
    tsPid = ps(`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${lsp.pid}" | Where-Object { $_.CommandLine -like '*tsserver.js*' -and $_.CommandLine -notlike '*partialSemantic*' } | Select-Object -First 1).ProcessId`)
  }
  if (!tsPid) throw new Error('找不到 tsserver 子行程')

  const cmdline = ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${tsPid}").CommandLine`)
  const treeCpu = () => {
    const [cpu, live] = ps(treeScript(tsPid)).split('|')
    return { cpu: Number(cpu), pids: live ? live.split(',').map(Number) : [] }
  }

  // 暖機：靜置讓初次索引沉澱，這段不驅動、不計入
  await sleep(WARMUP_MS)

  // 兩種驅動同時開啟；A、B 兩組驅動條件完全一致，唯一變數是 ATA 旗標
  let churnN = 0
  churnTimer = setInterval(() => {
    try { writeFileSync(join(churn, `c${churnN++}.tmp`), String(Date.now())) } catch {}
  }, CHURN_PERIOD_MS)

  const editTarget = files[0]
  const editBase = texts.get(editTarget)
  let version = 1
  editTimer = setInterval(() => {
    version++
    // 每次注入一個全新的、必然無法解析的 bare import（僅存在於 LSP 記憶體，不落地）
    send({
      jsonrpc: '2.0', method: 'textDocument/didChange',
      params: {
        textDocument: { uri: pathToFileURL(editTarget).href, version },
        contentChanges: [{ text: `${editBase}\n// ata-probe ${version}\nimport z${version} from 'ata-missing-pkg-${version}'\n` }],
      },
    })
  }, EDIT_PERIOD_MS)

  const before = treeCpu()
  await sleep(DURATION_MS)
  const after = treeCpu()

  const cpuSeconds = Number((after.cpu - before.cpu).toFixed(2))
  const rateCores = Number((cpuSeconds / (DURATION_MS / 1000)).toFixed(3))
  const reproduced = rateCores >= REPRO_MIN_RATE
  const diagnosticsFilesReceived = [...diagFiles]

  // 收尾觀測窗：停掉 didChange，只留 churn。此時 tsserver 已真正解析過模組、
  // failed-lookup 監看已註冊，這個數字才有意義。資訊性，不進 A/B 判準。
  let churnOnlyCpuSeconds = null, churnOnlyRateCores = null
  if (diagnosticsFilesReceived.length > 0) {
    clearInterval(editTimer); editTimer = null
    const b2 = treeCpu()
    await sleep(CHURN_ONLY_MS)
    const a2 = treeCpu()
    churnOnlyCpuSeconds = Number((a2.cpu - b2.cpu).toFixed(2))
    churnOnlyRateCores = Number((churnOnlyCpuSeconds / (CHURN_ONLY_MS / 1000)).toFixed(3))
  }

  console.log(JSON.stringify({
    mode: MODE,
    projectRoot: proj,
    filesOpened: files.length,
    tsPid: Number(tsPid),
    pids: after.pids,
    hasFlag: cmdline.includes('--disableAutomaticTypingAcquisition'),
    diagnosticsFilesReceived,
    diagnosticsNotifications: diagNotifications,
    didChangeVersions: version,
    churnFilesWritten: churnN,
    warmupSec: WARMUP_MS / 1000,
    windowSec: DURATION_MS / 1000,
    cpuSeconds,
    rateCores,
    reproduced,
    churnOnlyWindowSec: CHURN_ONLY_MS / 1000,
    churnOnlyCpuSeconds,
    churnOnlyRateCores,
  }, null, 2))

  // 前置檢查一：診斷確實有收到，否則 capabilities 仍不對，比較無意義
  if (diagnosticsFilesReceived.length === 0) {
    console.error('[BLOCKED] 主觀測窗結束仍未收到任何 publishDiagnostics，capabilities 未生效')
    process.exitCode = 4
  } else if (MODE === 'off' && !reproduced) {
    // 前置檢查二：A 組沒重現空轉的話，A/B 比較無意義，不得往下跑 B 組
    console.error(`[BLOCKED] A 組 rateCores ${rateCores} < ${REPRO_MIN_RATE}，未重現空轉，A/B 比較無意義`)
    process.exitCode = 3
  }
} finally {
  cleanup()
}
