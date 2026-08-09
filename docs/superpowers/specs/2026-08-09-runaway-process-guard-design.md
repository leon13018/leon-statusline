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

**腳本**：`tools/ata-storm.mjs`

> **本節經三次修訂才得出可用的實驗方法**，脈絡記錄於此，避免後人重蹈：
>
> 1. **初版**：於系統暫存區建合成 scratch 專案（單一 `.mjs`、一個 bare import），churn 120 秒，量單一 tsserver 行程的 CPU。
>    → A 組實測僅 **0.009 核**，等同閒置，**未重現空轉**；A/B 淪為雜訊比雜訊。
> 2. **二版**：改用真實受害專案 `wlc-timerleak` 當 root（47 個 `.mjs`、無任何專案設定檔）、didOpen 前 10 個真實檔、CPU 改量**整棵行程樹**（初版漏掉獨立的 `typingsInstaller.js` 子行程）、加 20 秒暖機、觀測窗延長至 180 秒。
>    → A 組實測 **0.003 核**，**仍未重現**。
> 3. **三版（現行）**：查出真因 —— `initialize` 送的 `capabilities` 是**空物件 `{}`**（初版簡報就寫錯，兩版一路照抄）。客戶端未宣告任何 `textDocument` 能力，server 的診斷管線從未啟動，tsserver 開檔後直接待機、**從未真正解析模組**，前兩版量到的都是一個「半睡」的行程。
>    修正 `capabilities` 後診斷正常送達（251 則 `publishDiagnostics` / 10 檔），並改以 `didChange` 注入無解析 bare import 當主驅動。
>    → A 組實測 **0.173 核**，**首次成功重現**。

**實驗步驟（三版）**：

1. 以真實受害專案為 root：`~/Desktop/wlc-timerleak`（唯讀，腳本只讀不寫；`didChange` 僅改 LSP 記憶體內文件版本，不落地）。
2. 起 `typescript-language-server`（stdio），送 `initialize`，**`capabilities` 必須包含 `textDocument.synchronization` 與 `textDocument.publishDiagnostics`**（否則診斷管線不啟動，見上方修訂三）。
3. 遞迴取前 **10 個 `.mjs`**（每層字典序，確保兩組開同一批），讀真實內容送 `didOpen`。
4. 等待全語意 `tsserver` 子行程出現（排除 `partialSemantic` 那隻）並記錄 PID。
5. **暖機 20 秒**：不驅動、不計時，讓初次索引沉澱。
6. **主觀測窗 180 秒**，兩種驅動同時開啟，A/B 兩組驅動條件完全一致：
   - `didChange`：每 1.5 秒送一次，每次注入一個全新的、必然無法解析的 bare import。
   - churn：於 `~/.claude/.ata-probe/` 以實測速率（8 檔 / 30 秒）持續寫檔。
7. CPU 量測對象為「該 tsserver **及其所有子孫行程**」的總和，**每次量測都重新展開** `ParentProcessId`（過程中可能長出新子行程，如 `typingsInstaller.js`）。
8. **收尾觀測窗 60 秒**（資訊性，不進判準）：停掉 `didChange`、只留 churn，記為 `churnOnlyRateCores`。此時 tsserver 已真正解析過模組、監看器已註冊，這個數字才有意義。
9. 結束後刪除 churn 目錄、終止所起的 LSP。

**前置檢查（寫進腳本輸出，不靠人眼判斷）**：

- `diagnosticsFilesReceived` 為空 → **BLOCKED**（`capabilities` 未生效，比較無意義），exit code 4。
- A 組 `rateCores < 0.05` → `reproduced: false`，**BLOCKED 且不得續跑 B 組**（未重現空轉，A/B 比較無意義），exit code 3。

**A 組**＝現行設定；**B 組**＝`disableAutomaticTypingAcquisition: true`。

**判準（事先寫死，不得事後放寬）**：
B 組 180 秒窗內累積 CPU **≤ A 組的 20%**，且 B 組平均速率 **< 0.1 核**。

