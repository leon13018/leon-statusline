# 失控行程守衛（runaway process guard）— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 tsserver 因祖先目錄探測而無限空轉的成因（`win-lsp` 停用自動型別擷取），並在 statusline 新增條件式第 5 行，於任何行程持續失控時主動顯示。

**Architecture:** Part 1 改 `win-lsp` plugin 的 typescript `initializationOptions`，先以獨立 A/B 實驗證實機制有效。Part 2 在 leon-statusline 新增三個小模組：`procscan.mjs`（唯一與系統互動處，`tasklist` 取樣）、`runaway.mjs`（`classify` 純判定 + `detect` 編排，I/O 全注入）、`cache.mjs` 補跨 session 原子狀態檔；`render.mjs` 加 `renderLine5`，無異常時回 `''`，由既有的 `lines.filter(l => l && l.length)` 自動略過。

**Tech Stack:** Node ESM（`.mjs`）、Vitest（dev-only）、零執行期依賴、Windows `tasklist`。

## Global Constraints

- **永不崩潰**：進入點一律 `process.exit(0)`、至少印一行；偵測相關程式全程容錯、不 throw、不阻塞 render。
- **偵測失敗絕不拖累顯示**：任何取樣／狀態檔錯誤一律靜默回退，狀態列維持現況。
- **零執行期依賴**：只用 Node 內建。
- **路徑安全**：一律 `os.homedir()` + `path.join()`，不字串拼路徑、不讀 `$HOME`/`~`。
- **`runaway.mjs` 的 `classify` 維持純函式**（不 import fs、不 spawn）。
- **只警告，絕不終止／改優先權／隔離**任何行程。
- **參數固定值**：`SCAN_INTERVAL_MS = 60_000`、`RATE_THRESHOLD = 0.5`、`CONSECUTIVE_REQUIRED = 5`。
- **非 Windows**：`sampleProcesses` 回 `null`，第 5 行不顯示，行為與現況完全相同。
- **TDD 先紅後綠**、逐 task commit、**`git add <明確檔案>`（絕不 `-A`）**。
- 產出（程式碼註解 / commit message）用**繁體中文**。
- 完成後 bump `leon-statusline/.claude-plugin/plugin.json` `version` → **1.5.0**。
- 測試指令：全跑 `npx vitest run`；單檔 `npx vitest run tests/<file>`（在 `leon-statusline/` 目錄下）。
- 目前分支：`runaway-process-guard`（spec 已 commit `5efbdd3`）。

## 對 spec 的兩處偏離（已知，附理由）

1. spec §3.2 原訂實驗腳本放 `win-lsp/tests/`。實測 **`win-lsp` 不是 git repo**，放那裡不受版控、不可審閱、易遺失 → 改放 `tools/ata-storm.mjs`（本 repo），與 spec 同倉保存證據。
2. spec §5.1 原設想實驗可共用 `procscan`。實測 **`tasklist` 無父行程與命令列欄位**，無法定位實驗自己起的 tsserver → 實驗改用 WMI 查子行程。此舉使 Part 1 與 Part 2 完全解耦，Part 1 得以排在 Task 1。

---

### Task 1: Part 1 — `win-lsp` 停用自動型別擷取 + A/B 驗證實驗

**Files:**
- Create: `tools/ata-storm.mjs`
- Modify: `C:\Users\LIN HONG\.claude\local-plugins\win-lsp\plugin\.claude-plugin\plugin.json`（**本 repo 之外，非 git**）
- Delete: `C:\Users\LIN HONG\node_modules`（空目錄，僅含 `.bin`）

**Interfaces:**
- Produces: 無程式介面。產出為實驗數據與生效證據，供 Task 9 寫入 journal。

> ⚠️ 實驗腳本自行 spawn `typescript-language-server` 並明示帶入 `initializationOptions`，**不依賴 win-lsp 設定**。故實驗驗證的是「機制有效」，win-lsp 改設定則是把該機制套用到實際環境；兩者分開驗收。

- [x] **Step 1: 寫實驗腳本**

建立 `tools/ata-storm.mjs`。**實作以該檔為準，此處不再內嵌全文**（初版計畫內嵌的程式碼已被三次修訂淘汰，
內嵌副本只會過期）。腳本規格見 spec §3.2「實驗步驟（三版）」，要點：

| 要點 | 內容 |
|---|---|
| 專案 root | 真實受害專案 `~/Desktop/wlc-timerleak`（唯讀），可用第 3 個 argv 覆寫 |
| 開檔 | 遞迴取前 10 個 `.mjs`（每層字典序），讀真實內容送 `didOpen` |
| **capabilities** | **必須含 `textDocument.synchronization` 與 `textDocument.publishDiagnostics`** |
| 驅動（兩種同開） | `didChange` 每 1.5 秒注入新的無解析 bare import ＋ `~/.claude/.ata-probe/` churn（8 檔 / 30 秒） |
| CPU 量測 | tsserver **及其所有子孫行程**總和，每次量測重新展開 `ParentProcessId` |
| 暖機 / 主窗 / 收尾窗 | 20 秒 / 180 秒 / 60 秒（收尾窗只留 churn，記 `churnOnlyRateCores`，資訊性） |
| 前置檢查 | 診斷未收到 → exit 4；A 組 `rateCores < 0.05` → `reproduced: false`、exit 3 |
| 清理 | `finally` 刪 churn 目錄、終止 LSP；受害專案零寫入 |

> **三次修訂的脈絡**（完整版見 spec §3.2）：
> 1. 初版合成單檔 probe → A 組 **0.009 核**，未重現空轉。
> 2. 改真實專案（10 檔、整棵行程樹、180 秒窗）→ 仍 **0.003 核**，未重現。
> 3. 查出真因：`initialize` 的 `capabilities` 是空物件 `{}`（初版簡報寫錯、兩版照抄），
>    診斷管線從未啟動，tsserver 從未真正解析模組 —— 前兩版量的都是「半睡」的行程。
>    修正後改以 `didChange` 驅動 → A 組 **0.173 核**，首次重現。

- [x] **Step 2: 跑 A 組（現況基準）**

Run（在 repo 根目錄）：`node tools/ata-storm.mjs off`
Expected: 約 5 分鐘後印出 JSON，`hasFlag: false`、`diagnosticsFilesReceived` 非空、`reproduced: true`。
**記下 `cpuSeconds`。** 若 `reproduced: false` 或診斷為空 → BLOCKED，不得續跑 B 組。

- [x] **Step 3: 跑 B 組（帶旗標）**

Run: `node tools/ata-storm.mjs on`
Expected: `hasFlag: true`。**記下 `cpuSeconds`。**

