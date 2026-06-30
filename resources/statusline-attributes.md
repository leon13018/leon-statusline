# 狀態列屬性 / 欄位資訊大全

leon-statusline 顯示什麼、資料從哪來、什麼條件下才顯示。技術名詞 / JSON key 保留英文。

> 資料來源 = Claude Code 在每次更新時，把整個 session 狀態以**單一 JSON 物件**透過 **stdin** 餵給狀態列腳本。腳本印到 **stdout** 就是顯示內容。**全程在本機跑、不消耗任何模型 token。**

---

## 版面總覽（4 行）
```
~/…/Project_01  Opus effort:high think:on  token:15.5k  compact ██████████░░░░░░░░░░ 42%  session:my-session
repo:claude-code  worktree:feat-x  git:main +2 ~1 ↑1↓2  +156 -23  PR:#1234 pending
api:<1m  wall:14m  cost:$0.42  5h:24%(reset 1h23m)  7d:41%(reset 5d4h)
CLAUDE.md:7  memory:5  mcp:3  agent:1  skill:2  hook:13  plugin:2  workflow:1
```

## 顯示規則（永不隱藏，v1.2.0 起）
- 每個 attribute **連同其標題**永遠顯示，從不隱藏；整行也永遠存在（共 4 行）。
- **讀到值（包含真實的 `0`）** → 顯示真值（如 `token:0.0k`、`cost:$0.00`、`5h:0%`、`git:main clean`、`+0 -0`），維持元素原色。
- **沒抓到 / 不適用** → 名稱類顯示 `none`（model/session/repo/worktree/PR/git 不在 repo），數值類顯示 `n/a`（目錄/effort/token/context bar/api/wall/cost/5h/7d），且一律 **DIM 灰**——灰色專指「沒資料」，與真實 0 用文字＋顏色雙重區分。
- 例外：`think` 永遠 `on`/`off`；第 4 行計數 `0` 即「真的數到 0」。

---

## 第 1 行（identity / context）
| attribute | 來源 JSON | 格式 | 條件 |
|---|---|---|---|
| 目錄 | `workspace.current_dir` | 家目錄→`~`；超 3 段收 `…` 留最後 2 段 | 永遠 |
| 模型 | `model.display_name` | 原文 | 永遠 |
| `effort:` | `effort.level` | low/medium/high/xhigh/max | 模型支援 effort 時 |
| `think:` | `thinking.enabled` | `on` | 僅為 true |
| `token:` | `context_window.total_input_tokens` | `15.5k`（1 位小數 k）| 有才顯示 |
| context bar（auto-compact %）| `context_window.used_percentage` | `compact` + 20 格 `█/░` + ` NN%`；NN = used ÷ 門檻 × 100，綠→紅；門檻取 env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`，否則預設 95%（**近似**：CC 未公開門檻、`autoCompactWindow` 假設＝`context_window_size`）| 永遠（永不隱藏）|
| `session:` | `session_name` | 原文 | 命名過才有（`--name` / `/rename`）|

## 第 2 行（repo / git）
| attribute | 來源 | 格式 | 條件 |
|---|---|---|---|
| `repo:` | `workspace.repo.name` | 原文 | 有 git remote |
| `worktree:` | `workspace.git_worktree` | 原文 | 在 linked worktree |
| `git:` | git CLI（`--no-optional-locks`）| `<branch> +<staged> ~<modified> ↑<ahead>↓<behind>`；無變動顯示 `clean`；ahead/behind 為 0 省略 | 在 git repo |
| 增刪行 | `cost.total_lines_added` / `total_lines_removed` | `+156 -23` | 有才顯示 |
| `PR:` | `pr.number` / `pr.review_state` | `#1234 pending`（approved/pending/changes_requested/draft）| 當前分支有 open PR |

## 第 3 行（time / cost / rate）
| attribute | 來源 | 格式 | 條件 |
|---|---|---|---|
| `api:` | `cost.total_api_duration_ms` | 連接非零單位至分鐘；<1 分 `<1m` | 有才顯示 |
| `wall:` | `cost.total_duration_ms`（**含閒置**）| `14m` / `2h5m` / `1d3h5m` | 有才顯示 |
| `cost:` | `cost.total_cost_usd` | `$0.42`（2 位小數）| 有才顯示 |
| `5h:` | `rate_limits.five_hour.used_percentage` / `resets_at` | `24%(reset 1h23m)` | 僅 Pro/Max、首次 API 回應後 |
| `7d:` | `rate_limits.seven_day.used_percentage` / `resets_at` | `41%(reset 5d4h)` | 僅 Pro/Max |

> `api` 是「等 Claude 回應」的累計時間，通常遠小於 `wall`（你大多在讀/打字）；`wall` 是 session 開始至今的真實時間（含發呆）。

## 第 4 行（基礎設施數量，範圍：只算專案＋user 自訂）
| attribute | 怎麼算 |
|---|---|
| `CLAUDE.md:` | 遞迴掃專案樹的 `CLAUDE.md`（排除 .git/node_modules/vendor/.venv/dist/build）|
| `memory:` | 本 session memory 目錄 `*.md`（含 `MEMORY.md`）|
| `mcp:` | `~/.claude.json` + 專案 `.mcp.json` 的 server 數（**已設定數**，非連線）|
| `agent:` | `.claude/agents/` + `~/.claude/agents/` 的 `*.md` |
| `skill:` | `.claude/skills/` + `~/.claude/skills/` 含 `SKILL.md` 的子目錄 |
| `hook:` | 合併 user+專案 settings 的 `hooks` 區塊**註冊條目數** |
| `plugin:` | settings `enabledPlugins` 的已啟用數 |
| `workflow:` | `.claude/workflows/` + `~/.claude/workflows/` 的 `*.js` |

> 第 4 行每 session 算一次快取（TTL 60s）；第 2 行 git 快取 TTL 2s。快取 key 用 `session_id`。

---

## ❌ 拿不到（刻意不放，避免假資料）
- MCP **實際連線**狀態（執行期狀態；要背景 spawn `claude mcp list`，且抓不到內建橋接）
- skill / hook **本次觸發次數**（執行期狀態）
- 內建 agent / tool 列舉（寫死在程式內）
- repo public/private（要 `gh`/GitHub API，破壞零依賴）

## 其他 JSON 可用欄位（本 plugin 未用，但存在）
`cwd`、`session_id`、`transcript_path`、`version`、`workspace.project_dir`、`workspace.added_dirs`、`workspace.repo.{host,owner}`、`output_style.name`、`exceeds_200k_tokens`、`context_window.{context_window_size,remaining_percentage,current_usage.*}`、`vim.mode`、`agent.name`、`worktree.*`。完整定義見 `research/CC_statusline_config_research.md`。
