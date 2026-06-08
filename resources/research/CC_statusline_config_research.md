# Claude Code 狀態列（statusLine）完整技術報告

> 調研日期：2026-06-08｜方法：deep-research workflow（4 搜尋角度 → 7 來源抓取 → 對抗式查核 → 統整）。
> 本報告整理 Claude Code 自訂狀態列（statusLine）的設定語法、stdin JSON 輸入欄位、實作範例（bash / python / node / PowerShell）、`/statusline` 指令、ANSI 顏色、更新行為與跨平台踩坑。內容僅採用有來源支持的事實；來源未能核實者標注「待查證」。欄位名、JSON key、程式碼一律保留原文英文。

---

## 1. statusLine 是什麼

狀態列是顯示在 Claude Code 對話介面底部的一行（或多行）自訂資訊區，由你提供的一支腳本（或 inline shell 指令）動態產生。Claude Code 會把整個 session 狀態以**單一 JSON 物件**透過 **stdin** 傳給腳本，腳本把要顯示的內容印到 **stdout**，stdout 內容即成為狀態列顯示文字。

關鍵特性：

- 狀態列在**本機**執行，**不消耗 API tokens**。[1]
- stdout 支援**多行輸出**（每個 `echo` / `print` 對應狀態列的一列）。[1][2]
- 支援 **ANSI 色碼**與 **OSC 8 超連結序列**（可點擊連結）。[1]
- `disableAllHooks: true` 會**同時關閉**所有 hooks 與狀態列執行。[1][2]

---

## 2. settings.json 設定語法與參數

### 2.1 最小設定

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

`type` 目前**只接受 `"command"` 一種值**。`command` 可為腳本路徑，也可為 inline shell 指令。[1]

### 2.2 帶 padding 的設定

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

### 2.3 inline 指令（不需腳本檔）

`command` 欄位可直接內嵌 `jq` 指令而不必另寫腳本：[1]

```json
{
  "statusLine": {
    "type": "command",
    "command": "jq -r '\"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)% context\"'"
  }
}
```

### 2.4 statusLine 物件參數表

| 欄位 | 必填 | 型別 | 預設 | 說明 |
| --- | --- | --- | --- | --- |
| `type` | 是 | string | — | 固定為 `"command"`，目前唯一值。 |
| `command` | 是 | string | — | 腳本路徑或 inline shell 指令；讀 stdin JSON、印到 stdout。 |
| `padding` | 否 | integer | `0` | 狀態列內容周圍的水平空白字元數。 |
| `refreshInterval` | 否 | integer（秒） | — | 最小值 1；在 event-driven 更新之外，固定計時重跑腳本。 |
| `hideVimModeIndicator` | 否 | boolean | — | `true` 時隱藏內建的 `-- INSERT --` 提示，適合腳本本身已渲染 `vim.mode` 時。 |

來源：[1]（官方文件列出全部五個欄位）。

> 註：confirmed 與 disputed 區塊對欄位數量曾有「三個 / 四個 / 五個」的描述不一致。依官方文件 extracted 內容，實際支援的欄位為上表**五個**（`type`、`command`、`padding`、`refreshInterval`、`hideVimModeIndicator`）。[1]

### 2.5 subagentStatusLine（額外功能）

可另外設定 subagent 專用狀態列：[1]

```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  }
}
```

### 2.6 設定可放置的三個層級

| 層級 | 路徑 |
| --- | --- |
| User（使用者） | `~/.claude/settings.json` |
| Project（專案） | `<專案目錄>/.claude/settings.json` |
| Managed（受管） | managed 設定（如 `~/.claude/settings.managed.json`） |

來源：[2]（gist）、官方 settings 機制。Settings JSON Schema 位於 `https://json.schemastore.org/claude-code-settings.json`。[2]

---

## 3. stdin JSON 輸入完整欄位說明

腳本啟動時會收到完整 session 狀態（單一 JSON 物件）於 stdin。**選填物件（`vim` / `agent` / `pr` / `worktree` / `rate_limits` / `effort` 等）在不適用時是「整個物件缺席」，而非為 `null`**——腳本應防禦性處理（例如 `jq -r '... // empty'`）。[1][2]

### 3.1 完整 JSON schema 範例（官方）