- [x] **Step 4: 驗收判準（spec §3.2，事先寫死不得放寬）**

檢查：`B.cpuSeconds <= A.cpuSeconds * 0.2` **且** `B.rateCores < 0.1`。

- 通過 → 繼續 Step 5。
- **未通過 → 停止，回報數據**。依 spec §3.3 收尾條件，需改為替 9 個裸專案補 `jsconfig.json` 後重跑本實驗；該分支不在本計畫範圍，需先與使用者確認。

**實測結果（2026-08-09，三版腳本）→ 判準未通過，Task 1 停在此處：**

| | A 組（`off`） | B 組（`on`） |
|---|---|---|
| `hasFlag` | false | true |
| `pids`（行程樹） | 2（tsserver ＋ `typingsInstaller`） | **1（旗標成功阻止 typingsInstaller 生成）** |
| `diagnosticsNotifications` | 251 | 248 |
| `reproduced` | true | true |
| `cpuSeconds`（180 秒窗） | **31.17** | **24.09** |
| `rateCores` | **0.173** | **0.134** |
| `churnOnlyRateCores`（60 秒） | 0.003 | 0.001 |

判準計算：`31.17 × 0.2 = 6.234`，`24.09 ≤ 6.234` → **false**；`0.134 < 0.1` → **false**。兩條皆未通過。
實際降幅僅 **22.7%**（B/A = 0.773），距要求的「降至 20% 以下」差一個量級。

**結論**：`disableAutomaticTypingAcquisition` **確實生效**（B 組完全沒有 `typingsInstaller` 子行程，
這是機制生效的直接證據），但 ATA **不是** CPU 的主要來源 —— 主導成本是每次 `didChange` 觸發的
模組解析與診斷重算，停用 ATA 只削掉約兩成。

**處置（2026-08-09 使用者裁決）：判準未通過，但經明示授權**越過量化閘門**，仍套用 Step 5、6，Part 1 結案轉進 Part 2。**
**這不是驗收通過。** 完整理由、侷限與長期驗收機制見 spec §3.4，摘要：

- **仍套用的理由**：旗標生效有硬證據（B 組無 `typingsInstaller`）；實測仍省 22.7%；
  單行設定、已備份、可逆。
  **功能損失（全樹掃描實測後下修）：7/9 趨近於零，但 2/9 有實質損失** ——
  `資料視覺/graph-ui`（16 個既有 `@types/*`）與 `leon-statusline/leon-statusline`（3 個，
  且其 `package.json` 正是本 repo 21 個 `.mjs` 的直接祖先）。
  **這條理由因此比原先弱**，使用者的授權建立在知情而非零損失之上。詳見 spec §3.4。
- **侷限（不得省略）**：probe 以每 1.5 秒一次、連續 3 分鐘的編輯驅動，強度遠高於真人編輯，
  該強度下 B 組的 0.134 核較接近**正常工作**而非病態；production 的病態是**無人編輯卻連燒 15 小時 1.0 核**，
  **三輪實驗均未重現該本體**；churn-only 僅 0.003 核，亦未重現 §1 診斷的 `FSWatcher` 堆疊。
  → **本實驗證明旗標有效且 ATA 約佔兩成，但未能重現 production 的空轉本體；ATA 是否為該本體的主因，仍未證實。**
- **`jsconfig.json` 路線暫不執行**：保留為日後選項（新證據指向診斷重算而非失敗查找，其效益同樣未經驗證，
  且會動到 9 個專案的檔案）。
- **後續驗收改為長期觀察**：Part 2 偵測器上線後，tsserver 若再度失控會在 5 分鐘內被標記；
  **若再度被標記，即代表 Part 1 未根治，需重啟 `jsconfig.json` 路線。**

- [x] **Step 5: 備份並修改 win-lsp 設定**

win-lsp 不是 git repo，故先備份：

```bash
cp "C:/Users/LIN HONG/.claude/local-plugins/win-lsp/plugin/.claude-plugin/plugin.json" "C:/Users/LIN HONG/.claude/local-plugins/win-lsp/plugin/.claude-plugin/plugin.json.bak-2026-08-09"
```

把該檔第 14–23 行的 `typescript` 區塊：

```json
    "typescript": {
      "command": "node",
      "args": ["${APPDATA}/npm/node_modules/typescript-language-server/lib/cli.mjs", "--stdio"],
      "env": { "NODE_OPTIONS": "--max-old-space-size=4096" },
```

替換為（僅新增 `initializationOptions` 一行，其餘不動）：

```json
    "typescript": {
      "command": "node",
      "args": ["${APPDATA}/npm/node_modules/typescript-language-server/lib/cli.mjs", "--stdio"],
      "env": { "NODE_OPTIONS": "--max-old-space-size=4096" },
      "initializationOptions": { "disableAutomaticTypingAcquisition": true },
```

**已完成（2026-08-09）**：備份為 `plugin.json.bak-2026-08-09`（2642 bytes，與原檔一致）；
`Compare-Object` 確認**僅新增上述一行**，JSON 合法、9 個 lspServers 全數保留。

- [x] **Step 6: 刪除家目錄殘骸**

先確認為空（僅 `.bin`、0 MB）再刪：

```bash
powershell -NoProfile -Command "Get-ChildItem 'C:\Users\LIN HONG\node_modules' -Recurse -File | Measure-Object -Property Length -Sum"
```
Expected: `Count: 0`、`Sum:`（空）。確認後：
```bash
powershell -NoProfile -Command "Remove-Item -Recurse -Force 'C:\Users\LIN HONG\node_modules'"
```

**已完成（2026-08-09 17:00）**：刪除前重新確認 `Count: 0`、`Sum:` 空、`.bin` 內 0 個項目，
確認後刪除，`Test-Path` 回 `False`。

- [ ] **Step 7: 生效證據（spec §3.3）** —— **本 task 跳過，由控制端另行安排重啟後驗證**

