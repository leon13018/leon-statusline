# leon-statusline — plugin 本體

這層 = 會被別人安裝的 plugin payload；所有對外行為的程式碼都在這。

> 結構索引 → 同層 `CODE_MAP.md`。**repo 全域紅線在上層 `../CLAUDE.md`，此處不重述。**

## 這層慣例
- **ESM（`.mjs`）**。純函式邏輯放 `src/`；進入點 `statusline.mjs` 只負責 stdin → 組裝 → `exit 0`。
- 改任何 `.mjs`：先改 `tests/` 對應測試（紅）→ 實作（綠）→ `npx vitest run` 全綠才 commit。
- 進入點 `statusline.mjs` 的「永不崩潰」尤其關鍵（見 `../CLAUDE.md` 紅線 #4）。
- 改對外行為 → bump `.claude-plugin/plugin.json` 的 `version`。
- 路徑安全（紅線 #3）：一律 `os.homedir()` + `path.join()`。
