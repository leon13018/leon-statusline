# compact bar 改讀真實 auto-compact 視窗 — 設計文件

**日期**：2026-06-30
**版本目標**：leon-statusline **1.4.1**（patch；修 1.4.0 剛上線的 compact bar）
**前置**：接續 `2026-06-30-statusline-autocompact-bar-design.md`（v1.4.0 把第 1 行 bar 改成 auto-compact %）。

---

## 1. 問題（root cause）

v1.4.0 的 compact bar 公式是 `compact% = used_percentage ÷ 95`，其中

- `used_percentage = total_input_tokens ÷ context_window_size`（相對**模型滿窗**，1M／200k），
- `95` 是寫死的「門檻百分比」近似。

但使用者用 `/autocompact` 設定的「auto-compact 視窗」是 **token 數**，實際寫進 `~/.claude/settings.json` 的 **`autoCompactWindow`** 欄位。改 `/autocompact`（如 500k↔1m）只動了 `autoCompactWindow`，而我們的公式從不讀它 → **bar 不隨 `/autocompact` 改變**。

**證據（4 來源一致）**：
1. 程式：公式兩個輸入都與 `autoCompactWindow` 無關。
2. 真實 stdin 擷取：`context_window` 無任何 compact 欄位（`total_input_tokens:95689, context_window_size:1000000, used_percentage:10`）。
3. 官方文件：auto-compact 視窗**不**經 stdin 傳給 statusline。
4. `~/.claude/settings.json`：`"autoCompactWindow": 1000000`（= 使用者設的 1m）。

**驗算**：95689 tokens，窗 1m → 9.6%、窗 500k → 19%。應幾乎砍半，但 bar 卡在 `10÷95 ≈ 10%`，與症狀完全吻合。

---

## 2. 目標

compact bar 顯示「**朝 auto-compact 觸發點填滿的真實進度**」，且**會隨 `/autocompact` 改變而即時變動**。沒設過 `/autocompact` 的使用者畫面不退步。永不崩潰、零執行期依賴不變。

---

## 3. 行為規格

### 3.1 公式（precedence）

```
有 autoCompactWindow（正數 tokens）
    → compact% = total_input_tokens ÷ autoCompactWindow × 100      （夾 0–100）
否則（後備近似）
    → compact% = used_percentage ÷ threshold                       （threshold＝env 或 95）
兩條路徑都拿不到輸入
    → null（gradientBar 顯示 ░×20 n/a、DIM，維持永不隱藏）
```

- **numerator** 用 `context_window.total_input_tokens`（與 CC 的 `used_percentage` 同基準：input＋cache_creation＋cache_read，不含 output）。
- **真實視窗優先**：只要 `autoCompactWindow` 是有效正數就走 token 路徑，env 與 95 一律被忽略。
- **夾值**：`total_input_tokens > autoCompactWindow` → >100 → 夾 100（紅，代表「已達／超過門檻、compaction 在即」）；負值 → 夾 0。

### 3.2 資料來源 & 精確度

- `autoCompactWindow` 只從 **`~/.claude/settings.json`（user 層）** 讀 —— 即 `/autocompact` 實際寫入處。**不**讀 project／local（YAGNI；`/autocompact` 不寫那裡）。
- **每次 render 即時讀**，不進 60s counts 快取 → 改 `/autocompact` 後下一次 render 立即反映。檔案小、`readJson` 容錯。

### 3.3 env override 去留

- 保留 `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`，但**只在「近似後備」路徑生效**（調整 95 那個門檻百分比）。有 `autoCompactWindow` 時忽略。
- precedence：`autoCompactWindow（tokens）` > `（env% 或 95）的近似`。

---

## 4. 架構 / 模組（沿用現有設計，I/O 注入 deps）

### 4.1 `src/compact.mjs`（維持純函式，不碰 fs）

- 既有 `DEFAULT_AUTOCOMPACT_PCT = 95`、`autoCompactThreshold(env)` 不動。
- **新增** `autoCompactWindow(settingsObjs)`：傳入 settings 物件陣列，依序回傳第一個 `autoCompactWindow` 為「有限正數」者，否則 `null`。
  ```js
  // settingsObjs：依優先序排好的 settings 物件（本版只傳 [userSettings]）
  export function autoCompactWindow(settingsObjs) {
    for (const s of settingsObjs || []) {
      const w = s && s.autoCompactWindow
      if (Number.isFinite(w) && w > 0) return w
    }
    return null
  }
  ```