```json
{
  "cwd": "/current/working/directory",
  "session_id": "abc123...",
  "session_name": "my-session",
  "transcript_path": "/path/to/transcript.jsonl",
  "model": {
    "id": "claude-opus-4-8",
    "display_name": "Opus"
  },
  "workspace": {
    "current_dir": "/current/working/directory",
    "project_dir": "/original/project/directory",
    "added_dirs": [],
    "git_worktree": "feature-xyz",
    "repo": {
      "host": "github.com",
      "owner": "anthropics",
      "name": "claude-code"
    }
  },
  "version": "2.1.90",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0.01234,
    "total_duration_ms": 45000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15500,
    "total_output_tokens": 1200,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "effort": {
    "level": "high"
  },
  "thinking": {
    "enabled": true
  },
  "rate_limits": {
    "five_hour": {
      "used_percentage": 23.5,
      "resets_at": 1738425600
    },
    "seven_day": {
      "used_percentage": 41.2,
      "resets_at": 1738857600
    }
  },
  "vim": {
    "mode": "NORMAL"
  },
  "agent": {
    "name": "security-reviewer"
  },
  "pr": {
    "number": 1234,
    "url": "https://github.com/anthropics/claude-code/pull/1234",
    "review_state": "pending"
  },
  "worktree": {
    "name": "my-feature",
    "path": "/path/to/.claude/worktrees/my-feature",
    "branch": "worktree-my-feature",
    "original_cwd": "/path/to/project",
    "original_branch": "main"
  }
}
```

來源：[1]

### 3.2 頂層欄位

| 欄位 | 型別 | 出現條件 | 說明 |
| --- | --- | --- | --- |
| `cwd` | string | 永遠 | 目前工作目錄（與 `workspace.current_dir` 同值）。 |
| `session_id` | string | 永遠 | session 唯一識別碼。**建議用作快取檔名**（不要用 `$$`）。 |
| `session_name` | string | 設過 `--name` / `/rename` 才有 | session 自訂名稱；未設定時缺席。 |
| `transcript_path` | string | 永遠 | `.jsonl` 對話 transcript 檔路徑。 |
| `version` | string | 永遠 | Claude Code 版本字串，如 `"2.1.90"`。 |
| `exceeds_200k_tokens` | boolean | 永遠 | 固定以 200k 為門檻，**不隨實際 window 大小變動**。 |

來源：[1][2]

### 3.3 `model` 物件

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `model.id` | string | 模型識別碼，如 `"claude-opus-4-8"`。 |
| `model.display_name` | string | 顯示名稱，如 `"Opus"`。 |

來源：[1][2]

### 3.4 `workspace` 物件

| 欄位 | 型別 | 出現條件 | 說明 |
| --- | --- | --- | --- |
| `workspace.current_dir` | string | 永遠 | 目前目錄（與頂層 `cwd` 同值，**官方建議優先用此欄位**）。 |
| `workspace.project_dir` | string | 永遠 | Claude Code 啟動時的目錄，可能與 `cwd` 不同。 |
| `workspace.added_dirs` | array | 永遠 | 透過 `/add-dir` 或 `--add-dir` 加入的目錄；無則為空陣列。 |
| `workspace.git_worktree` | string | 在 linked worktree 內才有 | git worktree 名稱；主工作樹中缺席。 |
| `workspace.repo.host` | string | 有 origin remote 的 git repo 才有 | 由 origin remote 解析，如 `github.com`。 |
| `workspace.repo.owner` | string | 同上 | repo 擁有者。 |
| `workspace.repo.name` | string | 同上 | repo 名稱。 |

來源：[1][2]

### 3.5 `cost` 物件

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `cost.total_cost_usd` | number | 估算 session 成本（USD），客戶端計算。 |
| `cost.total_duration_ms` | number | session 開始至今的 wall-clock 時間（毫秒）。 |
| `cost.total_api_duration_ms` | number | 等待 API 回應所花時間（毫秒）。 |
| `cost.total_lines_added` | number | 本 session 新增的程式碼行數。 |
| `cost.total_lines_removed` | number | 本 session 刪除的程式碼行數。 |

來源：[1][2]

### 3.6 `context_window` 物件

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `context_window.total_input_tokens` | number | 目前 context window 內的 input tokens（= input + cache_creation + cache_read）。**自 v2.1.132 起為「當前 context」而非「累計」。** |
| `context_window.total_output_tokens` | number | 最近一次回應的 output tokens。 |
| `context_window.context_window_size` | number | 最大 context（預設 200000；extended-context 模型為 1000000）。 |
| `context_window.used_percentage` | number / null | 預先計算好的已用百分比（僅 input：input + cache_creation + cache_read，**不含 output**）；session 早期可能為 `null`。 |
| `context_window.remaining_percentage` | number / null | 預先計算好的剩餘百分比；早期可能為 `null`。 |
| `context_window.current_usage.input_tokens` | number | 最近一次 API call 的 input tokens。 |
| `context_window.current_usage.output_tokens` | number | 最近一次 API call 的 output tokens。 |
| `context_window.current_usage.cache_creation_input_tokens` | number | cache 建立 tokens。 |
| `context_window.current_usage.cache_read_input_tokens` | number | cache 讀取 tokens。 |

`used_percentage` 計算公式：