**關於 churn 的實測補充**（2026-08-09，三版腳本）：
在**已正常運作**的 tsserver 上（診斷已送達、失敗查找監看已註冊），停掉 `didChange` 只留 churn 的
60 秒窗實測為 **A 組 0.003 核 / B 組 0.001 核**，相對主窗的 0.173 / 0.134 幾乎沒有貢獻。
即：**在本機這支 probe 中，主導 CPU 的是編輯流量（重複的模組解析與診斷重算），而非家目錄檔案 churn。**
但這**不推翻** §1 的 production 診斷 —— 該診斷抓到的堆疊
`FSWatcher._handle.onchange → scheduleInvalidateResolutionOfFailedLookupLocation`
是真實檔案系統事件觸發的。合理解釋是本 probe 的 churn 目錄未落在 production 實際被監看的
失敗查找位置上。churn 在 production 的貢獻度，本實驗**未能量到，亦未否證**。

### 3.3 生效證據與收尾條件

- **生效證據**：改設定並重啟 LSP 後，實際 tsserver 命令列應出現 `--disableAutomaticTypingAcquisition`（前後命令列可直接比對）。
  - ⚠️ 比對時只看**全語意** tsserver。`--serverMode partialSemantic` 那幾隻**本來就帶這個旗標**（TypeScript 對部分語意 server 預設關閉 ATA），不能拿來當本改動生效的證據。
- **收尾條件**：若 B 組未達判準，才為 9 個裸專案補 `jsconfig.json`（明確 `include` / `exclude` / `typeAcquisition.enable:false`），並**重跑同一支實驗**確認。這是本方案的收尾步驟，不是重做。

### 3.4 結案紀錄（2026-08-09）：**判準未通過，經使用者授權越過閘門後套用**

> **本節必須誠實閱讀：Part 1 不是「驗收通過」，是「未達標但經明示授權仍予套用」。**

**1. 判準未通過（事實）**

| | A 組（現況） | B 組（帶旗標） | 判準要求 |
|---|---|---|---|
| `cpuSeconds`（180 秒窗） | 31.17 | 24.09 | ≤ 6.234（A×0.2） ❌ |
| `rateCores` | 0.173 | 0.134 | < 0.1 ❌ |

實際降幅 **22.7%**（B/A = 0.773），要求是**降到 20% 以下**。**兩條件皆未達標。**

**2. 仍予套用的理由（使用者裁決）**

- **旗標生效有硬證據**：B 組行程樹只有 tsserver 一隻，**`typingsInstaller.js` 子行程完全沒有被生成**（A 組有）。這不是「設定沒吃到」。
- **功能損失：7/9 趨近於零，2/9 有實質損失**（經全樹掃描實測後**下修**，先前兩版措辭均過於樂觀）。

  > **撰寫規則（因本節連續兩次寫出假的全稱句而訂立）**：任何量化或全稱敘述（「皆」「全數」「都」「N 個」）
  > 寫進本文件前，**必須先以全樹掃描實測**，並在句中**明確標出範圍**（根目錄 / 全樹 / 某子目錄）。
  > 驗不到的，就不要寫成全稱 —— 改寫成「已驗證的範圍 ＋ 已知例外」。

  **已實測為真（範圍：9 個裸專案的根目錄）**：9 個根目錄皆無 `package.json`、無 `tsconfig`/`jsconfig`、
  無 `node_modules`。故**根層級**沒有依賴宣告可供 ATA 解析。

  **已實測為真（範圍：9 個裸專案全樹）**：

  | 事實 | 實測值 |
  |---|---|
  | 全樹存在 `node_modules` 的專案 | **2 個**：`資料視覺`（8 個 `node_modules` 目錄）、`leon-statusline`（1 個） |
  | 全樹存在既有 `@types/*` 的專案 | **2 個**：`資料視覺/graph-ui`（**16 個**：aria-query、babel__core、chai、react、three 等）、`leon-statusline/leon-statusline`（**3 個**：chai、deep-eql、estree） |
  | 深層 `package.json`（排除 `node_modules`）的專案 | 7 個 |
  | 深層 `package.json` **是被編輯 `.mjs` 的祖先** | **有**：`leon-statusline/leon-statusline/package.json` 是本 repo **21 個 `.mjs`** 的直接祖先（`statusline.mjs`、`src/*.mjs`、`tests/*.test.mjs`、`setup.mjs`）—— 即**我們此刻正在編輯的檔案** |

  **因此以下三句均為假，不可再使用**（前一版誤寫，已作廢）：
  ~~「9 個專案皆無 `package.json`」~~、~~「9 個專案全數無 `node_modules`」~~、
  ~~「這些深層 `package.json` 都不在實際被編輯的 `.mjs` 的祖先鏈上」~~。

  **誠實的結論**：停用 ATA 對 **7/9** 專案功能損失趨近於零（無 `node_modules`、無既有 `@types/*`）；
  但對 **`資料視覺/graph-ui` 與 `leon-statusline/leon-statusline` 有實質損失** ——
  這兩者有現成的 `@types/*`，且後者正是本 repo 自身、其 `package.json` 就在被編輯檔案的祖先鏈上。
  **本條授權理由因此比原先弱。** 使用者的授權建立在**知情**、而非「零損失」之上。

  深層 `package.json` 的分布（排除 `node_modules`，全樹實測）：
  `wwwroot/package.json` 共 4 個，分屬 `倉儲辨識與前端系統` 與 3 個 `wlc-*` 專案
  （**非**先前所寫的「4 個 wlc-*」）；另有 `資料視覺/graph-ui`、`leon-statusline/leon-statusline`；
  `alexnet` 19 個中 **14 個**位於 `.venv/Lib/site-packages/jupyterlab/…`，
  其餘 5 個位於 `.venv` 下的 `playwright/driver/package/`、`share/jupyter/lab/static/`、
  `share/jupyter/labextensions/{@jupyter-notebook,@jupyter-widgets,jupyterlab_pygments}/`
  —— **19 個全數在 `.venv` 下**，「Python 虛擬環境內第三方資產」的性質描述成立，先前錯的是具體路徑。