- **改寫** `autoCompactPct`：改吃具名物件參數，token 路徑優先、否則近似、皆缺回 null。
  ```js
  export function autoCompactPct({ usedTokens, usedPercentage, window, threshold = autoCompactThreshold() } = {}) {
    if (Number.isFinite(window) && window > 0 && Number.isFinite(usedTokens) && usedTokens >= 0) {
      return Math.max(0, Math.min(100, (usedTokens / window) * 100))
    }
    if (usedPercentage == null || !Number.isFinite(usedPercentage)) return null
    return Math.max(0, Math.min(100, (usedPercentage / threshold) * 100))
  }
  ```

### 4.2 `src/count.mjs`

- 將私有 `readJson(file)` 改為 **export**（給 `statusline.mjs` 共用，DRY）。其餘不動。

### 4.3 `statusline.mjs`（進入點 / I/O 邊界）

- import `autoCompactWindow`（compact.mjs）與 `readJson`（count.mjs）。
- 每次 render 讀 `~/.claude/settings.json` → 算視窗，注入 deps：
  ```js
  const userSettings = readJson(join(home, '.claude', 'settings.json'))
  const deps = {
    ...,
    autoCompactThreshold: autoCompactThreshold(),
    autoCompactWindow: autoCompactWindow([userSettings]),   // 數字或 null
  }
  ```
- `join` 由 `node:path` import（紅線 #3：`homedir()` + `path.join()`，不字串拼路徑）。

### 4.4 `src/render.mjs`

- bar 行改傳具名物件：
  ```js
  gradientBar(autoCompactPct({
    usedTokens: cw.total_input_tokens,
    usedPercentage: cw.used_percentage,
    window: deps.autoCompactWindow,
    threshold: deps.autoCompactThreshold,
  }))
  ```
- `gradientBar`／`colorize('compact', DIM)` 維持不變（null→`░×20 n/a` DIM、真值→bar＋`NN%` 漸層）。

---

## 5. 錯誤處理 / 永不崩潰

- `readJson` try/catch → null；`autoCompactWindow` 對 null／0／負／非數一律回 null。
- `autoCompactPct` 任何缺值回 null → `gradientBar(null)` 顯示 n/a。
- 進入點維持 `process.exit(0)`、至少印一行；新增的檔案讀取全程容錯，不阻塞 render。

---

## 6. 測試（TDD 先紅後綠）

**`tests/compact.test.mjs`（補）**
- `autoCompactWindow`：挑陣列第一個有效正數；跳過 null／0／負／NaN／非數字；全無 → null。
- `autoCompactPct`（token 路徑）：`{usedTokens:95689, window:1000000}` → ≈9.5689；`window:500000` → ≈19.1378；`usedTokens > window` → 夾 100；負 usedTokens → 夾 0。
- `autoCompactPct`（近似後備）：無 window 時 `usedPercentage ÷ threshold`（沿用既有案例）；window 在但 usedTokens 缺 → 走近似；兩者皆缺 → null；env threshold 在後備路徑生效。

**`tests/render.test.mjs`（補）**
- `deps.autoCompactWindow` 有值 → bar 反映 `total_input_tokens ÷ window`（且 500k vs 1m 結果不同，鎖住「會隨視窗改變」）。
- 無 `deps.autoCompactWindow` → 走近似（沿用既有 bar 案例）。
- 第 1 行永不隱藏回歸測試仍綠。

**`tests/integration.test.mjs`**
- 仍 4 行、exit 0、空／壞 JSON 不崩。

---

## 7. 版本 / 文件

- bump `leon-statusline/.claude-plugin/plugin.json` `version` → **1.4.1**。
- `resources/statusline-attributes.md`：第 1 行 context bar 列改寫公式（真實視窗優先 + 後備近似 + 來源 `~/.claude/settings.json`）。
- `resources/development-journal.md`：版本沿革加 1.4.1 列、新增 §13（root cause + 真實視窗）。
- `leon-statusline/CODE_MAP.md`：`compact.mjs` 說明補 `autoCompactWindow`；`count.mjs` 註記 `readJson` export。

---

## 8. 非目標（YAGNI）

- 不讀 project／local 層 `autoCompactWindow`。
- 不在 stdin 缺欄位時去 spawn 任何子程序探測門檻。
- 不改 gradientBar 顏色／格數／`compact` 標籤。
