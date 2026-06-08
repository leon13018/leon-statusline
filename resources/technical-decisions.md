# 技術選型與決策理由

每條：**決定 → 為何 → 被否決的方案**。

---

## 1. Runtime：Node.js
- **為何**：Claude Code 本身就是 Node CLI → **任何裝了 CC 的機器一定有 Node**；`node <path>` 在三大 OS 呼叫方式**完全一致、不需 wrapper、不靠 shebang**。
- **否決**：Python（要賭每台都有 `python3`）、Bash（純 PowerShell Windows 直接死）、Go 單檔執行檔（runtime 最穩，但要逐 OS 編譯、無社群實證）、Bun/Deno（又回到「直譯器是否每台都裝」）。

## 2. 視覺：純文字空格分隔 + truecolor 平滑漸層
- **為何**：第一目的是「跨平台、給別人用」。真 powerline 箭頭（``）是 **Nerd Font 私有區字元**，別人沒裝會變豆腐——而你無法替別人裝字型。純標準 Unicode（`█░`）+ truecolor 任何現代終端都正常。
- **否決**：Nerd Font powerline 分段（最美但依賴字型）。
- 漸層 bar 因為全自寫，可做**真平滑** truecolor（`38;2;r;g;b`），比 claude-powerline 的 3 段變色細緻。

## 3. 全自寫（不用現成工具）
- **為何**：claude-powerline / ccusage / ccstatusline **做不出第 4 行**（基礎設施計數沒有對應 widget），且要 `npx` 拉套件（違反零依賴）。
- **否決**：claude-powerline（+npx、無第 4 行）、混合（claude-powerline 出 1-2 行 + 自寫第 4 行 → 兩套拼接更亂）。

## 4. 封裝：Claude Code plugin + marketplace
- **為何**：要**分享給別人**、要版本化更新。
- **否決**：個人腳本（只能自己手動裝、無法分發）。

## 5. statusLine 注入：setup 指令寫 settings.json
- **為何**：官方文件明示 **plugin 的 settings.json 不支援主 `statusLine`**（只 `agent`/`subagentStatusLine`）。經 2 個獨立 agent + 4 個真實 repo 交叉驗證。所以照業界做法（claude-powerline 的 `/powerline` wizard）：plugin 帶腳本 + setup 指令把 statusLine 寫進使用者 settings.json。
- **否決**：在 plugin settings.json 宣告 statusLine（官方不支援，無效）。

## 6. setup 寫「絕對路徑」而非 `${CLAUDE_PLUGIN_ROOT}`
- **為何**：實測 `${CLAUDE_PLUGIN_ROOT}` 在 **statusLine 命令不會展開**（render 出空白）。setup 在 **skill 內容**裡解析 `${CLAUDE_PLUGIN_ROOT}`（這個情境會展開）成絕對路徑再寫入。
- **否決**：命令裡留 `${CLAUDE_PLUGIN_ROOT}`（測過 → 失敗）。

## 7. 升級自動重指：SessionStart hook
- **為何**：絕對路徑帶版號，更新後路徑變。hook **確定**支援 `${CLAUDE_PLUGIN_ROOT}`，每次開 session 自動把「我們的、過時的」路徑重指到當前版本。全自動、零依賴。
- **否決**：`npx <pkg>@latest`（要發 npm + 每 render 走 npx）、手動每次更新後重跑 setup（要記得、易忘）。

## 8. 第 4 行計數範圍：只算專案＋user 自訂
- **為何**：含 plugin 帶的數字大又雜；且實測 **plugin skill 的 glob 不穩**（抓不到 superpowers 的 skill）。只算自訂 → 數字小、誠實、可靠。
- **否決**：含 plugin（數字膨脹、不可靠）。

## 9. MCP：只給「已設定數」
- **為何**：「實際連線數」是執行期狀態、硬碟拿不到，唯一路徑是背景 spawn `claude mcp list` + 90s 快取——太重、還抓不到內建橋接。
- **否決**：真連線數（成本/複雜度不值）。

## 10. 牆鐘時間含閒置
- **為何**：`cost.total_duration_ms` 本就是含閒置的 wall-clock，直接用最簡單。
- **否決**：純活躍時間（要靠 hook 累計每輪 `Stop−UserPromptSubmit`，複雜）。

## 11. 測試框架：Vitest（後升 v4）
- **為何**：快、ESM 友善、跨平台、dev-only 不影響零執行期依賴。
- 後續：v2 鏈夾帶舊 esbuild 報 5 個漏洞 → 升 **v4.1.8**（已修補 esbuild）→ 0 漏洞、55 測試仍全綠。
- **否決**：`node:test`（使用者想要第三方框架驗證）。

## 12. 永不崩潰設計（第一鐵律）
- 一律 `exit 0`、至少印一行、所有欄位當可能 null、子程序走快取不阻塞 render、狀態存 `${CLAUDE_PLUGIN_DATA}`/`~/.claude` 不存 tmp、快取 key 用 `session_id` 不用 pid。