- **仍省兩成**：22.7% 是真實可測的改善。
- **風險低且可逆**：單行設定，已備份為 `plugin.json.bak-2026-08-09`，還原成本近乎零。

**3. 本次驗證的侷限（重要，不得省略）**

- probe 以**每 1.5 秒一次、連續 3 分鐘**的編輯驅動，強度遠高於真人編輯。在此強度下，
  B 組的 0.134 核**較接近「正常工作」而非病態** —— 這個數字不宜解讀為「仍然失控」。
- production 的病態形狀是**無人編輯、卻連續燒 15 小時 1.0 核**。
  **三輪實驗均未重現該本體。**
- churn-only 收尾窗僅 **0.003 核**，亦**未重現** §1 診斷抓到的
  `FSWatcher._handle.onchange → scheduleInvalidateResolutionOfFailedLookupLocation` 堆疊。
- **結論措辭（請照抄，勿改寫成更強的說法）**：
  > **本實驗證明旗標有效且 ATA 約佔兩成，但未能重現 production 的空轉本體；
  > ATA 是否為該本體的主因，仍未證實。**

**4. §3.3 收尾條件的處置：`jsconfig.json` 路線暫不執行**

經使用者裁決保留為日後選項，不在本案執行。理由：

- 新證據顯示本次負載的主導成本是**診斷重算**，而非失敗查找；`jsconfig.json` 針對的是後者。
- `jsconfig.json` 的效益**同樣未經驗證**，貿然執行只是換一個未驗證的假設。
- 它會動到 9 個專案的檔案（新增設定檔），代價高於單行 LSP 設定。

**5. 後續驗收改為長期觀察**

本案的量化閘門既已越過，實際驗收機制改為 **Part 2 的偵測器**：上線後若 tsserver 再度失控，
會在 **5 分鐘內**於狀態列被標記。這才是本案真正的長期驗收 ——
**若偵測器在往後的使用中再度標記 tsserver，即代表 Part 1 未能根治，需重啟 §3.3 的 `jsconfig.json` 路線。**

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

唯一與系統互動處。`sampleProcesses()` 執行 PowerShell 的 `Get-Process`，解析為
`[{ pid: number, name: string, cpuSeconds: number }]`。