```
used_percentage = (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) / context_window_size
```

**不含 `output_tokens`。**[1]

`current_usage` 物件在以下時機為 `null`：session **第一次 API call 之前**；`/compact` 之後到下次 API call 之前。[1]

> 待查證：disputed 區塊指出，「v2.1.132 後反映當前 context 而非累計」的版本說明**僅適用於 `total_input_tokens`**，將其套用到 `total_output_tokens` 屬錯誤歸因。本報告依官方 extracted 內容，僅對 `total_input_tokens` 標注此版本變更。

### 3.7 `effort` 物件（選填）

| 欄位 | 型別 | 出現條件 | 值 |
| --- | --- | --- | --- |
| `effort.level` | string | 僅當前 model 支援 effort 參數時 | `low` / `medium` / `high` / `xhigh` / `max` |

反映 session 即時值（含 session 中途 `/effort` 變更）。Ultracode 回報為 `xhigh`，並非獨立 level。[1]

### 3.8 `thinking` 物件

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `thinking.enabled` | boolean | 是否啟用 extended thinking。 |

來源：[1]

### 3.9 `rate_limits` 物件（僅 Pro/Max）

僅 Claude.ai 訂閱者（Pro/Max）在**第一次 API 回應後**才出現；其他帳戶類型缺席。`five_hour` 與 `seven_day` 可各自獨立缺席。[1][2]

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `rate_limits.five_hour.used_percentage` | float（0–100） | 5 小時視窗已用百分比。 |
| `rate_limits.five_hour.resets_at` | number | 重置時間（Unix epoch 秒）。 |
| `rate_limits.seven_day.used_percentage` | float（0–100） | 7 天視窗已用百分比。 |
| `rate_limits.seven_day.resets_at` | number | 重置時間（Unix epoch 秒）。 |

建議用 `jq -r '.rate_limits.five_hour.used_percentage // empty'` 安全讀取。[1]

### 3.10 `vim` 物件（選填）

| 欄位 | 型別 | 出現條件 | 值 |
| --- | --- | --- | --- |
| `vim.mode` | string | 僅 vim mode 啟用時 | `NORMAL` / `INSERT` / `VISUAL` / `VISUAL LINE` |

來源：[1]（gist [2] 列出 `NORMAL` / `INSERT`）。

### 3.11 `agent` 物件（選填）

| 欄位 | 型別 | 出現條件 | 說明 |
| --- | --- | --- | --- |
| `agent.name` | string | 使用 `--agent` flag 或設定 agent 時 | agent 名稱；否則缺席。 |

來源：[1][2]

### 3.12 `pr` 物件（選填）

僅當前 branch 有 open PR 時存在；PR 合併 / 關閉後移除。[1]

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `pr.number` | integer | PR 編號。 |
| `pr.url` | string | PR 連結。 |
| `pr.review_state` | string | `approved` / `pending` / `changes_requested` / `draft`；即使 `pr` 存在也可能獨立缺席。 |

### 3.13 `worktree` 物件（選填）

僅 `--worktree` session 時存在。[1][2]

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `worktree.name` | string | worktree 名稱。 |
| `worktree.path` | string | worktree 路徑。 |
| `worktree.branch` | string | worktree 分支。 |
| `worktree.original_cwd` | string | 原始 cwd。 |
| `worktree.original_branch` | string | 原始分支。 |

> 待查證：disputed 區塊提及「`branch` 與 `original_branch` 在 hook-based worktrees 時 absent」的說法無法從提供的來源核實，本報告不列為事實。

### 3.14 關於 `output_style`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `output_style.name` | string | 目前 output style 名稱，如 `"default"`。 |

來源：[1]

### 3.15 重要釐清：沒有 `hook_event_name`

statusLine 的 JSON input **不含** `hook_event_name` 欄位。該欄位屬於 hooks 系統（`PreToolUse` / `PostToolUse` 等），不屬於 statusLine schema。[1]

> 註：來源 [4]（claudefa.st）的範例 JSON 中出現 `"hook_event_name": "Status"`，與官方 schema 不符；以官方文件 [1] 為準，statusLine 輸入不應依賴此欄位。

---

## 4. 更新觸發與行為

| 項目 | 行為 |
| --- | --- |
| 觸發時機 | 每次新的 assistant 訊息後、`/compact` 完成後、permission mode 變更時、vim mode 切換時。 |
| 更新方式 | **事件驅動**（非固定輪詢）。 |
| debounce | 300ms。 |
| 競態取消 | 若新更新觸發時上一次腳本仍在跑，則**取消正在執行的那次**。 |
| `refreshInterval` | 在 event-driven 之外，每 N 秒（最小 1）固定重跑一次；適合 idle 期間 / subagent 情境週期重整。 |

來源：[1][2]

