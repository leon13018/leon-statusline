# 失控行程守衛（runaway process guard）— 設計文件

**日期**：2026-08-09
**版本目標**：leon-statusline **1.5.0**（minor；新增條件式第 5 行）
**前置**：無。本文件另含一項**本 repo 之外**的修正（`win-lsp` plugin），見 §3。

---

## 1. 問題（root cause）

2026-08-08 至 08-09 兩天內發生兩起背景程序吃光 CPU 的事件，成因完全不同，但共同點是**使用者只能事後靠人工調查才發現**。

### 1.1 事件二（本文主要根治對象）：tsserver 無限空轉

兩個 `tsserver` 行程各佔滿一顆核心，持續 15 小時無人察覺：

| PID | 啟動 | 累計 CPU | 平均佔用 |
|---|---|---|---|
| 31832 | 08-08 20:44 | 55,915 秒 | 0.86 核 |
| 35132 | 08-08 21:29 | 15,747 秒 | 0.25 核（當下 1.0 核） |

**證據鏈（四項獨立佐證）**：

1. **I/O 判別**：5 秒內 `CPU +4.98 秒、I/O 操作 +0、傳輸 +0KB` → 純運算迴圈，排除磁碟與檔案讀寫。
2. **堆疊取樣**（`process._debugProcess` + `Debugger.pause`）：
   `FSWatcher._handle.onchange → emit → … → scheduleInvalidateResolutionOfFailedLookupLocation → schedule → setTimeout`
3. **CPU 熱點分析**（5 秒取樣）：`toFileNameLowerCase` 7.5%、`schedule` 5.8%、`normalizeSlashes` 4.0%、`getEncodedRootLength` 2.9%、`scheduleInvalidateResolutionOfFailedLookupLocation` 1.8%，其餘散落於 `simpleNormalizePath` / `getNormalizedAbsolutePath` — 全部是**路徑正規化**。
4. **環境**：`Desktop` 下 11 個含 JS 的專案，**9 個同時無 tsconfig / jsconfig / node_modules**；而 `C:\Users\LIN HONG\node_modules` **存在**（僅含空的 `.bin`，0 MB，2026-06-27，家目錄無 package.json）。

**因果鏈**：專案無設定檔 → tsserver 走 inferred project → 專案無 node_modules，模組解析沿祖先目錄上探 → 觸及家目錄層 → TypeScript 監看沿途所有 failed lookup locations → Claude Code 持續寫入 `~/.claude/**`（實測 30 秒 8 檔）→ 每次寫入觸發一次失效重算 → 因寫入永不停止，故空轉永不停止。

**觸發條件已定位到設定層**：`typescript-language-server` v5.3.0 的 `cli.mjs:19105` 僅在 `initializationOptions.disableAutomaticTypingAcquisition` 為真、或 server kind 為 `syntax`/`diagnostics` 時，才對 tsserver 加上 `--disableAutomaticTypingAcquisition`。而 `win-lsp` 的 typescript 項目未設此選項 → partialSemantic 那隻自動有旗標、**全語意那隻沒有** → 自動型別擷取沿祖先目錄大量探測 `@types/*`，正是失敗查找位置的來源。現場亦觀察到 `typingsInstaller.js` 在跑，與此一致。

### 1.2 事件一（不修，但用於校準偵測規則）：飽和測試 spinner

`sat.sh` 每輪生成 18 個滿載 spinner、測完立即回收。**這是刻意且正確的行為**，任何偵測規則都不得把它判為失控。它是本設計最重要的負向案例。

---

## 2. 目標

1. **消除成因**：tsserver 不再因祖先目錄探測而無限空轉，且涵蓋未來新開的專案。
2. **及早發現**：任何行程持續失控時，狀態列主動顯示，不必等使用者察覺卡頓後人工調查。
3. **零噪音**：無異常時狀態列與現況完全一致。
4. **絕不動手**：只警告，不終止、不改優先權。
5. 永不崩潰、零執行期依賴不變。

---

## 3. Part 1：消除成因（`win-lsp`，本 repo 之外）