重啟 Claude Code（讓 LSP 以新設定重起），然後：

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*tsserver.js*' -and $_.CommandLine -notlike '*partialSemantic*' } | ForEach-Object { $_.CommandLine }"
```
Expected: 每一條全語意 tsserver 命令列都含 `--disableAutomaticTypingAcquisition`。

> ⚠️ **設定已改，但現行行程仍是舊設定。** 改動當下實測 4 隻全語意 tsserver 全數
> `HasFlag: False`（皆早於改動啟動，最久的已跑 385 分鐘、累計 938 CPU 秒），
> 4 隻 `typingsInstaller` 仍在。**必須重啟才會生效。**
> 另注意上面的 `-notlike '*partialSemantic*'` 過濾不可省 ——
> partialSemantic server 本來就帶這個旗標，會造成誤判為已生效。

- [x] **Step 8: Commit**

```bash
git add tools/ata-storm.mjs
git commit -m "test(tools): tsserver 自動型別擷取風暴 A/B 實驗腳本"
```

**實際**：分兩次提交。`a7836bb` 為腳本三版 ＋ spec/plan 實驗方法修訂；
結案的文件修訂（spec §3.4、plan 本節）另行提交。
win-lsp `plugin.json` 在 repo 之外且非 git 管理，**不進 commit**，僅以 `.bak-2026-08-09` 備份保全。

---

### Task 2: `parseTasklistCsv` — CSV 解析（純函式）

**Files:**
- Create: `leon-statusline/src/procscan.mjs`
- Test: `leon-statusline/tests/procscan.test.mjs`

**Interfaces:**
- Produces: `parseTasklistCsv(text: string): Array<{pid:number, name:string, cpuSeconds:number}> | null` — 解析 `tasklist /v /fo csv`；無有效列回 `null`。

> `tasklist /v /fo csv` 共 9 欄：`Image Name, PID, Session Name, Session#, Mem Usage, Status, User Name, CPU Time, Window Title`。只取索引 0、1、7。CPU Time 格式 `H:MM:SS`，時數可超過 99（如 `350:32:46`）。Window Title 為最後一欄，即使其內含 `","` 也只影響尾端切片，不影響索引 0–7。

- [ ] **Step 1: Write the failing test**

建立 `leon-statusline/tests/procscan.test.mjs`：

```js
import { describe, it, expect } from 'vitest'
import { parseTasklistCsv } from '../src/procscan.mjs'

const HEADER = '"Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"'
const row = (name, pid, cpu, title = 'N/A') =>
  `"${name}","${pid}","Console","1","47,020 K","Unknown","DESKTOP\\LIN HONG","${cpu}","${title}"`

describe('parseTasklistCsv', () => {
  it('解析標頭 + 資料列，取 name/pid/cpuSeconds', () => {
    const out = parseTasklistCsv([HEADER, row('node.exe', 32228, '0:00:01'), row('chrome.exe', 100, '0:02:03')].join('\r\n'))
    expect(out).toEqual([
      { pid: 32228, name: 'node.exe', cpuSeconds: 1 },
      { pid: 100, name: 'chrome.exe', cpuSeconds: 123 },
    ])
  })
  it('時數可超過 99', () => {
    const out = parseTasklistCsv([HEADER, row('System Idle Process', 0, '350:32:46')].join('\n'))
    expect(out[0].cpuSeconds).toBe(1261966)   // 350*3600 + 32*60 + 46
  })
  it('CPU Time 格式異常的列被略過', () => {
    const out = parseTasklistCsv([HEADER, row('bad.exe', 7, 'N/A'), row('ok.exe', 8, '0:00:05')].join('\n'))
    expect(out).toEqual([{ pid: 8, name: 'ok.exe', cpuSeconds: 5 }])
  })
  it('Window Title 內含逗號引號不影響前 8 欄', () => {
    const out = parseTasklistCsv([HEADER, row('node.exe', 9, '0:00:07', 'a","b')].join('\n'))
    expect(out).toEqual([{ pid: 9, name: 'node.exe', cpuSeconds: 7 }])
  })
  it('只有標頭 / 空字串 / 非字串 → null', () => {
    expect(parseTasklistCsv(HEADER)).toBe(null)
    expect(parseTasklistCsv('')).toBe(null)
    expect(parseTasklistCsv(null)).toBe(null)
    expect(parseTasklistCsv(undefined)).toBe(null)
    expect(parseTasklistCsv('完全不是 CSV')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/procscan.test.mjs`
Expected: FAIL —「Failed to load ../src/procscan.mjs」（檔案不存在）。

- [ ] **Step 3: Write minimal implementation**

建立 `leon-statusline/src/procscan.mjs`：

```js
// tasklist /v /fo csv 共 9 欄，只取 Image Name(0) / PID(1) / CPU Time(7)
const CPU_RE = /^(\d+):([0-5]\d):([0-5]\d)$/

export function parseTasklistCsv(text) {
  if (typeof text !== 'string') return null
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length < 2 || line[0] !== '"' || line[line.length - 1] !== '"') continue
    const f = line.slice(1, -1).split('","')
    if (f.length < 8) continue
    if (f[0] === 'Image Name') continue            // 標頭
    const pid = Number(f[1])
    if (!Number.isInteger(pid) || pid < 0) continue
    const m = CPU_RE.exec(f[7])
    if (!m) continue                               // CPU Time 為 N/A 或格式異常 → 略過該列
    rows.push({
      pid,
      name: f[0],
      cpuSeconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
    })
  }
  return rows.length ? rows : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/procscan.test.mjs`