> **本節於 2026-08-09 整合階段修訂。原設計取樣來源為 `tasklist /v /fo csv`，實測不可行。**
>
> 在本機（Windows 11 Home 10.0.26200，取樣當下 347–359 個行程）實測四種來源：
>
> | 方式 | 實測耗時 | 結論 |
> |---|---|---|
> | `tasklist /v /fo csv` | 30303ms / 29072ms | 恆超過 `procscan` 的 3000ms 逾時 |
> | `tasklist /fo csv` | 602ms | 快，但**輸出無 CPU Time 欄**，對本功能無用 |
> | `wmic process get …` | — | Windows 11 已移除該工具，不存在 |
> | `powershell … Get-Process` | 266–307ms（4 次量測） | 直接給 pid / ProcessName / CPU 秒數（浮點） |
>
> 後果是**偵測器自接上進入點起從未成功取樣過**：`sampleProcesses()` 每次都因逾時回 `null`，
> 狀態檔 `~/.claude/leon-statusline/runaway-state.json` 的 `procs` 恆為 `{}`（修訂前實地取樣所得）。
> 使用者已裁決改用 `Get-Process`，代價是本節與解析器、其測試全部重寫。
> 改用後同一狀態檔的 `procs` 有 239 筆（2026-08-09 端對端實測）。

實際命令（單行 `-Command`，**不使用外部 `.ps1` 腳本檔** —— 那會多一個必須隨 plugin 發佈的檔案）：

```
powershell -NoProfile -NonInteractive -Command
  "try { [Console]::OutputEncoding=[Text.Encoding]::UTF8 } catch {};
   $ci=[Globalization.CultureInfo]::InvariantCulture; Get-Process | ForEach-Object {
   if ($null -ne $_.CPU) { $_.Id.ToString($ci) + ' ' + $_.CPU.ToString($ci) + ' ' + $_.ProcessName } }"
```

輸出每列 `<pid> <cpu秒> <行程名>`。五個設計要點各有依據：

- **`-NoProfile -NonInteractive`**：不載入使用者 profile（慢且不可預期），也不等互動輸入。
- **`ProcessName` 放最後一欄**：本機實測存在 `Docker Desktop` 這種**含空白**的 `ProcessName`（同名 5 個行程）。`pid` 與 CPU 兩欄結構上不含空白，故解析器只切前兩個空白、其餘全歸行程名即安全。
- **小數點明確指定 `InvariantCulture`**：`$_.CPU` 直接字串串接會跟隨執行緒地區設定。實測同一個 `3.28125` 在 `de-DE` 下為 `3,28125` —— 逗號小數點會讓 `Number()` 剖析失敗。
- **`$_.CPU` 為 `$null` 的列整列不輸出**（詳見下方「已知限制」）。**絕不補 0** —— 補 0 會讓那些行程的區間速率恆為 0，永遠不可能被偵測到，是靜默失效。
- **`[Console]::OutputEncoding` 設為 UTF-8**：Windows PowerShell 重導向輸出時預設用 OEM codepage，Node 這端以 `utf8` 解碼，非 ASCII 的行程名會壞掉。實測（`execFileSync` + piped stdout，2026-08-09，本機 zh-CN）：名為 `測試行程守衛` 的探測行程被讀成 `"?yԇ?г????l"` —— 是 GBK 位元組被當 UTF-8 解讀的**混合**結果（夾雜 `U+0079 'y'`、`U+0433 'г'` 這類實際字元），**不是**單純的 `U+FFFD`；設定之後同一個行程正確讀回 `測試行程守衛`。
  - setter 本身在**這個呼叫路徑**實測**不會拋錯**（裸寫、包 `try/catch` 兩種寫法各跑一次皆正常）。仍包 `try/catch` 的理由是成本為零，且萬一在別的 stdout handle 下拋了，應該只退化成亂碼、而非讓整次取樣失敗。
  - 此項**只影響顯示，不影響剖析**：GBK 的前導與後續位元組都不等於 `0x20`，故亂碼不會多切出欄位。實測同一個探測行程在兩種情況下欄位數都是 3、`pid` 與 CPU 兩欄都照常剖析得出。

**對使用者可見的變化**：`Get-Process` 的 `ProcessName` **不帶副檔名**（是 `node`，不是 `node.exe`）。程式碼照原樣使用、不自行把副檔名接回去（那是捏造資料），故第 5 行會顯示 `node(31832) 0.86c` 而非 `node.exe(31832) 0.86c`。

#### 已知限制：查詢不到的行程一律偵測不到

`$_.CPU` 為 `$null` 的行程被整列略過，也就是**完全不在偵測範圍內**。機制不是「這些行程比較特別」，而是**狀態列自己的權杖無法查詢該行程** —— 取樣行程未提權（實測 `IsInRole(Administrator) = False`），對完整性等級高於自己的行程拿不到查詢權限。

