# leon-statusline

跨平台（macOS / Windows / Linux）的 Claude Code 4 行狀態列 plugin。純 Node.js、零執行期依賴、**永不崩潰**。

> 本檔＝精簡導引。**檔案在哪 / 結構 → 讀 `CODE_MAP.md`（逐層下沉，每個子目錄各有自己的 CLAUDE.md + CODE_MAP.md）**。完整開發脈絡（為何/踩坑/欄位）→ `resources/`。

## 這個 repo 是什麼
一個 repo 兼作 plugin marketplace：
- `leon-statusline/` = **plugin 本體**（別人 `/plugin install` 會裝的部分）
- `resources/` = 開發記錄 + 調研（**只在 GitHub、不進別人的安裝包**）

## ⛔ 紅線（違反就壞東西）
1. **`plugin.json` 不要宣告主 `statusLine`** — 官方只支援 `agent` / `subagentStatusLine`；主 statusLine 由 `setup.mjs` 寫進使用者 settings.json。
2. **statusLine 命令不要留 `${CLAUDE_PLUGIN_ROOT}`** — 它在 statusLine render 時**不展開**（實測空白）。setup 寫**絕對路徑**，靠 SessionStart hook 在升級後自動重指。
3. **腳本內路徑一律 `os.homedir()` + `path.join()`** — 不信任 `~`、不字串拼 `/`/`\\`、不讀 `$HOME`/`%USERPROFILE%`。
4. **永不崩潰**：任何情況一律 `process.exit(0)`、至少印一行、子程序走快取不阻塞 render。
5. **改對外行為要 bump `leon-statusline/.claude-plugin/plugin.json` 的 `version`**，否則別人 `/plugin update` 收不到。
6. **`plugin.json` 不要宣告 `hooks`** — CC 會自動載入 `hooks/hooks.json`；manifest 再宣告會 **Duplicate-hooks 載入失敗**（`/doctor` 可見），害 SessionStart 自動重指 hook 載不進來。詳見 `resources/development-journal.md` §10。

## 慣例
- runtime = Node（ESM `.mjs`）；測試 = Vitest（dev-only）。改 code **先紅後綠（TDD）、逐 task commit**。
- 產出物（doc / 程式碼註解 / commit message）用**繁體中文**。

## 導航
- 結構 / 檔案索引 → **`CODE_MAP.md`**
- plugin 本體細節 → `leon-statusline/CLAUDE.md`
- 開發經過 / 決策 / 踩坑 / 屬性資訊 → `resources/CLAUDE.md`
