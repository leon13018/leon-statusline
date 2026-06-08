# leon-statusline 開發記錄

本資料夾是 leon-statusline 的開發記錄與技術文件。
**僅存在於 GitHub repo，不會被打包進別人安裝的 plugin**（plugin 本體在 repo 根的 `leon-statusline/`，這個 `resources/` 在它之外）。

## 文件索引
- [development-journal.md](./development-journal.md) — 開發經過與日誌（從構想到 v1.1.1 的完整時間線）
- [technical-decisions.md](./technical-decisions.md) — 技術選型與每個關鍵決策的理由（含被否決的方案）
- [pitfalls.md](./pitfalls.md) — 開發中踩過的坑、症狀、根因與解法
- [statusline-attributes.md](./statusline-attributes.md) — 狀態列所有屬性 / 欄位資訊大全
- [plugin-dev-playbook.md](./plugin-dev-playbook.md) — 通用可重用 SOP（下次做任何 CC plugin 照走）
- [research/](./research/) — 開發前的調研資料（5 份）

## research/ 內容
| 檔案 | 主題 |
|---|---|
| `CC_statusline_config_research.md` | 狀態列基礎：settings.json 設定、stdin JSON 欄位、語法、範例 |
| `CC_statusline_crossplatform_impl_research.md` | 跨平台實作：MCP 偵測、路徑陷阱、runtime、永不崩潰、計數位置 |
| `CC_create_plugins_official_guide.md` | 官方「建立 plugin」指南 |
| `CC-hooks.md` | Claude Code hooks 參考 |
| `CC-skills.md` | Claude Code skills 參考 |