本機實測（2026-08-09，兩次取樣間行程數會浮動）：

| 取樣 | 全部行程 | CPU 讀得到 | CPU 為 `$null` |
|---|---|---|---|
| 第一次 | 355 | 239 | 116 |
| 第二次 | 337 | 224 | 113 |

讀不到的那批依 session 分布（第二次取樣）：**Session 0（服務／系統）106 個**，**使用者自己的互動 session 7 個**（`csrss` / `winlogon` / `dwm` / `fontdrvhost` / `nvcontainer` / `NVDisplay.Container` / `parsecd`）。同一次取樣中，CIM 的 `GetOwner` 對這 113 個**同樣**全部失敗，與 CPU 讀不到完全重合 —— 佐證是權杖層級的存取問題，不是 `Get-Process` 的欄位問題。

最直接的證據是同名雙實例：`nvcontainer`（pid 12484 vs 12652）與 `parsecd`（pid 29132 vs 29504）**各有兩個實例同在使用者的 session 1**，其中一個 CPU 讀得到、另一個讀不到。同一支程式、同一個使用者、同一個 session，差別只在完整性等級 —— 排除了「那是系統服務」這個解釋。

> **⚠ 對使用者的實質意義：以系統管理員身分啟動的失控行程，這個守衛偵測不到，且不會有任何跡象。**
> 狀態列不會警告，也不會顯示「有 N 個行程無法檢視」。**適用範圍**：本機、取樣行程未提權時。
> 一般情況下要抓的 `node`（tsserver、Claude Code 自己起的子行程）是使用者以一般權限啟動的，讀得到 —— 端對端實測 `procs` 內確實有 `node`。
> 若要涵蓋提權行程，唯一做法是讓狀態列自己提權，那與「狀態列只是個顯示程式」的定位衝突，**不做**（見 §9）。

- 非 Windows（`platform !== 'win32'`）→ 回傳 `null`，且**完全不執行任何命令**。
- 逾時上限 3 秒（對實測 266–307ms 約 10 倍餘裕）；失敗、逾時、解析錯誤一律回 `null`（不拋）。
- **可測性**：比照本 repo 的 DI 慣例，簽章為 `sampleProcesses({ exec, platform } = {})`，預設值取自真實環境；測試一律注入 `exec`，**不真的執行 PowerShell**。解析器為模組私有（不再有第二個 export）—— 舊的 `parseTasklistCsv` 已隨本次修訂刪除，不留「以防萬一」的死碼。
- 命令本身的性質（`-NoProfile` / `-NonInteractive` / invariant / 略過 `$null` CPU / 不補副檔名 / UTF-8 輸出），**以及 `execFileSync` 的選項物件**（`timeout: 3000` / `encoding: 'utf8'` / `windowsHide` / `maxBuffer` / 執行檔名），全在注入的 `exec` 之外，行為測試鎖不住，改由 `tests/procscan.test.mjs` 的**原始碼靜態鎖**釘住（見 §7）。其中 `timeout` 與 `encoding` 的爆炸半徑最大：前者是唯一擋住「同步阻塞取樣拖垮每一次 render」的東西（即 `tasklist` 造成的災難本身），後者一掉就拿到 `Buffer` → 解析器回 `null` → **永久靜默失效**。

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
- 節流：未達間隔即直接沿用既有結果，不掃描。故 statusline 每 10 秒刷新中，最多每 6 次才有 1 次付出取樣成本。端對端實測（2026-08-09，`statusline.mjs` 連跑 4 次）：真的取樣那次 **484ms**，被節流擋下的三次各 **58 / 59 / 60ms**。
  - 註：`detect` 在取樣**失敗**時亦寫回狀態（只推進 `attemptedAt`），否則節流基準永不前進 —— 見 `leon-statusline/src/runaway.mjs:64-71` 的 `attemptOnly`。取樣**成功**時寫回的狀態刻意不帶 `attemptedAt`（`lastAttempt` 會退回 `t`，而此刻 `t === now`，節流基準相同），端對端實測確認狀態檔成功後確實沒有該欄位。

### 5.4 `src/render.mjs`：新增 `renderLine5`

