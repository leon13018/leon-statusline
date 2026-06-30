---
description: 把 leon-statusline 的 statusLine 重指到目前安裝版本（只重指既有的「本 plugin」statusLine，不安裝）。使用者明確呼叫才執行。
disable-model-invocation: true
---

# leon-statusline resync

把 settings.json 裡「本 plugin 的」 statusLine 重指到目前載入版本（等同 SessionStart hook 做的事，手動觸發）。**不會安裝**新的 statusLine。

步驟：
1. 執行：`node "${CLAUDE_PLUGIN_ROOT}/setup.mjs" --sync --report --root "${CLAUDE_PLUGIN_ROOT}"`
2. 解析輸出的 JSON 陣列（每個 scope 一筆），逐 scope 回報：
   - `repointed` → 「<scope>：重指 `<from>` → `<to>`（舊設定已備份 `<backup>`）」
   - `current` → 「<scope>：已是最新，未變動」
   - `foreign` → 「<scope>：偵測到非本 plugin 的 statusLine（或沒有），未動」
   - `absent` → 「<scope>：無 settings 檔，略過」
3. 若三個 scope 都沒有 `repointed`/`current`（全為 `foreign`/`absent`）→ 提示：「尚未安裝本 plugin 的 statusLine，請先跑 `/leon-statusline:setup-statusline`。」