---

## 5. ANSI 顏色與輸出規範

### 5.1 stdout 即顯示文字

- stdout 內容直接成為狀態列文字。
- 多個 `echo` / `print` → 狀態列多列。[1]

### 5.2 常用 ANSI 色碼

| 色碼 | 顏色 |
| --- | --- |
| `\033[31m` | 紅 (red) |
| `\033[32m` | 綠 (green) |
| `\033[33m` | 黃 (yellow) |
| `\033[36m` | 青 (cyan) |
| `\033[35m` | 洋紅 (magenta) |
| `\033[2m` | 暗 (dim) |
| `\033[1m` | 粗體 (bold) |
| `\033[0m` | 重置 (reset) |

來源：[1][2]

### 5.3 TrueColor（24-bit RGB）

gist [2] 提供 helper：

```bash
rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }
```

> 待查證：disputed 區塊中關於 truecolor 自動偵測（`COLORTERM=truecolor`）、Apple Terminal 降級、以及多個 truecolor / tmux 量化 / dimColor 相關的 GitHub issue（#35806、#42382、#6635、#30725、#31670、#35371）皆無法從提供的來源核實，**不列為事實**。

### 5.4 終端機寬度

腳本**無法**用 `tput cols` 讀取終端寬度（因 stdout 被 Claude Code 捕獲）。應改讀環境變數 **`COLUMNS`** 與 **`LINES`**（Claude Code 在執行腳本前已設定）。此功能需 **Claude Code v2.1.153 或更新版本**。[1]

---

## 6. OSC 8 可點擊超連結

OSC 8 序列格式（各語言）：[1]

| 語言 | 格式 |
| --- | --- |
| Bash（`printf '%b'`） | `\e]8;;URL\aTEXT\e]8;;\a` |
| Python | `\033]8;;URL\aTEXT\033]8;;\a` |
| Node.js | `\x1b]8;;URL\x07TEXT\x1b]8;;\x07` |

支援的終端：iTerm2、Kitty、WezTerm。Windows 需設環境變數 **`FORCE_HYPERLINK=1`** 以強制 OSC 8 偵測。[1][2]

```bash
# 強制 OSC 8（Bash）
FORCE_HYPERLINK=1 claude
```

```powershell
# 強制 OSC 8（PowerShell）
$env:FORCE_HYPERLINK = "1"; claude
```

> 跨 shell 穩定性建議：使用 `printf '%b'` 比 `echo -e` 更穩定。[1]

---

## 7. `/statusline` 互動式指令

`/statusline` 是 Claude Code 內建的互動式 slash command，直接在對話框輸入即可。它接受**自然語言描述**，自動產生腳本（寫入 `~/.claude/`）並更新 `settings.json`，**無需手動編輯設定檔**。[1][3]

範例：

```
/statusline show model name and context percentage with a progress bar
```

Windows 上建議明確指定要產生「PowerShell Script with ANSI Escape Codes」：[3]

```
/statusline "show the model name in orange, my environment windows 11, please use PowerShell Script with ANSI escape codes"
```

移除：`/statusline clear` 或 `/statusline delete`。

---

## 8. 實際範例程式碼

### 8.1 Bash — 最小範例（模型 + 目錄）

```bash
#!/bin/bash
# Read JSON data that Claude Code sends to stdin
input=$(cat)

# Extract fields using jq
MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
# The "// 0" provides a fallback if the field is null
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Output the status line - ${DIR##*/} extracts just the folder name
echo "[$MODEL] 📁 ${DIR##*/} | ${PCT}% context"
```

來源：[1]

### 8.2 Bash — context 進度條

```bash
#!/bin/bash
# Read all of stdin into a variable
input=$(cat)

# Extract fields with jq, "// 0" provides fallback for null
MODEL=$(echo "$input" | jq -r '.model.display_name')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Build progress bar: printf -v creates a run of spaces, then
# ${var// /▓} replaces each space with a block character
BAR_WIDTH=10
FILLED=$((PCT * BAR_WIDTH / 100))
EMPTY=$((BAR_WIDTH - FILLED))
BAR=""
[ "$FILLED" -gt 0 ] && printf -v FILL "%${FILLED}s" && BAR="${FILL// /▓}"
[ "$EMPTY" -gt 0 ] && printf -v PAD "%${EMPTY}s" && BAR="${BAR}${PAD// /░}"

echo "[$MODEL] $BAR $PCT%"
```

來源：[1]

### 8.3 Bash — git status 含顏色

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')

GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    STAGED=$(git diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
    MODIFIED=$(git diff --numstat 2>/dev/null | wc -l | tr -d ' ')

    GIT_STATUS=""
    [ "$STAGED" -gt 0 ] && GIT_STATUS="${GREEN}+${STAGED}${RESET}"
    [ "$MODIFIED" -gt 0 ] && GIT_STATUS="${GIT_STATUS}${YELLOW}~${MODIFIED}${RESET}"

    echo -e "[$MODEL] 📁 ${DIR##*/} | 🌿 $BRANCH $GIT_STATUS"
else
    echo "[$MODEL] 📁 ${DIR##*/}"
fi
```

來源：[1]

### 8.4 Bash — 多行 + 依用量變色的 context bar + 成本 + 時長

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

# Pick bar color based on context usage
if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" | 🌿 $(git branch --show-current 2>/dev/null)"

echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}$BRANCH"
COST_FMT=$(printf '$%.2f' "$COST")
echo -e "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"
```

來源：[1]

### 8.5 Bash — OSC 8 可點擊 repo 連結

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')

# Convert git SSH URL to HTTPS
REMOTE=$(git remote get-url origin 2>/dev/null | sed 's/git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')

if [ -n "$REMOTE" ]; then
    REPO_NAME=$(basename "$REMOTE")
    # OSC 8 format: \e]8;;URL\a then TEXT then \e]8;;\a
    # printf %b interprets escape sequences reliably across shells
    printf '%b' "[$MODEL] 🔗 \e]8;;${REMOTE}\a${REPO_NAME}\e]8;;\a\n"
else
    echo "[$MODEL]"
fi
```

來源：[1]

### 8.6 Bash — rate limits（Pro/Max）

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
# "// empty" produces no output when rate_limits is absent
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

LIMITS=""
[ -n "$FIVE_H" ] && LIMITS="5h: $(printf '%.0f' "$FIVE_H")%"
[ -n "$WEEK" ] && LIMITS="${LIMITS:+$LIMITS }7d: $(printf '%.0f' "$WEEK")%"

[ -n "$LIMITS" ] && echo "[$MODEL] | $LIMITS" || echo "[$MODEL]"
```

來源：[1]

### 8.7 Bash — 快取慢操作（用 session_id 當 key，不用 `$$`）

`$$` 每次 invocation 都會變，`session_id` 在整個 session 週期穩定且唯一，因此快取檔名應以 `session_id` 命名。[1]

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
SESSION_ID=$(echo "$input" | jq -r '.session_id')

CACHE_FILE="/tmp/statusline-git-cache-$SESSION_ID"
CACHE_MAX_AGE=5  # seconds

cache_is_stale() {
    [ ! -f "$CACHE_FILE" ] || \
    [ $(($(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0))) -gt $CACHE_MAX_AGE ]
}

if cache_is_stale; then
    if git rev-parse --git-dir > /dev/null 2>&1; then
        BRANCH=$(git branch --show-current 2>/dev/null)
        STAGED=$(git diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
        MODIFIED=$(git diff --numstat 2>/dev/null | wc -l | tr -d ' ')
        echo "$BRANCH|$STAGED|$MODIFIED" > "$CACHE_FILE"
    else
        echo "||" > "$CACHE_FILE"
    fi
fi

IFS='|' read -r BRANCH STAGED MODIFIED < "$CACHE_FILE"

if [ -n "$BRANCH" ]; then
    echo "[$MODEL] 📁 ${DIR##*/} | 🌿 $BRANCH +$STAGED ~$MODIFIED"
else
    echo "[$MODEL] 📁 ${DIR##*/}"
fi
```

來源：[1]

### 8.8 Python — context 進度條

```python
#!/usr/bin/env python3
import json, sys

# json.load reads and parses stdin in one step
data = json.load(sys.stdin)
model = data['model']['display_name']
# "or 0" handles null values
pct = int(data.get('context_window', {}).get('used_percentage', 0) or 0)

# String multiplication builds the bar
filled = pct * 10 // 100
bar = '▓' * filled + '░' * (10 - filled)

print(f"[{model}] {bar} {pct}%")
```

來源：[1]

### 8.9 Python — 模型 + 目錄 + git branch + 成本 + context

```python
#!/usr/bin/env python3
import json
import sys
import os
import subprocess

data = json.load(sys.stdin)

model = data["model"]["display_name"]
current_dir = os.path.basename(data["workspace"]["current_dir"])
cost = data.get("cost", {}).get("total_cost_usd", 0)
ctx_pct = data.get("context_window", {}).get("used_percentage", 0)

# Get git branch
git_branch = ""
try:
    result = subprocess.run(
        ["git", "branch", "--show-current"],
        capture_output=True, text=True, timeout=2
    )
    if result.returncode == 0 and result.stdout.strip():
        git_branch = f" | {result.stdout.strip()}"
except Exception:
    pass

print(f"[{model}] {current_dir}{git_branch} | ${cost:.2f} | Ctx:{ctx_pct:.0f}%")
```

來源：[4]

### 8.10 Node.js — context 進度條

```javascript
#!/usr/bin/env node
// Node.js reads stdin asynchronously with events
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const data = JSON.parse(input);
    const model = data.model.display_name;
    // Optional chaining (?.) safely handles null fields
    const pct = Math.floor(data.context_window?.used_percentage || 0);

    // String.repeat() builds the bar
    const filled = Math.floor(pct * 10 / 100);
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);

    console.log(`[${model}] ${bar} ${pct}%`);
});
```

來源：[1]

### 8.11 Node.js — 模型 + 目錄 + git branch + 成本 + context

```javascript
#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const data = JSON.parse(input);

  const model = data.model.display_name;
  const currentDir = path.basename(data.workspace.current_dir);
  const cost = (data.cost?.total_cost_usd || 0).toFixed(2);
  const ctxPct = Math.round(data.context_window?.used_percentage || 0);

  // Get git branch
  let gitBranch = "";
  try {
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (branch) gitBranch = ` | ${branch}`;
  } catch (e) {}

  console.log(
    `[${model}] ${currentDir}${gitBranch} | $${cost} | Ctx:${ctxPct}%`,
  );
});
```

來源：[4]

### 8.12 Bash — 用 current_usage 自行計算 context 百分比

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
CONTEXT_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size')
USAGE=$(echo "$input" | jq '.context_window.current_usage')

if [ "$USAGE" != "null" ]; then
    CURRENT_TOKENS=$(echo "$USAGE" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
    PERCENT_USED=$((CURRENT_TOKENS * 100 / CONTEXT_SIZE))
    echo "[$MODEL] Context: ${PERCENT_USED}% (${CURRENT_TOKENS}/${CONTEXT_SIZE} tokens)"
else
    echo "[$MODEL] Context: 0%"
fi
```