Expected: PASS（5 個案例）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/procscan.mjs leon-statusline/tests/procscan.test.mjs
git commit -m "feat(procscan): tasklist CSV 解析（純函式）"
```

---

### Task 3: `sampleProcesses` — 平台分支與執行注入

**Files:**
- Modify: `leon-statusline/src/procscan.mjs`（新增 export）
- Test: `leon-statusline/tests/procscan.test.mjs`（新增 describe）

**Interfaces:**
- Consumes: `parseTasklistCsv`（Task 2）。
- Produces: `sampleProcesses({ exec?, platform? } = {}): Array<{pid,name,cpuSeconds}> | null` — 非 Windows、執行失敗、逾時、解析失敗一律回 `null`，不 throw。

- [ ] **Step 1: Write the failing test**

在 `leon-statusline/tests/procscan.test.mjs` 第 2 行 import 加入 `sampleProcesses`：

```js
import { parseTasklistCsv, sampleProcesses } from '../src/procscan.mjs'
```

在檔案末端新增：

```js
describe('sampleProcesses', () => {
  const csv = [HEADER, row('node.exe', 42, '0:00:10')].join('\n')

  it('Windows + 正常輸出 → 解析結果', () => {
    expect(sampleProcesses({ platform: 'win32', exec: () => csv }))
      .toEqual([{ pid: 42, name: 'node.exe', cpuSeconds: 10 }])
  })
  it('非 Windows → null，且完全不執行 exec', () => {
    let called = false
    const out = sampleProcesses({ platform: 'linux', exec: () => { called = true; return csv } })
    expect(out).toBe(null)
    expect(called).toBe(false)
  })
  it('exec 拋錯 → null，不往外拋', () => {
    expect(() => sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).not.toThrow()
    expect(sampleProcesses({ platform: 'win32', exec: () => { throw new Error('timeout') } })).toBe(null)
  })
  it('輸出無法解析 → null', () => {
    expect(sampleProcesses({ platform: 'win32', exec: () => '亂碼' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/procscan.test.mjs`
Expected: FAIL —「sampleProcesses is not a function」。

- [ ] **Step 3: Write minimal implementation**

在 `leon-statusline/src/procscan.mjs` 頂端加入 import：

```js
import { execFileSync } from 'node:child_process'
```

並在檔案末端新增：

```js
// 唯一與系統互動處。非 Windows 或任何失敗一律回 null（不 throw）
export function sampleProcesses({ exec, platform = process.platform } = {}) {
  if (platform !== 'win32') return null
  const run = exec || (() => execFileSync('tasklist', ['/v', '/fo', 'csv'], {
    encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  }))
  try {
    return parseTasklistCsv(run())
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/procscan.test.mjs`
Expected: PASS（9 個案例）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/procscan.mjs leon-statusline/tests/procscan.test.mjs
git commit -m "feat(procscan): sampleProcesses 平台分支與執行注入"
```

---

### Task 4: `classify` — 判定邏輯（純函式，本計畫核心）

**Files:**
- Create: `leon-statusline/src/runaway.mjs`
- Test: `leon-statusline/tests/runaway.test.mjs`

**Interfaces:**
- Produces:
  - `SCAN_INTERVAL_MS = 60_000`、`RATE_THRESHOLD = 0.5`、`CONSECUTIVE_REQUIRED = 5`
  - `classify(prev, sample, now, cfg?): { flagged: Array<{pid,name,rate}>, nextState: {t:number, procs:Object} | null }`
  - `prev` 形狀：`{ t: number, procs: { [pid]: { name: string, cpu: number, streak: number } } }`
  - `cfg`：`{ rateThreshold?, required? }`

> 連續 5 次「超標的區間」需要 **6 個樣本**（第 1 個只建立基準）。以 60 秒間隔計即「持續 5 分鐘」。

- [ ] **Step 1: Write the failing test**

建立 `leon-statusline/tests/runaway.test.mjs`：

```js
import { describe, it, expect } from 'vitest'
import { classify, CONSECUTIVE_REQUIRED } from '../src/runaway.mjs'

const MIN = 60_000
// 依序餵入多輪樣本，回傳最後一次的結果
const feed = (rounds) => {
  let state = null, last = null
  rounds.forEach(({ sample, t }) => {
    last = classify(state, sample, t, {})
    state = last.nextState
  })
  return last
}
// 每輪固定 cpu 增量的單一行程
const ramp = (pid, name, perRound, count) =>
  Array.from({ length: count }, (_, i) => ({ t: i * MIN, sample: [{ pid, name, cpuSeconds: i * perRound }] }))

describe('classify', () => {
  it('持續 1.0 核 → 第 6 個樣本（第 5 個區間）標記（tsserver 31832）', () => {
    const rounds = ramp(31832, 'node.exe', 60, CONSECUTIVE_REQUIRED + 1)
    const out = feed(rounds)
    expect(out.flagged).toEqual([{ pid: 31832, name: 'node.exe', rate: 1 }])
  })
  it('滿 5 個區間前不標記（邊界）', () => {
    const out = feed(ramp(31832, 'node.exe', 60, CONSECUTIVE_REQUIRED))
    expect(out.flagged).toEqual([])
  })
  it('持續 0.03 核 → 永不標記（健康的 tsserver 33452）', () => {
    const out = feed(ramp(33452, 'node.exe', 1.8, 10))
    expect(out.flagged).toEqual([])
  })
  it('連續 4 個區間超標後回落 → 計數歸零，不標記', () => {
    const rounds = [
      ...ramp(1, 'x.exe', 60, 5),                                  // 4 個超標區間
      { t: 5 * MIN, sample: [{ pid: 1, name: 'x.exe', cpuSeconds: 4 * 60 + 1 }] },  // 第 5 個區間僅 1 秒
      { t: 6 * MIN, sample: [{ pid: 1, name: 'x.exe', cpuSeconds: 4 * 60 + 61 }] }, // 再超標一次
    ]
    expect(feed(rounds).flagged).toEqual([])
  })
  it('短命 spinner：只出現一輪就消失 → 不標記，且不留在 nextState', () => {
    const out = feed([
      { t: 0, sample: [{ pid: 7, name: 'node.exe', cpuSeconds: 0 }] },
      { t: MIN, sample: [{ pid: 7, name: 'node.exe', cpuSeconds: 60 }] },
      { t: 2 * MIN, sample: [{ pid: 99, name: 'other.exe', cpuSeconds: 0 }] },
    ])
    expect(out.flagged).toEqual([])
    expect(out.nextState.procs[7]).toBeUndefined()
  })
  it('累計 CPU 變小（PID 重用）→ 計數歸零', () => {
    const rounds = [...ramp(5, 'a.exe', 60, 5), { t: 5 * MIN, sample: [{ pid: 5, name: 'a.exe', cpuSeconds: 0 }] }]
    const out = feed(rounds)
    expect(out.flagged).toEqual([])
    expect(out.nextState.procs[5].streak).toBe(0)
  })
  it('同 PID 但行程名不同 → 計數歸零', () => {
    const rounds = [...ramp(5, 'a.exe', 60, 5), { t: 5 * MIN, sample: [{ pid: 5, name: 'b.exe', cpuSeconds: 400 }] }]
    expect(feed(rounds).nextState.procs[5].streak).toBe(0)
  })
  it('首次執行（prev 為 null）→ 只建立基準', () => {
    const out = classify(null, [{ pid: 1, name: 'a.exe', cpuSeconds: 999 }], 1000, {})
    expect(out.flagged).toEqual([])
    expect(out.nextState).toEqual({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 999, streak: 0 } } })
  })
  it('時間未前進（時鐘異常）→ 原樣回傳 prev，不誤判', () => {
    const prev = { t: 5000, procs: { 1: { name: 'a.exe', cpu: 10, streak: 4 } } }
    const out = classify(prev, [{ pid: 1, name: 'a.exe', cpuSeconds: 9999 }], 5000, {})
    expect(out.flagged).toEqual([])
    expect(out.nextState).toBe(prev)
  })
  it('sample 為 null 或空陣列 → 保留 prev', () => {
    const prev = { t: 1, procs: {} }
    expect(classify(prev, null, 2, {}).nextState).toBe(prev)
    expect(classify(prev, [], 2, {}).nextState).toBe(prev)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runaway.test.mjs`
Expected: FAIL —「Failed to load ../src/runaway.mjs」。

- [ ] **Step 3: Write minimal implementation**

建立 `leon-statusline/src/runaway.mjs`：

```js
export const SCAN_INTERVAL_MS = 60_000
export const RATE_THRESHOLD = 0.5          // 核
export const CONSECUTIVE_REQUIRED = 5      // 連續超標區間數（以 60 秒間隔計＝持續 5 分鐘）

// 純函式：比對前後兩次快照，算區間速率，判定持續失控的行程
export function classify(prev, sample, now, cfg = {}) {
  const rateThreshold = cfg.rateThreshold ?? RATE_THRESHOLD
  const required = cfg.required ?? CONSECUTIVE_REQUIRED
  if (!Array.isArray(sample) || sample.length === 0) return { flagged: [], nextState: prev || null }

  const hasPrev = !!(prev && prev.procs && Number.isFinite(prev.t))
  const dtSec = hasPrev ? (now - prev.t) / 1000 : 0
  if (hasPrev && dtSec <= 0) return { flagged: [], nextState: prev }   // 時鐘異常，原樣保留

  const procs = {}
  const flagged = []
  for (const p of sample) {
    const before = hasPrev ? prev.procs[p.pid] : null
    let streak = 0, rate = 0
    if (before && before.name === p.name) {
      const delta = p.cpuSeconds - before.cpu
      if (delta >= 0) {                      // 變小＝PID 被重用，計數歸零
        rate = delta / dtSec
        streak = rate >= rateThreshold ? (before.streak || 0) + 1 : 0
      }
    }
    procs[p.pid] = { name: p.name, cpu: p.cpuSeconds, streak }
    if (streak >= required) flagged.push({ pid: p.pid, name: p.name, rate })
  }
  return { flagged, nextState: { t: now, procs } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runaway.test.mjs`
Expected: PASS（10 個案例）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/runaway.mjs leon-statusline/tests/runaway.test.mjs
git commit -m "feat(runaway): classify 以區間速率判定持續失控（純函式）"
```

---

### Task 5: `cache.mjs` 補跨 session 原子狀態檔

**Files:**
- Modify: `leon-statusline/src/cache.mjs`（新增兩個 export，不動既有）
- Test: `leon-statusline/tests/cache.test.mjs`（新增 describe）

**Interfaces:**
- Produces:
  - `readSharedState(name: string, dir?: string): object | null` — 缺檔／壞檔回 `null`。
  - `writeSharedState(name: string, obj: object, dir?: string): void` — 先寫暫存再 `rename`（原子），任何失敗靜默忽略。

> 不可沿用 `withCache`：它是 per-session（`cache-${sessionId}.json`），且 `fn()` 取不到前次值；而算速率必須有前次快照。

- [ ] **Step 1: Write the failing test**

`cache.test.mjs` 已在第 7–9 行以 `beforeEach`/`afterEach` 建好模組層級的暫存目錄 `dir`，直接沿用即可。

先把第 2 行的 fs import：

```js
import { mkdtempSync, rmSync } from 'node:fs'
```

改成：

```js
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
```

再把第 5 行：

```js
import { withCache } from '../src/cache.mjs'
```

改成：

```js
import { withCache, readSharedState, writeSharedState } from '../src/cache.mjs'
```

在檔案末端新增：

```js
describe('shared state', () => {
  it('寫入後可讀回', () => {
    writeSharedState('runaway-state', { t: 1, procs: { 9: { name: 'a', cpu: 2, streak: 3 } } }, dir)
    expect(readSharedState('runaway-state', dir)).toEqual({ t: 1, procs: { 9: { name: 'a', cpu: 2, streak: 3 } } })
  })
  it('缺檔 → null', () => {
    expect(readSharedState('nope', dir)).toBe(null)
  })
  it('壞 JSON → null', () => {
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    expect(readSharedState('broken', dir)).toBe(null)
  })
  it('寫入失敗不拋（目錄不存在）', () => {
    expect(() => writeSharedState('x', { a: 1 }, join(dir, 'no-such-dir'))).not.toThrow()
  })
  it('不留下暫存檔', () => {
    writeSharedState('runaway-state', { t: 1 }, dir)
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache.test.mjs`
Expected: FAIL —「readSharedState is not a function」。

- [ ] **Step 3: Write minimal implementation**

把 `leon-statusline/src/cache.mjs` 第 1 行：

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
```

改成：

```js
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
```

在檔案末端新增：

```js
// 跨 session 共用狀態（非 per-session）：失控偵測是全機層級，每 session 各存一份會重複掃描且反覆暖機
export function readSharedState(name, dir = cacheDir()) {
  try { return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) } catch { return null }
}

// 先寫暫存再 rename，保證原子性；多 session 併發時最後一個勝出，內容仍完整
export function writeSharedState(name, obj, dir = cacheDir()) {
  const file = join(dir, `${name}.json`)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(obj))
    renameSync(tmp, file)
  } catch {
    try { unlinkSync(tmp) } catch {}
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cache.test.mjs`
Expected: PASS（含既有 withCache 案例）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/cache.mjs leon-statusline/tests/cache.test.mjs
git commit -m "feat(cache): 跨 session 共用狀態檔（原子寫入）"
```

---

### Task 6: `detect` — 編排（節流 + 取樣 + 判定 + 持久化）

**Files:**
- Modify: `leon-statusline/src/runaway.mjs`（新增 export）
- Test: `leon-statusline/tests/runaway.test.mjs`（新增 describe）

**Interfaces:**
- Consumes: `classify`（Task 4）。
- Produces: `detect({ now, readState, writeState, sample, cfg? }): Array<{pid,name,rate}>` — I/O 全注入；未達間隔直接回快取結果；任何失敗回退為上次結果或空陣列。

> 狀態檔同時保存 `{t, procs, flagged}`，使節流期間仍能回傳上次判定。`classify` 只讀 `.t` 與 `.procs`，多出的 `flagged` 不影響它。

- [ ] **Step 1: Write the failing test**

在 `leon-statusline/tests/runaway.test.mjs` 第 2 行 import 加入 `detect` 與 `SCAN_INTERVAL_MS`：

```js
import { classify, detect, CONSECUTIVE_REQUIRED, SCAN_INTERVAL_MS } from '../src/runaway.mjs'
```

在檔案末端新增：

```js
describe('detect', () => {
  const flaggedOne = [{ pid: 1, name: 'a.exe', rate: 1 }]

  it('未達掃描間隔 → 不取樣，直接回快取的 flagged', () => {
    let sampled = false
    const out = detect({
      now: 1000 + SCAN_INTERVAL_MS - 1,
      readState: () => ({ t: 1000, procs: {}, flagged: flaggedOne }),
      writeState: () => { throw new Error('不該被呼叫') },
      sample: () => { sampled = true; return [] },
    })
    expect(out).toEqual(flaggedOne)
    expect(sampled).toBe(false)
  })
  it('達間隔 → 取樣、判定並寫入狀態', () => {
    let written = null
    const out = detect({
      now: 1000 + SCAN_INTERVAL_MS,
      readState: () => ({ t: 1000, procs: { 1: { name: 'a.exe', cpu: 0, streak: 4 } }, flagged: [] }),
      writeState: s => { written = s },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 60 }],
    })
    expect(out).toEqual([{ pid: 1, name: 'a.exe', rate: 1 }])
    expect(written.procs[1].streak).toBe(5)
    expect(written.flagged).toEqual(out)
  })
  it('取樣回 null → 沿用上次 flagged，且不寫入', () => {
    let written = false
    const out = detect({
      now: 10 * SCAN_INTERVAL_MS,
      readState: () => ({ t: 0, procs: {}, flagged: flaggedOne }),
      writeState: () => { written = true },
      sample: () => null,
    })
    expect(out).toEqual(flaggedOne)
    expect(written).toBe(false)
  })
  it('首次執行（無狀態）→ 空陣列並建立基準', () => {
    let written = null
    const out = detect({
      now: 5000,
      readState: () => null,
      writeState: s => { written = s },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 3 }],
    })
    expect(out).toEqual([])
    expect(written.t).toBe(5000)
  })
  it('readState 拋錯 → 視為無狀態，不往外拋', () => {
    expect(() => detect({
      now: 1, readState: () => { throw new Error('壞檔') },
      writeState: () => {}, sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }],
    })).not.toThrow()
  })
  it('writeState 拋錯 → 不往外拋，仍回傳判定結果', () => {
    const out = detect({
      now: 1, readState: () => null,
      writeState: () => { throw new Error('磁碟滿') },
      sample: () => [{ pid: 1, name: 'a.exe', cpuSeconds: 1 }],
    })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runaway.test.mjs`
Expected: FAIL —「detect is not a function」。

- [ ] **Step 3: Write minimal implementation**

在 `leon-statusline/src/runaway.mjs` 末端新增：

```js
// 編排：節流 → 取樣 → 判定 → 持久化。所有 I/O 由外部注入，故可完全測試
export function detect({ now, readState, writeState, sample, cfg = {} } = {}) {
  const interval = cfg.intervalMs ?? SCAN_INTERVAL_MS
  let state = null
  try { state = readState() } catch { state = null }
  const cached = state && Array.isArray(state.flagged) ? state.flagged : []

  if (state && Number.isFinite(state.t) && (now - state.t) < interval) return cached

  let s = null
  try { s = sample() } catch { s = null }
  if (!s) return cached                      // 取樣失敗：沿用上次結果，不更新狀態

  const { flagged, nextState } = classify(state, s, now, cfg)
  if (nextState) { try { writeState({ ...nextState, flagged }) } catch {} }
  return flagged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runaway.test.mjs`
Expected: PASS（16 個案例）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/runaway.mjs leon-statusline/tests/runaway.test.mjs
git commit -m "feat(runaway): detect 編排節流、取樣與持久化"
```

---

### Task 7: `renderLine5` + `buildOutput` 整合

**Files:**
- Modify: `leon-statusline/src/render.mjs`（新增 `renderLine5`、`buildOutput` 加入第 5 行）
- Test: `leon-statusline/tests/render.test.mjs`（新增 describe + 補 buildOutput 案例）

**Interfaces:**
- Consumes: `deps.runaway?: () => Array<{pid,name,rate}> | null`（**可選**；未提供時回 `''`，故既有測試不受影響）。
- Produces: `renderLine5(d, deps): string` — 無標記回 `''`。

> `buildOutput` 既有收尾 `lines.filter(l => l && l.length)` 本就會濾掉空字串，故零噪音不需額外條件判斷。

- [ ] **Step 1: Write the failing test**

在 `leon-statusline/tests/render.test.mjs` 第 2 行 import 加入 `renderLine5`：

```js
import { renderLine1, renderLine2, renderLine3, renderLine4, renderLine5, buildOutput } from '../src/render.mjs'
```

在 `describe('buildOutput', …)` **之前**新增：

```js
describe('renderLine5 (失控行程守衛)', () => {
  it('無 deps.runaway → 空字串（既有呼叫端不受影響）', () => {
    expect(renderLine5({}, deps)).toBe('')
  })
  it('無標記 → 空字串（零噪音）', () => {
    expect(renderLine5({}, { ...deps, runaway: () => [] })).toBe('')
    expect(renderLine5({}, { ...deps, runaway: () => null })).toBe('')
  })
  it('1 筆 → 顯示數量、名稱、PID 與速率', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [{ pid: 31832, name: 'node.exe', rate: 0.857 }] }))
    expect(out).toContain('⚠ runaway:1')
    expect(out).toContain('node.exe(31832) 0.86c')
  })
  it('3 筆 → 只列 2 筆並帶 +1', () => {
    const out = strip(renderLine5({}, { ...deps, runaway: () => [
      { pid: 1, name: 'a.exe', rate: 1 }, { pid: 2, name: 'b.exe', rate: 1 }, { pid: 3, name: 'c.exe', rate: 1 },
    ] }))
    expect(out).toContain('⚠ runaway:3')
    expect(out).toContain('a.exe(1) 1.00c')
    expect(out).toContain('b.exe(2) 1.00c')
    expect(out).not.toContain('c.exe(3)')
    expect(out).toContain('+1')
  })
  it('runaway 拋錯 → 空字串，不往外拋', () => {
    expect(renderLine5({}, { ...deps, runaway: () => { throw new Error('壞了') } })).toBe('')
  })
})
```

在 `describe('buildOutput', …)` 內末端新增：

```js
  it('有失控行程 → 變成 5 行；無則維持 4 行', () => {
    const d = { model: { display_name: 'Opus' } }
    expect(strip(buildOutput(d, deps)).split('\n').length).toBe(4)
    const withWarn = { ...deps, runaway: () => [{ pid: 1, name: 'a.exe', rate: 1 }] }
    const lines = strip(buildOutput(d, withWarn)).split('\n')
    expect(lines.length).toBe(5)
    expect(lines[4]).toContain('⚠ runaway:1')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.mjs`
Expected: FAIL —「renderLine5 is not a function」。

- [ ] **Step 3: Write the implementation**

在 `leon-statusline/src/render.mjs` 第 5–6 行的顏色常數區已有 `RED`，無須新增。在 `buildOutput` **之前**新增：

```js
// 第 5 行：僅在偵測到持續失控的行程時出現；否則回 ''，由 buildOutput 的 filter 自動略過
export function renderLine5(d, deps) {
  let flagged = null
  try { flagged = deps.runaway ? deps.runaway() : null } catch { flagged = null }
  if (!Array.isArray(flagged) || flagged.length === 0) return ''
  const shown = flagged.slice(0, 2).map(f => `${f.name}(${f.pid}) ${f.rate.toFixed(2)}c`).join(', ')
  const extra = flagged.length > 2 ? ` +${flagged.length - 2}` : ''
  return joinLine([
    colorize(`⚠ runaway:${flagged.length}`, RED),
    colorize(shown + extra, RED),
  ])
}
```

把 `buildOutput` 的第 100 行：

```js
  const lines = [renderLine1(d, deps), renderLine2(d, deps), renderLine3(d, deps), renderLine4(d, deps)]
```

替換為：

```js
  const lines = [renderLine1(d, deps), renderLine2(d, deps), renderLine3(d, deps), renderLine4(d, deps), renderLine5(d, deps)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS 全部（既有「renders 4 non-empty lines」「empty d 仍輸出完整 4 行」因 `deps` 無 `runaway` 而維持 4 行）。

- [ ] **Step 5: Commit**

```bash
git add leon-statusline/src/render.mjs leon-statusline/tests/render.test.mjs
git commit -m "feat(render): renderLine5 條件式失控警告（無異常時零噪音）"
```

---

### Task 8: 進入點注入 `deps.runaway` + bump 1.5.0

**Files:**
- Modify: `leon-statusline/statusline.mjs`（import + deps 注入）
- Modify: `leon-statusline/.claude-plugin/plugin.json`（`version` → `1.5.0`、`description`）
- Test: `leon-statusline/tests/integration.test.mjs`（不改內容，跑全套驗證）

**Interfaces:**
- Consumes: `sampleProcesses`（Task 3）、`detect`（Task 6）、`readSharedState`/`writeSharedState`（Task 5）。
- Produces: `deps.runaway: () => Array<{pid,name,rate}>`，供 `renderLine5`（Task 7）使用。

- [ ] **Step 1: Edit imports**

把 `leon-statusline/statusline.mjs` 第 6–8 行：

```js
import { countInfra, readJson } from './src/count.mjs'
import { withCache } from './src/cache.mjs'
import { autoCompactThreshold, autoCompactWindow } from './src/compact.mjs'
```

替換為：

```js
import { countInfra, readJson } from './src/count.mjs'
import { withCache, readSharedState, writeSharedState } from './src/cache.mjs'
import { autoCompactThreshold, autoCompactWindow } from './src/compact.mjs'
import { sampleProcesses } from './src/procscan.mjs'
import { detect } from './src/runaway.mjs'
```

- [ ] **Step 2: 注入 deps.runaway**

把 `leon-statusline/statusline.mjs` 的：

```js
      autoCompactThreshold: autoCompactThreshold(),
      autoCompactWindow: autoCompactWindow([userSettings]),
    }
```

替換為：

```js
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
```

- [ ] **Step 3: Run full suite to verify no break**

Run: `npx vitest run`
Expected: PASS 全部（`integration.test.mjs` 以子程序跑真實進入點：空/壞 JSON 仍 exit 0；本機無失控行程時輸出仍為 4 行）。

- [ ] **Step 4: Bump 版本與描述**

把 `leon-statusline/.claude-plugin/plugin.json` 的：

```json
  "version": "1.4.1",
  "description": "Cross-platform 4-line Claude Code status line",
```

改成：

```json
  "version": "1.5.0",
  "description": "Cross-platform 4-line Claude Code status line (+1 line when a runaway process is detected)",
```

- [ ] **Step 5: Smoke test 進入點（手動）**

Run（在 `leon-statusline/`，PowerShell）：
```
'{"model":{"display_name":"Opus"},"workspace":{"current_dir":"."}}' | node statusline.mjs
```
Expected: 印出 4 行、exit 0（首次執行只建立基準，必不顯示第 5 行）。再跑一次確認狀態檔已生成：
```
powershell -NoProfile -Command "Get-Content \"$env:USERPROFILE\.claude\leon-statusline\runaway-state.json\" | Select-Object -First 1"
```
Expected: 印出含 `\"t\":` 與 `\"procs\":` 的 JSON，且同目錄無 `.tmp` 殘留。

- [ ] **Step 6: Commit**

```bash
git add leon-statusline/statusline.mjs leon-statusline/.claude-plugin/plugin.json
git commit -m "feat(statusline): 進入點注入失控行程守衛 + bump 1.5.0"
```

---

### Task 9: 文件對齊（attributes / journal / pitfalls / CODE_MAP）

**Files:**
- Modify: `resources/statusline-attributes.md`
- Modify: `resources/development-journal.md`
- Modify: `resources/pitfalls.md`
- Modify: `leon-statusline/CODE_MAP.md`

> 純文件，無測試。逐檔改好後一次 commit。Task 1 記錄的 A/B 數據要填進 journal。

- [ ] **Step 1: `statusline-attributes.md` 新增第 5 行章節**

在檔案末端新增：

```markdown
## 第 5 行（條件式）：失控行程守衛

| 屬性 | 格式 | 觸發 |
|---|---|---|
| runaway | `⚠ runaway:N` + 最多 2 筆 `名稱(PID) X.XXc`，超出以 `+M` 表示（全紅） | 僅在偵測到持續失控的行程時出現；否則整行為 `''`，由 `buildOutput` 的 filter 略過 |

判定：`速率(核) = (本次累計CPU秒 − 上次累計CPU秒) ÷ 間隔秒`；同一 PID 連續 5 次 ≥ 0.5 核才標記（間隔 60 秒，即持續 5 分鐘）。
取樣來源 `tasklist /v /fo csv`，狀態存於 `~/.claude/leon-statusline/runaway-state.json`（跨 session 共用、原子寫入）。
只警告，絕不終止或改優先權。非 Windows 不顯示此行。
```

- [ ] **Step 2: `development-journal.md` 版本沿革加列**

在版本沿革表 `| 1.4.1 |` 列下新增：

```
| 1.5.0 | 新增失控行程守衛：條件式第 5 行，以區間速率判定持續失控的行程並警告（只警告不動手）；併同修正 win-lsp 的 tsserver 自動型別擷取風暴 |
```

- [ ] **Step 3: `development-journal.md` 新增 §14**

在 §13 之後、`## 版本沿革` 之前新增（把 `<A>` / `<B>` 換成 Task 1 Step 2–3 實際量到的數字）：

```markdown
---

## 14. v1.5.0：失控行程守衛 + tsserver 空轉根治

- 症狀：兩天內兩起背景程序吃光 CPU，皆為事後人工調查才發現。其一為 `sat.sh` 的 spinner 未回收（腳本缺陷，已另修）；其二為兩個 `tsserver` 各佔滿一顆核心達 15 小時。
- 根因（systematic-debugging）：I/O 增量為 0 而 CPU 滿載 → 純運算迴圈。`Debugger.pause` 取得堆疊 `FSWatcher.onchange → … → scheduleInvalidateResolutionOfFailedLookupLocation`；CPU 熱點全為路徑正規化（`toFileNameLowerCase` / `normalizeSlashes` / `simpleNormalizePath`）。專案無 tsconfig/jsconfig/node_modules → inferred project → 模組解析上探至家目錄 → 監看沿途 failed lookup locations → Claude Code 持續寫入 `~/.claude/**`（30 秒 8 檔）→ 失效重算永不停止。
- 觸發點在設定層：`typescript-language-server` v5.3.0 `cli.mjs:19105` 僅在 `initializationOptions.disableAutomaticTypingAcquisition` 為真、或 kind 為 `syntax`/`diagnostics` 時才加旗標；win-lsp 未設 → partialSemantic 那隻有、全語意那隻沒有。
- A/B 實驗（`tools/ata-storm.mjs`，120 秒窗、家目錄 churn 8 檔/30 秒）：A 組（現況）<A> 秒 CPU；B 組（帶旗標）<B> 秒 CPU。判準 B ≤ A×0.2 且 B 速率 < 0.1 核。
- 修法：win-lsp typescript 加 `initializationOptions.disableAutomaticTypingAcquisition`；刪除家目錄殘留的空 `node_modules`。
- 守衛：`procscan.mjs`（tasklist 取樣）＋ `runaway.mjs`（`classify` 純判定 / `detect` 編排）＋ `cache.mjs` 跨 session 原子狀態檔 ＋ `renderLine5`。判定用區間速率而非瞬時值或生涯平均 —— 生涯平均會把「先閒置後失控」稀釋掉（實測 tsserver 35132 生涯僅 0.25 核但當下 1.0 核）；瞬時值則無法區分刻意的高載實驗。短命 spinner 因 PID 每輪更換而結構性排除，無須白名單。
```

- [ ] **Step 4: `pitfalls.md` 新增第 12 條**

在檔案末端新增：

```markdown
## 12. `withCache` 是 per-session，跨 session 狀態不可沿用

`withCache(sessionId, …)` 寫的是 `cache-<sessionId>.json`，且 `fn()` 取不到前一次的值。
失控行程偵測是**全機層級**且需要前次快照來算速率，兩點都不符 —— 若硬套，會變成每個 session
各存一份、各自重複掃描，且每開一個新 session 都要重新暖機 5 分鐘。
故另立 `readSharedState`/`writeSharedState`（單一檔案、跨 session 共用、寫暫存再 rename）。
```

- [ ] **Step 5: `CODE_MAP.md` 更新**

在 `## src/（純函式邏輯，可獨立測）` 區塊的 `render.mjs` 那行**之前**插入兩行：

```
- `procscan.mjs` — `parseTasklistCsv`（純解析）/ `sampleProcesses`（`tasklist /v /fo csv`；非 Windows 或任何失敗回 null）
- `runaway.mjs` — `classify`（純函式，區間速率判定持續失控）/ `detect`（編排：節流→取樣→判定→持久化，I/O 全注入）
```

把 `cache.mjs` 那行改為：

```
- `cache.mjs` — `cacheDir` / `withCache`（`session_id` key、TTL、never-throw）/ `readSharedState`+`writeSharedState`（跨 session、原子寫入）
```

把 `render.mjs` 那行改為：

```
- `render.mjs` — `renderLine1..5` / `buildOutput`（第 5 行為條件式失控警告，無異常時回 '' 由 filter 略過）
```

把 `## tests/（Vitest，79 測試）` 的數字改為 `npx vitest run` 實際回報的測試總數。

- [ ] **Step 6: Commit**

```bash
git add resources/statusline-attributes.md resources/development-journal.md resources/pitfalls.md leon-statusline/CODE_MAP.md
git commit -m "docs: v1.5.0 失控行程守衛（attributes/journal §14/pitfalls 12/CODE_MAP）"
```

---

## 完成後

跑 `npx vitest run` 全綠 → 進 `superpowers:finishing-a-development-branch`：驗測試 → 選項（你慣例選「合回 main 本地」）→ push 另外問。

**觀察期驗收（spec §2 目標 3）**：合併後觀察 24 小時，狀態列不應出現任何誤報（維持 4 行）。若要主動驗證守衛有效，可跑一個持續超過 5 分鐘的滿載行程，確認第 5 行如期出現。

## Self-Review（已對 spec 核對）

- **Spec coverage**：§3.1 win-lsp 改動→Task 1 Step 5–6；§3.2 A/B 實驗→Task 1 Step 1–4；§3.3 生效證據與收尾條件→Task 1 Step 4、Step 7；§4.1 判定公式→Task 4；§4.2 參數→Task 4 常數 + Global Constraints；§4.3 回測→Task 4 測試案例；§4.4 PID 重用→Task 4 案例 6–7；§5.1 procscan→Task 2+3；§5.2 runaway→Task 4；§5.3 狀態檔（跨 session／原子／節流／觸發者）→Task 5 + Task 6 + Task 8；§5.4 renderLine5→Task 7；§5.5 注入→Task 8；§6 錯誤處理→Task 3/5/6/7 各含不拋案例；§7 測試→Task 2–7；§8 版本文件→Task 8 Step 4 + Task 9。無缺口。
- **Placeholder scan**：無 TBD/TODO；每個 code step 均附完整可貼上的程式碼。journal 的 `<A>`/`<B>` 是必須由 Task 1 實測填入的數據，已在 Task 9 Step 3 明示來源，非未定內容。
- **Type consistency**：`parseTasklistCsv(text) → {pid,name,cpuSeconds}[]|null` 與 `sampleProcesses` 回傳、`classify(prev, sample, now, cfg)` 的 `sample` 元素、`prev.procs[pid] = {name,cpu,streak}`、`detect` 注入的 `sample()`、`deps.runaway() → {pid,name,rate}[]`、`renderLine5` 讀取的 `f.name/f.pid/f.rate` 全鏈一致。狀態檔 `{t, procs, flagged}` 在 Task 5/6/8 三處寫法相同。
