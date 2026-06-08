# leon-statusline

跨平台（macOS / Windows / Linux）的 Claude Code 4 行狀態列，純 Node.js、零執行期依賴、永不崩潰。

## 版面
```
~/…/Project_01  Opus effort:high think:on  token:15.5k  ██████████░░░░░░░░░░ 42%  session:my-session
repo:claude-code  worktree:feat-x  git:main +2 ~1 ↑1↓2  +156 -23  PR:#1234 pending
api:<1m  wall:14m  cost:$0.42  5h:24%(reset 1h23m)  7d:41%(reset 5d4h)
CLAUDE.md:7  memory:5  mcp:3  agent:1  skill:2  hook:13  plugin:2  workflow:1
```
- 第1行：目錄 / 模型+effort+thinking / token / context bar（平滑漸層）/ session 名
- 第2行：repo / worktree / git 分支+狀態+ahead·behind / 增刪行 / PR 狀態
- 第3行：API 時間 / 牆鐘時間 / 成本 / 5h、7d 額度%+重置倒數
- 第4行：CLAUDE.md / memory / mcp / agent / skill / hook / plugin / workflow 數量（專案＋user 自訂）
- 每個 attribute「抓不到就連標題一起隱藏」；整行全缺才整行消失。

## 安裝（3 步）
```
/plugin marketplace add <repo URL>
/plugin install leon-statusline
/leon-statusline:setup-statusline user        # user / project / local
```
第 3 步把 `statusLine` 寫進你選的 settings.json；若偵測到既有 statusLine 會先問你「覆蓋（自動備份）或取消」。需要機器上有 Node.js。

## 開發
```
npm install
npm test
```

## 設計
- runtime：Node.js（`node <path>` 三大 OS 一致）。
- 永不崩潰：一律 exit 0、至少印一行、所有欄位 null 防禦、子程序走快取不阻塞。
- 快取：git 2s、計數 60s，以 session_id 為 key，存 `${CLAUDE_PLUGIN_DATA}` 或 `~/.claude/`。