### 3.1 改動

`C:\Users\LIN HONG\.claude\local-plugins\win-lsp\plugin\.claude-plugin\plugin.json` 的 `typescript` 項目新增：

```json
"initializationOptions": { "disableAutomaticTypingAcquisition": true }
```

並刪除殘骸 `C:\Users\LIN HONG\node_modules`（空目錄，僅含 `.bin`）。

### 3.2 驗證實驗（A/B 對照）

**必要性**：光刪除殘骸不見得充分 —— TypeScript 對不存在的 failed lookup 路徑，是靠監看**最近的存在祖先**來等它出現；刪掉 `node_modules` 後，它仍可能繼續監看家目錄等其重新出現。此假設必須實測，不得推論。

**腳本**：`win-lsp/tests/ata-storm.mjs`（新目錄）

1. 於**系統暫存區**建 scratch 專案（不污染家目錄）：單一 `.mjs`，內含 bare import。
2. 起 `typescript-language-server`（stdio），送 `initialize` + `didOpen`。
3. 等待其 `tsserver` 子行程出現並記錄 PID。
4. 於 `~/.claude/.ata-probe/` 以**實測速率（8 檔 / 30 秒）**持續寫檔 **120 秒**，模擬真實 churn。
5. 每 10 秒記錄該 tsserver 的累計 CPU。
6. 結束後刪除 churn 目錄與 scratch 專案、終止所起的 LSP。

**A 組**＝現行設定；**B 組**＝`disableAutomaticTypingAcquisition: true`。

**判準（事先寫死，不得事後放寬）**：
B 組 120 秒窗內累積 CPU **≤ A 組的 20%**，且 B 組平均速率 **< 0.1 核**。

### 3.3 生效證據與收尾條件

- **生效證據**：改設定並重啟 LSP 後，實際 tsserver 命令列應出現 `--disableAutomaticTypingAcquisition`（前後命令列可直接比對）。
- **收尾條件**：若 B 組未達判準，才為 9 個裸專案補 `jsconfig.json`（明確 `include` / `exclude` / `typeAcquisition.enable:false`），並**重跑同一支實驗**確認。這是本方案的收尾步驟，不是重做。

---

## 4. Part 2：行為規格（偵測規則）

### 4.1 判定公式

瞬時 CPU% **無法**分辨好壞（失控的 tsserver 與正當的 spinner 都是 100%），故一律以**區間速率**判定：

```
rate(核) = (本次累計CPU秒 − 上次累計CPU秒) ÷ 兩次掃描間隔秒
同一 PID 連續 CONSECUTIVE_REQUIRED 次 rate ≥ RATE_THRESHOLD → 標記為失控
```

### 4.2 參數

| 常數 | 值 | 理由 |
|---|---|---|
| `SCAN_INTERVAL_MS` | 60_000 | statusline 每 10 秒刷新，掃描須節流 |
| `RATE_THRESHOLD` | 0.5（核） | 低於半顆核的長期佔用不值得打擾 |
| `CONSECUTIVE_REQUIRED` | 5 | 等同「持續 5 分鐘」，短暫正當高載不誤報 |

### 4.3 回測（以 2026-08-09 實測數據）

判定用的是**區間速率**，故下表以實測區間速率為準；生涯平均僅供對照。

| 案例 | 實測區間速率 | 生涯平均 | 存活 | 判定 | 期望 |
|---|---|---|---|---|---|
| tsserver 31832 | 1.0 核（5 次取樣 96–104%；另 5 秒窗 CPU +4.98 秒） | 0.86 核 | 18 小時 | 標記 | ✅ |
| tsserver 35132 | 1.0 核（5 次取樣 93–103%） | 0.25 核 | 17 小時 | 標記 | ✅ |
| tsserver 33452（健康） | 0–0.05 核 | 0.03 核 | 4.4 小時 | 不標記 | ✅ |
| sat.sh spinner | 1.0 核 | — | 19 秒 | 不標記 | ✅ |
| MCP servers | ≈0 | ≈0 | 1 天 | 不標記 | ✅ |