來源：[4]

### 8.13 進階 Bash — RGB 漸層 + 動態 emoji + 成本 + code velocity（gist）

設計重點：TrueColor 漸層（綠→黃→紅）、依用量切換 emoji（🟢 / ⚡ / 🔥 / 🚨）、百分比字色閾值（綠 <70%、黃 70–89%、紅 90%+）。[2]

```bash
#!/usr/bin/env bash
# Claude Code status line: RGB gradient, dynamic emoji, cost, code velocity

input=$(cat)

# ── Colors ──
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
MAGENTA='\033[35m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Truecolor helper ──
rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }

# ── Parse JSON fields ──
model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
lines_add=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_del=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')

# ── Git info ──
branch=""
repo=""
if [ -n "$cwd" ]; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
  repo=$(basename "$(git -C "$cwd" --no-optional-locks rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null)
fi

# ── Context bar: RGB gradient, full blocks only ──
BAR_WIDTH=20

if [ -n "$used" ]; then
  used_int=$(printf '%.0f' "$used")

  # Round to nearest block
  filled=$(( (used_int * BAR_WIDTH + 50) / 100 ))

  bar=""
  for (( i=0; i<BAR_WIDTH; i++ )); do
    pos=$(( i * 100 / (BAR_WIDTH - 1) ))

    if [ "$pos" -le 50 ]; then
      r=$(( 0 + 220 * pos / 50 ))
      g=200
      b=$(( 80 - 80 * pos / 50 ))
    else
      adj=$(( pos - 50 ))
      r=220
      g=$(( 200 - 160 * adj / 50 ))
      b=$(( 0 + 20 * adj / 50 ))
    fi

    if [ "$i" -lt "$filled" ]; then
      bar="${bar}$(rgb $r $g $b)█"
    else
      bar="${bar}\033[38;2;60;60;60m░"
    fi
  done
  bar="${bar}${RESET}"

  if [ "$used_int" -ge 90 ]; then status_emoji="🚨"
  elif [ "$used_int" -ge 70 ]; then status_emoji="🔥"
  elif [ "$used_int" -ge 20 ]; then status_emoji="⚡"
  else status_emoji="🟢"; fi

  if [ "$used_int" -ge 90 ]; then pct_color="$RED"
  elif [ "$used_int" -ge 70 ]; then pct_color="$YELLOW"
  else pct_color="$GREEN"; fi

  ctx_part="${status_emoji} ${bar} ${pct_color}${used_int}%${RESET}"
else
  ctx_part="🟢 \033[38;2;60;60;60m░░░░░░░░░░░░░░░░░░░░${RESET} --%"
fi

# ── Cost ──
cost_part="${YELLOW}$(printf '$%.2f' "$cost")${RESET}"

# ── Code velocity ──
velocity="${GREEN}+${lines_add}${RESET} ${RED}-${lines_del}${RESET}"

# ── Single line ──
out=""
[ -n "$repo" ] && out="${BOLD}${YELLOW}${repo}${RESET}"
[ -n "$branch" ] && out="${out:+$out }${BOLD}${CYAN}🌿 (${branch})${RESET}"
out="${out:+$out ${DIM}|${RESET} }${ctx_part}"
out="${out} ${DIM}|${RESET} ${cost_part}"
out="${out} ${DIM}|${RESET} ${velocity}"
out="${out} ${DIM}|${RESET} ${MAGENTA}🤖 ${model}${RESET}"

printf '%b' "$out"
```