`buildOutput` 現行收尾為 `lines.filter(l => l && l.length).join('\n')`，**本就會濾掉空字串**。故：

- 無標記 → `renderLine5` 回 `''` → 狀態列與現況逐字元相同（零噪音由既有架構免費提供，無需額外條件判斷）。
- 有標記 → 回 RED 色的一行：`⚠ runaway:N` 後接最多 2 筆 `name(pid) X.XXc`，超出以 `+M` 表示。

### 5.5 `statusline.mjs`：注入

比照既有 `deps.git` / `deps.counts` / `deps.now`，新增 `deps.runaway()`，回傳 `flagged` 陣列或 `null`。測試可完全 mock。

---

## 6. 錯誤處理 / 永不崩潰

**首要原則：偵測失敗絕不拖累顯示。** statusline 的本職是顯示，偵測是附加功能。

- PowerShell 失敗／逾時／非 Windows → `sampleProcesses()` 回 `null` → 沿用上次的 `flagged`，不顯示新警告；狀態檔僅推進 `attemptedAt`（`t` / `procs` / `flagged` 原樣保留），以免節流基準卡住。
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

**`tests/procscan.test.mjs`（新增）**：全部經注入的 `exec` 驗證，不真的執行 PowerShell。

- 解析：正常輸出；行程名含空白（`Docker Desktop`）完整保留；CPU 為浮點秒數（含 `0`）；CPU 欄非數字（含逗號小數點 `3,28125`、`N/A`）該列被略過**而非當成 0**；缺欄位／pid 非數字／行程名為空該列被略過；CRLF 與 LF 等價。
- 平台與失敗：非 Windows 回 `null` 且 `exec` 呼叫次數為 0（**用計數器，不用「被呼叫就 throw」的哨兵** —— `sampleProcesses` 對 `run()` 包了 `try/catch`，哨兵拋的錯會被吞掉而假綠）；`exec` 拋錯回 `null` 不往外拋；輸出無法解析／空輸出／`Buffer`（忘了 `encoding: 'utf8'`）皆回 `null`。
- **原始碼靜態鎖**（讀 `src/procscan.mjs` 內文）共 9 條，分兩層：
  - *命令字串*：必須有 `-NoProfile`、`-NonInteractive`、`-Command`；不得出現 `.ps1`；必須有 `InvariantCulture` 與 `CPU.ToString($ci)`；必須有 `$null -ne $_.CPU`；必須有包在 `try/catch` 裡的 `[Console]::OutputEncoding=[Text.Encoding]::UTF8`；不得出現 `'.exe'` 字面量；不得含任何終止行程的手段。
  - *`execFileSync` 選項物件*：必須有 `timeout: 3000`、`encoding: 'utf8'`、`windowsHide: true`、`maxBuffer: 8 * 1024 * 1024`，且執行檔為 `'powershell'`。**這層先前是缺的** —— 實地突變確認，把這五項任一改掉（刪 `timeout`、刪 `encoding`、換成不存在的執行檔、`maxBuffer` 改成 16 bytes、刪 `windowsHide`）當時 167 條測試**全綠**。補上後五項各自轉紅。
- **跨模組欄位契約**（沿用原有那條，改成新格式）：用注入 `exec` 的真實 `sampleProcesses` 餵真實 `classify`，驗端到端能標出持續失控的行程。這是唯一擋得住「上游欄位改名導致功能無聲死亡」的哨兵，不得刪。

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
- **不為了看見提權行程而讓狀態列提權**：§5.1「已知限制」記錄了取樣行程查詢不到的行程（本機實測 337 個中 113 個，含使用者 session 內 7 個提權行程）一律偵測不到。要涵蓋它們就得讓狀態列本身以系統管理員執行 —— 那會讓一個每 10 秒跑一次的顯示程式長期持有高權限，風險遠大於收益。**選擇讓限制被記錄下來，而不是消除它。**
- **不做白名單／程式名例外** —— §4.3 已證明結構性排除即足夠。
- 不記錄歷史、不畫趨勢、不推播通知。
- 不偵測記憶體洩漏或控制代碼洩漏，只看 CPU。
- 不為 9 個裸專案預先補 `jsconfig.json` —— 僅在 §3.3 收尾條件成立時才做。
