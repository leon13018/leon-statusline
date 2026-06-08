---
description: 安裝 leon-statusline 狀態列到 settings.json（user/project/local）。使用者明確呼叫才執行。
disable-model-invocation: true
---

# leon-statusline setup

把 leon-statusline 狀態列寫進 settings.json。範圍："$ARGUMENTS"（user / project / local，未給則預設 user）。

步驟：
1. 執行：`node "${CLAUDE_PLUGIN_ROOT}/setup.mjs" --root "${CLAUDE_PLUGIN_ROOT}" --scope <範圍>`
2. 若輸出含 `"existing":true`（目標 settings.json 已有 statusLine）：**停下來問使用者**「偵測到已有 statusLine，覆蓋（舊設定會自動備份）還是取消？」。
   - 同意覆蓋 → 重跑並加 `--force`。
   - 取消 → 不動，回報已取消。
3. 若 `"written":true` → 回報成功與 `backup` 備份路徑，提示重啟或 `/reload-plugins` 生效。
