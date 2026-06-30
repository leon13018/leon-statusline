# CODE_MAP — plugin 本體（leon-statusline/leon-statusline）

## 進入點 / 設定 / 安裝
- `statusline.mjs` — **進入點**：讀 stdin JSON → `buildOutput` → `process.exit(0)`（永不崩潰）
- `setup.mjs` — 安裝/重指：
  - `targetPath(scope)` user/project/local 對應 settings.json
  - `mergeStatusLine` / `applySetup`（寫入，偵測既有 statusLine 不覆蓋）
  - `isOurs` / `applySync`（`--sync` 升級後自動重指、idempotent、寫前備份；回傳 `status`：absent/foreign/current/repointed）
  - CLI：`--scope` / `--force` / `--sync`（`--report` 逐 scope 印 JSON，給 resync skill 用）
- `.claude-plugin/plugin.json` — manifest（name/version；**不宣告 hooks**，靠 `hooks/hooks.json` 自動載入；重複宣告會 Duplicate-hooks 失敗）
- `hooks/hooks.json` — **SessionStart** → `setup.mjs --sync`（升級後自動重指路徑）
- `skills/setup-statusline/SKILL.md` — 指令 `/leon-statusline:setup-statusline`（驅動「偵測既有→問→覆蓋備份」互動）
- `skills/resync-statusline/SKILL.md` — 指令 `/leon-statusline:resync-statusline`（手動重指：跑 `setup.mjs --sync --report`、逐 scope 回報；只動「我們的」statusLine）
- `package.json` / `vitest.config.mjs` — dev 依賴（vitest）與測試設定

## src/（純函式邏輯，可獨立測）
- `color.mjs` — `colorize` / `gradientColor` / `gradientBar`（truecolor 平滑漸層）
- `compact.mjs` — `autoCompactThreshold`（env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 否則 95）/ `autoCompactWindow`（從 settings 取真實 token 視窗）/ `autoCompactPct`（token 視窗優先、否則近似，給第 1 行 bar）
- `format.mjs` — `fmtDuration` / `resetCountdown` / `shortPath` / `attr`（條件顯示單位）/ `joinLine`
- `input.mjs` — `parseInput`（容錯 JSON）
- `cache.mjs` — `cacheDir` / `withCache`（`session_id` key、TTL、never-throw）
- `git.mjs` — `gitInfo`（branch/staged/modified/ahead/behind；可注入 runner 供測試）
- `count.mjs` — `countInfra` + `countClaudeMd`/`countDirFiles`/`countSkillDirs`/`countMemory`/`countHooks`/`countEnabledPlugins`/`countMcp`/`memoryDirFor`；export `readJson`（給進入點讀 settings 共用）
- `render.mjs` — `renderLine1..4` / `buildOutput`（套條件顯示 + 顏色）

## tests/（Vitest，79 測試）
- `color` / `format` / `input` / `cache` / `git` / `count` / `render` / `integration` / `setup` `.test.mjs`
- `integration.test.mjs` 以子程序跑進入點，驗「空/壞 JSON/缺欄位 → exit 0 且至少一行」