註：35132 的生涯平均 0.25 核低於門檻，但區間速率是 1.0 核 —— 這正是**不能用生涯平均判定**的理由：行程可能先閒置很久才開始失控，生涯平均會把它稀釋掉。

spinner 是**結構性**被排除的 —— 每輪回收重生、PID 皆不同，本就撐不過連續 5 次掃描。因此**不需要任何白名單**，未來所有「短命但滿載」的正當工作都自動放行。

### 4.4 PID 重用

新行程累計 CPU 由 0 起算，故差值為負即代表 PID 被重用 → 重置該 PID 的連續計數。行程名不同亦同樣重置。

---

## 5. 架構 / 模組（沿用現有慣例：小模組、I/O 注入 deps、一對一測試）

### 5.1 `src/procscan.mjs`（副作用層，薄）

唯一與系統互動處。`sampleProcesses()` 執行 `tasklist /v /fo csv`，解析為
`[{ pid: number, name: string, cpuSeconds: number }]`。

- 非 Windows（`platform !== 'win32'`）→ 回傳 `null`。
- 逾時上限 3 秒；失敗、逾時、解析錯誤一律回 `null`（不拋）。
- **可測性**：比照本 repo 的 DI 慣例，簽章為 `sampleProcesses({ exec, platform } = {})`，預設值取自真實環境。純解析邏輯另拆為 export 的 `parseTasklistCsv(text)`，使 CSV 解析與平台分支能在 Windows 上直接測試，無須真的執行 `tasklist`。

### 5.2 `src/runaway.mjs`（純函式，不碰 fs / 不 spawn）

```js
export const SCAN_INTERVAL_MS = 60_000
export const RATE_THRESHOLD = 0.5
export const CONSECUTIVE_REQUIRED = 5

// prev: 上次狀態（或 null）；sample: procscan 的輸出；now: epoch ms
// 回傳 { flagged: [{pid, name, rate}], nextState }
export function classify(prev, sample, now, cfg = {}) { /* … */ }
```

規則：
- `prev` 缺或無 `prev.t` → 僅建立基準，`flagged` 為空。
- 間隔 `dtSec <= 0`（時鐘異常）→ 原樣回傳 `prev`，不誤判。
- 每個 PID：名稱不符或差值為負 → `streak = 0`；否則 `streak = rate >= 門檻 ? streak+1 : 0`。
- `streak >= CONSECUTIVE_REQUIRED` → 進 `flagged`。
- 本次 sample 中消失的 PID 自動從 `nextState` 移除。

### 5.3 狀態檔（跨 session 共用）

**不可沿用 `cache.mjs` 的 `withCache`**：其一為 per-session（`cache-${sessionId}.json`），其二 `fn()` 取不到前次值，而算速率必須有前次快照。

- 位置：`cacheDir()`（沿用 `cache.mjs` 既有 export）下的 `runaway-state.json`，**單一檔案跨所有 session 共用**。
- 理由：失控是全機層級；若每 session 各存一份，每開新 session 都要重新暖機 5 分鐘且重複掃描。
- 寫入：先寫暫存檔再 `rename`，保證原子性。多 session 併發時最後一個勝出，內容仍完整。
- **觸發者**：不另起常駐行程或排程。掃描由 statusline 自身的刷新驅動 —— 每次刷新先讀狀態檔，僅在 `now - state.t >= SCAN_INTERVAL_MS` 時才實際執行一次掃描並更新狀態檔。
- 節流：未達間隔即直接沿用既有結果，不掃描。故 statusline 每 10 秒刷新中，最多每 6 次才有 1 次付出 `tasklist` 的成本（實測 50–100ms）。

### 5.4 `src/render.mjs`：新增 `renderLine5`

`buildOutput` 現行收尾為 `lines.filter(l => l && l.length).join('\n')`，**本就會濾掉空字串**。故：

- 無標記 → `renderLine5` 回 `''` → 狀態列與現況逐字元相同（零噪音由既有架構免費提供，無需額外條件判斷）。
- 有標記 → 回 RED 色的一行：`⚠ runaway:N` 後接最多 2 筆 `name(pid) X.XXc`，超出以 `+M` 表示。