來源：[2]

---

## 9. Windows / PowerShell

### 9.1 PowerShell settings.json

```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1"
  }
}
```

來源：[1]

Medium 文章 [3] 採用的變體（含 ExecutionPolicy）：

```json
"statusLine": {
    "type": "command",
    "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\User\\.claude\\statusline.ps1\""
  }
```

### 9.2 官方精簡 PowerShell 腳本

```powershell
$input_json = $input | Out-String | ConvertFrom-Json
$cwd = $input_json.cwd
$model = $input_json.model.display_name
$used = $input_json.context_window.used_percentage
$dirname = Split-Path $cwd -Leaf

if ($used) {
    Write-Host "$dirname [$model] ctx: $used%"
} else {
    Write-Host "$dirname [$model]"
}
```

來源：[1]

### 9.3 進階 PowerShell 腳本（ANSI 色 + 編碼處理）

要點（來源 [3]）：
- 設定輸出編碼：`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
- 讀 stdin 用 `[System.IO.StreamReader]::new([System.Console]::OpenStandardInput())`，讀到底後 `Close()`
- ANSI escape 用 `$([char]27)[...m`
- 輸出用 `[System.Console]::Write()` 而**非** `Write-Host`，寫完 `[System.Console]::Out.Flush()`
- 腳本結尾務必 `exit 0`

```powershell
# Claude Code Advanced StatusLine PowerShell Script for Windows 11
# Display model name in orange color using ANSI escape codes

param()

# Set PowerShell output encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Read JSON input from stdin
$jsonInput = ""
try {
    $inputStream = [System.IO.StreamReader]::new([System.Console]::OpenStandardInput())
    $jsonInput = $inputStream.ReadToEnd()
    $inputStream.Close()
}
catch {
    # Use default JSON if stdin read fails
    $jsonInput = '{"model":{"display_name":"Claude"}}'
}

try {
    # Parse JSON data
    $inputData = $jsonInput | ConvertFrom-Json

    # Extract model information
    $modelName = if ($inputData.model.display_name) { $inputData.model.display_name } else { "Claude" }
    $outputStyle = if ($inputData.output_style.name) { $inputData.output_style.name } else { "" }

    # Define ANSI color codes
    $orangeMedium = "$([char]27)[38;5;208m"
    $orangeBright = "$([char]27)[38;5;220m"
    $dimGray = "$([char]27)[2m"
    $bold = "$([char]27)[1m"
    $reset = "$([char]27)[0m"

    # Select orange color (bright for Haiku, medium for others)
    $orangeColor = $orangeMedium
    if ($modelName -like "*Haiku*") {
        $orangeColor = $orangeBright
    }

    # Build output string
    $outputText = "$orangeColor$bold$modelName$reset"

    # Add output style if present
    if ($outputStyle -and $outputStyle -ne "default") {
        $outputText = $outputText + " $dimGray($outputStyle)$reset"
    }

    # Write directly to standard output (do not use Write-Host)
    [System.Console]::Write($outputText)
    [System.Console]::Out.Flush()
}
catch {
    # Error handling: display default model name in orange
    $errorModel = "Claude"
    $orangeColor = "$([char]27)[38;5;208m"
    $bold = "$([char]27)[1m"
    $reset = "$([char]27)[0m"

    $outputText = "$orangeColor$bold$errorModel$reset"
    [System.Console]::Write($outputText)
    [System.Console]::Out.Flush()
}

exit 0
```

來源：[3]

### 9.4 Windows 使用 Git Bash 腳本（用正斜線）

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

來源：[1]

> 待查證（Windows 路徑踩坑）：disputed 區塊指出「`command` 字串中的 Windows 路徑反斜線會被 Git Bash 當 escape 字元吃掉導致靜默失敗」此機制說明的歸因（PowerShell vs Git Bash 場景）在來源中有混淆。可確認的事實是：官方 Git Bash 範例與 PowerShell 範例皆使用**正斜線** `C:/...`，PowerShell JSON 字串內的反斜線需轉義為 `\\`。實務建議統一使用正斜線。

---

## 10. 測試方法

用 mock JSON 直接餵給腳本驗證輸出（官方建議）：[1]

```bash
echo '{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/home/user/project"},"context_window":{"used_percentage":25},"session_id":"test-session-abc"}' | ./statusline.sh
```

gist 簡化測試：[2]

```bash
echo '{"model":{"display_name":"Opus"}}' | bash ~/.claude/statusline.sh
```

Bash 腳本記得賦予執行權限：[4]

```bash
chmod +x ~/.claude/statusline.sh
```

---

## 11. 效能與設計建議

- **快取慢操作**：大型 repo 中 `git status` 等 shell 檢查成本高，應在腳本內快取結果，快取檔名用 `session_id`（穩定唯一），不要用 `$$`（每次 invocation 都變）。[1]
- **`refreshInterval` 節制使用**：只在需要週期性重整（例如 idle 期間更新計時器、subagent 情境）時才設定，避免不必要的頻繁執行。[1][6]
- **防禦性讀取選填欄位**：`vim` / `agent` / `worktree` / `rate_limits` / `pr` / `effort` 不適用時是整個物件缺席（非 `null`），用 `// empty` / `// 0` / 條件判斷處理。[1][2]
- **跨 shell 輸出**：`printf '%b'` 比 `echo -e` 穩定。[1]

---

## 12. 第三方狀態列工具（社群）

> 以下為第三方工具介紹，非官方 spec 聲稱。部分工具的細節（如 ccusage / ccstatusline / claude-powerline 的完整 flag 清單）在 disputed 區塊被標為無法從主要抓取頁核實，本節僅列來源可確認的概況。

### 12.1 Owloops/claude-powerline [7]

vim-style powerline 狀態列，提供 `dark` / `light` / `nord` / `tokyo-night` / `rose-pine` / `gruvbox` 等主題。最小設定：

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx -y @owloops/claude-powerline@latest --style=powerline"
  }
}
```

CLI flags 含 `--theme`、`--style`（`minimal` / `powerline` / `capsule` / `tui`）、`--charset`、`--config`。環境變數含 `CLAUDE_POWERLINE_THEME` / `CLAUDE_POWERLINE_STYLE` / `CLAUDE_POWERLINE_CONFIG`，並尊重 `NO_COLOR` / `FORCE_COLOR` / `COLORTERM`。`statusLine.refreshInterval`（秒，最小 1）用於 idle 時更新 cache timer。可透過 plugin 安裝：`/plugin marketplace add Owloops/claude-powerline` → `/plugin install` → `/powerline`。[7]

### 12.2 sirmalloc/ccstatusline [6]

支援 powerline 風格、多種 widget（model / git / token usage / context bar / vim mode / thinking effort 等）、OSC8 link widget。三種 command 值：

```bash
npx -y ccstatusline@latest
bunx -y ccstatusline@latest
ccstatusline      # pinned global install
```

設定範例（`refreshInterval` 僅在 Claude Code >= 2.1.97 時寫入 settings.json）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline@latest",
    "padding": 0,
    "refreshInterval": 10
  }
}
```

