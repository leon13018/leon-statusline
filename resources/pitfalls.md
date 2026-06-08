# 踩過的坑

每條：**症狀 → 根因 → 解法**。

---

## 1. plugin 裝了，但主狀態列不出現
- **症狀**：把 `statusLine` 放進 plugin 的 `settings.json`，安裝後狀態列沒出現。
- **根因**：官方明定 plugin 的 `settings.json` **只支援 `agent` / `subagentStatusLine`，不支援主 `statusLine`**。
- **解法**：plugin 只帶腳本，另做一個 setup 指令把 `statusLine` 寫進**使用者的** settings.json。

## 2. `${CLAUDE_PLUGIN_ROOT}` 在 statusLine 命令不展開
- **症狀**：settings.json 寫 `node "${CLAUDE_PLUGIN_ROOT}/statusline.mjs"`，重啟後狀態列**空白**。
- **根因**：該變數只在 skill/agent/hook/monitor/MCP/LSP 內容展開；**statusLine 命令不在清單內**（issue #9354 也記載類似情境會靜默失敗）。
- **解法**：setup 在 **skill 內容**裡解析 `${CLAUDE_PLUGIN_ROOT}`（這裡會展開）→ 寫**絕對路徑**進 settings.json。

## 3. plugin 升級後路徑變、舊路徑被清
- **症狀**：`/plugin update` 後路徑從 `…/1.0.0/…` 變 `…/1.1.0/…`，settings.json 還指舊版；舊目錄約 7 天後刪除。
- **根因**：CC 只自動更新「它管理的東西」（skill/hook/command 在使用當下解析）；statusLine 在使用者 settings.json，CC 不會去改。
- **解法**：plugin 內建 **SessionStart hook**，每次開 session 跑 `setup.mjs --sync` 自動重指到當前版本（idempotent、寫前備份）。

## 4. `~` 不是每個 shell 都展開
- **症狀**：命令裡用 `~/...`，在 PowerShell/cmd 下不展開，甚至建出一個叫 `~` 的怪資料夾。
- **根因**：只有 Git Bash 會展開 `~`。
- **解法**：命令不依賴 `~`；腳本內部一律 `os.homedir()` + `path.join()`。

## 5. 反斜線被 Git Bash 吃掉
- **症狀**：命令字串放 Windows 反斜線路徑 `C:\Users\...`，到 runner 時分隔符被吃掉、**靜默失敗**。
- **解法**：命令字串一律用**正斜線** `C:/...`。

## 6. 跨平台路徑測試 bug（TDD 抓到）
- **症狀**：`targetPath` 測試在 Windows fail：期望 `/home/leon/.claude/settings.json`，實得 `\home\leon\.claude\settings.json`。
- **根因**：`path.join` 回 **OS 原生分隔符**（Windows 是 `\`），但測試硬寫正斜線。
- **解法**：測試的期望值也用 `join()` 建（OS-agnostic）。函式本身是對的。

## 7. npm install 報 5 個漏洞
- **症狀**：裝 vitest 後 `npm audit` 報 4 moderate + 1 critical。
- **根因**：全源自 vitest 鏈裡的**舊 esbuild dev-server** 漏洞（1 個問題沿相依鏈被數 5 次）；dev-only、我們從不開 dev server、不隨 plugin 散佈 → 實際不可利用。
- **解法**：升 vitest 到 v4.1.8（用已修補的 esbuild）→ `found 0 vulnerabilities`，55 測試仍全綠。

## 8. statusLine 的 JSON 沒有 `hook_event_name`
- **症狀**：網路範例的 mock JSON 出現 `"hook_event_name":"Status"`。
- **根因**：那是 hooks 系統的欄位，不屬於 statusLine schema。
- **解法**：不依賴它；以官方 statusLine 文件為準。

## 9. 「啟用且可用」的計數拿不到
- **症狀**：想顯示「本 session 當前啟用且可用」的 mcp/skill/hook 數。
- **根因**：那是 CC 執行期內部狀態，不外露給 statusline。
- **解法**：降級為「**已設定 / 可發現**」（讀設定檔/資料夾算），語意誠實標明。

## 10. SessionStart hook 的 stdout 會被當 context 注入
- **症狀**：hook 印東西會被塞進 session 上下文。
- **解法**：`setup.mjs --sync`（給 hook 用的模式）**完全不印 stdout**，靜默做事。

## 11.（開發環境）不能用 `git add -A`
- **症狀**：本案在一個有自訂 hook 的環境裡開發，`git add -A` / `npm install` 會被 PreToolUse hook 擋。
- **解法**：git 一律**明確列檔名**；依賴安裝改由人手動跑或用 `npx`。（此為開發機特有限制，非 plugin 本身問題。）