### 5.5 `statusline.mjs`：注入

比照既有 `deps.git` / `deps.counts` / `deps.now`，新增 `deps.runaway()`，回傳 `flagged` 陣列或 `null`。測試可完全 mock。

---

## 6. 錯誤處理 / 永不崩潰

**首要原則：偵測失敗絕不拖累顯示。** statusline 的本職是顯示，偵測是附加功能。

- `tasklist` 失敗／逾時／非 Windows → `sampleProcesses()` 回 `null` → 沿用上次結果，不更新狀態檔，不顯示警告。
- 狀態檔毀損或 JSON 解析失敗 → 視同無前次狀態，重建基準。
- 狀態檔寫入失敗 → 靜默忽略（下次掃描重試）。
- `classify` 為純函式且對缺值全部回退，不拋例外。
- 進入點維持 `process.exit(0)`、至少印一行。

---

## 7. 測試（TDD 先紅後綠）

**`tests/runaway.test.mjs`（新增）** — 全部使用 §4.3 的真實數據：

1. 連續 5 次 0.86 核 → 標記（tsserver 31832）。
2. 持續 0.03 核 → 不標記（健康的 tsserver）。
3. 僅出現 1 次即消失 → 不標記（spinner）。
4. 連續 4 次超標後回落 → 不標記（門檻邊界）。
5. 差值為負 → 重置連續計數（PID 重用）。
6. 行程名不符 → 重置連續計數。
7. `prev` 為 null → 僅建立基準，`flagged` 為空。
8. `dtSec <= 0` → 原樣回傳，不誤判。
9. 消失的 PID 不留在 `nextState`。

**`tests/procscan.test.mjs`（新增）**：CSV 解析（含含逗號的行程名、`N/A` 的 CPU 欄）；`hh:mm:ss` 轉秒；非 Windows 回 `null`；壞輸出回 `null` 不拋。

**`tests/render.test.mjs`（補）**：`deps.runaway()` 回 `[]`／`null` → 第 5 行為 `''` 且總行數維持 4；回 1 筆 → 出現 `⚠ runaway:1`；回 3 筆 → 只列 2 筆並帶 `+1`。既有「永不隱藏」回歸測試須保持綠。

**`tests/integration.test.mjs`（補）**：無異常時輸出仍為 4 行、exit 0、空／壞 JSON 不崩。

**Part 1**：非單元測試，依 §3.2 的 A/B 實驗與 §3.3 的命令列生效證據。

---

## 8. 版本 / 文件

- bump `leon-statusline/.claude-plugin/plugin.json` → **1.5.0**。
- plugin `description`：`4-line` 改為「4 行 + 失控時附加第 5 行」。
- `resources/statusline-attributes.md`：新增第 5 行章節（觸發條件、參數、顯示格式）。
- `resources/development-journal.md`：版本沿革加 1.5.0，新增一節記錄 §1 的完整證據鏈。
- `resources/pitfalls.md`：新增「`withCache` 是 per-session，跨 session 狀態不可沿用」。
- `leon-statusline/CODE_MAP.md`：加入 `procscan.mjs`、`runaway.mjs`。

---

## 9. 非目標（YAGNI）

- **不自動終止、不調整優先權、不隔離**任何行程 —— 只警告。誤殺不可逆，且今日的 `sat.sh` 實驗正是會被誤殺的反例。
- **不支援 Windows 以外平台**：`sampleProcesses()` 於非 Windows 回 `null`，第 5 行不顯示。跨平台承諾不破壞（行為與現況相同），但該平台無此保護。
- **不做白名單／程式名例外** —— §4.3 已證明結構性排除即足夠。
- 不記錄歷史、不畫趨勢、不推播通知。
- 不偵測記憶體洩漏或控制代碼洩漏，只看 CPU。
- 不為 9 個裸專案預先補 `jsconfig.json` —— 僅在 §3.3 收尾條件成立時才做。