其自身設定檔在 `~/.config/ccstatusline/settings.json`；git 快取在 `~/.cache/ccstatusline/git-cache`。環境變數含 `CLAUDE_CONFIG_DIR` / `HTTPS_PROXY` / `CCSTATUSLINE_WIDTH`。[6]

### 12.3 ccusage statusline [5]

成本 / context 追蹤狀態列：

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun x ccusage statusline",
    "padding": 0
  }
}
```

亦可 `npx -y ccusage statusline`。輸出含 session/today/block 成本、burn rate、context 用量等。

> 待查證：ccusage 的具體 flag 清單（`--no-offline` / `--visual-burn-rate` / `--cost-source` / `--context-low-threshold` / `--context-medium-threshold`）在 disputed 區塊被標為無法從主要抓取頁核實，僅供參考，使用前以官方文件為準。

---

## 參考來源

[1] Customize your status line — Claude Code Docs — https://code.claude.com/docs/en/statusline
[2] Claude Code Status Line — Complete Guide: all fields, config, ready-to-use scripts (GitHub Gist, AKCodez) — https://gist.github.com/AKCodez/ffb420ba6a7662b5c3dda2edce7783de
[3] How to Customize Claude Code StatusLine on Windows 11: A PowerShell Guide (Medium) — https://medium.com/@reahtuoo310109/how-to-customize-claude-code-statusline-on-windows-11-a-powershell-guide-f8a8b67d0071
[4] Claude Code Status Line Setup Guide (Scripts + Examples) — claudefa.st — https://claudefa.st/blog/tools/statusline-guide
[5] Statusline Integration (Beta) — ccusage — https://ccusage.com/guide/statusline
[6] GitHub — sirmalloc/ccstatusline — https://github.com/sirmalloc/ccstatusline
[7] GitHub — Owloops/claude-powerline — https://github.com/Owloops/claude-powerline
