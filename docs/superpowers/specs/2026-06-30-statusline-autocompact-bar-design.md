# 設計：第 1 行 context bar 改為「auto-compact %」

- 日期：2026-06-30
- 狀態：設計定稿，待實作
- 影響版本：`leon-statusline/.claude-plugin/plugin.json` 1.3.0 → **1.4.0**（對外顯示行為變更）

## 1. 背景與目標

第 1 行的 context bar 目前顯示 `context_window.used_percentage`（context window 已用 %）。改為顯示 **auto-compact %**：把已用量換算到「auto-compact 觸發門檻」，**100% = auto-compact 即將觸發**，比原始 context% 更有行動意義。

**關鍵事實（已查證）**：statusLine stdin JSON **沒有任何 auto-compact 欄位**；auto-compact 門檻官方未公開預設值，但有環境變數 `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`（context 容量百分比門檻 1–100）。因此 auto-compact % 只能由 `used_percentage` 對一個門檻 T 換算；T 由 env override 決定、否則用預設常數。

## 2. 範圍

- 新增 `leon-statusline/src/compact.mjs`（`autoCompactThreshold` + `autoCompactPct`）。
- 改 `leon-statusline/src/render.mjs` `renderLine1` 的 bar 元素。
- 改 `leon-statusline/statusline.mjs`：deps 解析一次門檻。
- **不動**：`color.mjs`（`gradientBar` 不變，照舊吃 0–100 的 pct）、其他 render 行、`setup.mjs`、`hooks`。
- bump `plugin.json` → `1.4.0`；更新 `statusline-attributes.md` / `CODE_MAP.md` / journal。

## 3. 行為規格

### 3.1 `src/compact.mjs`（純函式）

```js
export const DEFAULT_AUTOCOMPACT_PCT = 95
export function autoCompactThreshold(env = process.env) {
  const raw = Number(env.CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE)
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_AUTOCOMPACT_PCT
}
export function autoCompactPct(usedPercentage, threshold = autoCompactThreshold()) {
  if (usedPercentage == null || !Number.isFinite(usedPercentage)) return null
  return Math.max(0, Math.min(100, (usedPercentage / threshold) * 100))
}
```

- `autoCompactThreshold`：env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 為有效數（>0 且 ≤100）→ 用它；否則 `DEFAULT_AUTOCOMPACT_PCT`（95）。env 由參數注入以利測試。
- `autoCompactPct`：`usedPercentage` 為 `null`/非有限 → 回 `null`（讓 bar 走「沒抓到」路徑）；否則 `used / threshold * 100`，夾在 0–100。

### 3.2 `statusline.mjs`（進入點）

deps 新增（解析一次，集中讀 env、render 不碰 env）：

```js
autoCompactThreshold: autoCompactThreshold(),
```

（從 `./src/compact.mjs` import `autoCompactThreshold`。）

### 3.3 `renderLine1` 的 bar 元素

原本：

```js
gradientBar(cw.used_percentage),
```

改為（加 `compact` DIM 標籤 + 換算後 pct）：

```js
colorize('compact', DIM) + ' ' + gradientBar(autoCompactPct(cw.used_percentage, deps.autoCompactThreshold)),
```

- **標籤 `compact`**（DIM 灰）標示語意已從 context% 改為 auto-compact%。
- **顏色**：沿用 `gradientBar` 既有綠→紅位置漸層（低=綠、接近門檻=紅），與「填滿=危險」一致。`gradientBar` 不需改。
- **永不隱藏（沿用 1.2.0）**：`used_percentage` 缺 → `autoCompactPct` 回 `null` → `gradientBar(null)` → `░×20 n/a`，整個元素顯示為 `compact ░░…░ n/a`。
- **真實 0**：`used_percentage:0` → `autoCompactPct` 回 `0` → `gradientBar(0)` → `░×20 0%`，顯示 `compact ░░…░ 0%`。

> 註：`deps.autoCompactThreshold` 為 `undefined` 時（如部分既有測試未注入），`autoCompactPct` 的預設參數會呼叫 `autoCompactThreshold()` 自行解析（讀 env→預設 95），行為仍正確。

## 4. 已知限制（誠實標註於文件）

- CC 真實 auto-compact 門檻未公開 → 用預設 95% / env override **近似**。
- `autoCompactWindow`（compaction 的 token 容量）無法從 stdin 讀，**假設等於 `context_window_size`**（對 1M context 使用者成立；若使用者另設 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 與 window 不同則會偏差）。
- 以上在 `statusline-attributes.md` 標明此 bar 為「近似」。

## 5. 測試（TDD，先紅後綠）

- 新增 `leon-statusline/tests/compact.test.mjs`：
  - `autoCompactThreshold`：env 給 `'80'` → 80；env 給 `'0'`/`'150'`/`'abc'`/未設 → 95（預設）。
  - `autoCompactPct`：`null`→`null`；`undefined`→`null`；`0`→`0`；`(47.5, 95)`→`50`；`(95, 95)`→`100`；`(120, 95)`→`100`（cap）；不給 threshold 時用預設。
- `leon-statusline/tests/render.test.mjs`（`renderLine1`）：
  - `used_percentage:47.5` + `deps.autoCompactThreshold:95` → bar 含 `50%`、輸出含 `compact`。
  - 空 `d` → 含 `compact` 與 `n/a`（bar 沒抓到）。
  - `used_percentage:0` → bar 含 `0%`（真 0，非 n/a）。
  - 既有 renderLine1 斷言若依賴舊 bar 數字 → 一併更新。
- 全套 `npx vitest run` 全綠才逐 task commit。

## 6. 版本與文件

- `leon-statusline/.claude-plugin/plugin.json`：`1.3.0` → `1.4.0`。
- `resources/statusline-attributes.md`：第 1 行 context bar 那列改述為「auto-compact %（used 對 auto-compact 門檻換算；門檻 env `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` 否則預設 95%；近似值）」。
- `leon-statusline/CODE_MAP.md`：src 區塊加 `compact.mjs`。
- `resources/development-journal.md`：版本沿革加 1.4.0 列。
