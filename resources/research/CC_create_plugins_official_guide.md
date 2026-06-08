> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 建立 plugins

> 建立自訂 plugins 以使用 skills、agents、hooks 和 MCP servers 擴展 Claude Code。

Plugins 讓您使用可在專案和團隊中共享的自訂功能來擴展 Claude Code。本指南涵蓋使用 skills、agents、hooks 和 MCP servers 建立您自己的 plugins。

想要安裝現有的 plugins？請參閱[探索和安裝 plugins](/zh-TW/discover-plugins)。如需完整的技術規格，請參閱 [Plugins 參考](/zh-TW/plugins-reference)。

## 何時使用 plugins 與獨立配置

Claude Code 支援兩種方式來新增自訂 skills、agents 和 hooks：

| 方法                                                                            | Skill 名稱             | 最適合                       |
| :---------------------------------------------------------------------------- | :------------------- | :------------------------ |
| **獨立**（`.claude/` 目錄）                                                         | `/hello`             | 個人工作流程、專案特定的自訂、快速實驗       |
| **Plugins**（包含 skills、agents、hooks 或 `.claude-plugin/plugin.json` 資訊清單的自包含目錄） | `/plugin-name:hello` | 與隊友共享、分發到社群、版本化發佈、跨專案重複使用 |

**在以下情況下使用獨立配置**：

* 您正在為單一專案自訂 Claude Code
* 配置是個人的，不需要共享
* 您在將 skills 或 hooks 打包之前進行實驗
* 您想要簡短的 skill 名稱，例如 `/hello` 或 `/deploy`

**在以下情況下使用 plugins**：

* 您想與您的團隊或社群共享功能
* 您需要在多個專案中使用相同的 skills/agents
* 您想要版本控制和輕鬆更新您的擴展
* 您正在透過市場進行分發
* 您可以接受命名空間化的 skills，例如 `/my-plugin:hello`（命名空間可防止 plugins 之間的衝突）

<Tip>
  在 `.claude/` 中從獨立配置開始進行快速迭代，然後在準備好共享時[轉換為 plugin](#convert-existing-configurations-to-plugins)。
</Tip>

## 快速入門

本快速入門將引導您建立具有自訂 skill 的 plugin。您將建立一個清單（定義您的 plugin 的配置檔案）、新增一個 skill，並使用 `--plugin-dir` 旗標在本地進行測試。

### 先決條件

* Claude Code [已安裝並驗證](/zh-TW/quickstart#step-1-install-claude-code)

<Note>
  如果您沒有看到 `/plugin` 命令，請將 Claude Code 更新到最新版本。如需升級說明，請參閱 [Troubleshooting](/zh-TW/troubleshooting)。
</Note>

### 建立您的第一個 plugin

<Steps>
  <Step title="建立 plugin 目錄">
    每個 plugin 都位於其自己的目錄中，包含您的 skills、agents 或 hooks，可選地與 `.claude-plugin/plugin.json` 清單並存。現在建立一個：

    ```bash theme={null}
    mkdir my-first-plugin
    ```
  </Step>

  <Step title="建立 plugin 清單">
    位於 `.claude-plugin/plugin.json` 的清單檔案定義您的 plugin 的身份：其名稱、描述和版本。Claude Code 使用此中繼資料在 plugin 管理器中顯示您的 plugin。

    在您的 plugin 資料夾內建立 `.claude-plugin` 目錄：

    ```bash theme={null}
    mkdir my-first-plugin/.claude-plugin
    ```

    然後使用此內容建立 `my-first-plugin/.claude-plugin/plugin.json`：

    ```json my-first-plugin/.claude-plugin/plugin.json theme={null}
    {
      "name": "my-first-plugin",
      "description": "A greeting plugin to learn the basics",
      "version": "1.0.0",
      "author": {
        "name": "Your Name"
      }
    }
    ```

    | 欄位            | 用途                                                                                                                                         |
    | :------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
    | `name`        | 唯一識別碼和 skill 命名空間。Skills 以此為前綴（例如 `/my-first-plugin:hello`）。                                                                               |
    | `description` | 在瀏覽或安裝 plugins 時在 plugin 管理器中顯示。                                                                                                           |
    | `version`     | 選用。如果設定，使用者只會在您更新此欄位時收到更新。如果省略且您的 plugin 透過 git 分發，則使用 commit SHA，每個 commit 都算作新版本。請參閱[版本管理](/zh-TW/plugins-reference#version-management)。 |
    | `author`      | 選用。有助於歸屬。                                                                                                                                  |

    如需 `homepage`、`repository` 和 `license` 等其他欄位，請參閱[完整清單架構](/zh-TW/plugins-reference#plugin-manifest-schema)。
  </Step>

  <Step title="新增 skill">
    Skills 位於 `skills/` 目錄中。每個 skill 是一個包含 `SKILL.md` 檔案的資料夾。資料夾名稱成為 skill 名稱，以 plugin 的命名空間為前綴（在名為 `my-first-plugin` 的 plugin 中的 `hello/` 建立 `/my-first-plugin:hello`）。

    在您的 plugin 資料夾中建立一個 skill 目錄：

    ```bash theme={null}
    mkdir -p my-first-plugin/skills/hello
    ```

    然後使用此內容建立 `my-first-plugin/skills/hello/SKILL.md`：

    ```markdown my-first-plugin/skills/hello/SKILL.md theme={null}
    ---
    description: Greet the user with a friendly message
    disable-model-invocation: true
    ---

    Greet the user warmly and ask how you can help them today.
    ```
  </Step>

  <Step title="測試您的 plugin">
    使用 `--plugin-dir` 旗標執行 Claude Code 以載入您的 plugin：

    ```bash theme={null}
    claude --plugin-dir ./my-first-plugin
    ```

    Claude Code 啟動後，嘗試您的新 skill：

    ```shell theme={null}
    /my-first-plugin:hello
    ```

    您將看到 Claude 以問候語回應。執行 `/help` 以查看您的 skill 列在 plugin 命名空間下。

    <Note>
      **為什麼要命名空間？** Plugin skills 始終被命名空間化（例如 `/my-first-plugin:hello`），以防止多個 plugins 具有相同名稱的 skills 時發生衝突。

      若要變更命名空間前綴，請更新 `plugin.json` 中的 `name` 欄位。
    </Note>
  </Step>

  <Step title="新增 skill 引數">
    透過接受使用者輸入使您的 skill 動態化。`$ARGUMENTS` 佔位符會擷取使用者在 skill 名稱後提供的任何文字。

    更新您的 `SKILL.md` 檔案：

    ```markdown my-first-plugin/skills/hello/SKILL.md theme={null}
    ---
    description: Greet the user with a personalized message
    ---

    # Hello Skill

    Greet the user named "$ARGUMENTS" warmly and ask how you can help them today. Make the greeting personal and encouraging.
    ```

    執行 `/reload-plugins` 以取得變更，然後嘗試使用您的名稱執行 skill：

    ```shell theme={null}
    /my-first-plugin:hello Alex
    ```

    Claude 將按名稱向您問候。如需有關將引數傳遞給 skills 的更多資訊，請參閱 [Skills](/zh-TW/skills#pass-arguments-to-skills)。
  </Step>
</Steps>

您已成功建立並測試了具有這些關鍵元件的 plugin：

* **Plugin 清單** (`.claude-plugin/plugin.json`)：描述您的 plugin 的中繼資料
* **Skills 目錄** (`skills/`)：包含您的自訂 skills
* **Skill 引數** (`$ARGUMENTS`)：擷取使用者輸入以實現動態行為

<Tip>
  `--plugin-dir` 旗標對於開發和測試很有用。當您準備好與他人共享您的 plugin 時，請參閱[建立和分發 plugin 市場](/zh-TW/plugin-marketplaces)。
</Tip>

## 在您的 skills 目錄中開發 plugin

與其在每次啟動時傳遞 `--plugin-dir`，您可以在您的 skills 目錄中保留一個 plugin，並讓 Claude Code 自動載入它。`claude plugin init` 會為您建立一個：

```bash theme={null}
claude plugin init my-tool
```

這會建立 `~/.claude/skills/my-tool/`，其中包含 `.claude-plugin/plugin.json` 清單和一個入門 `SKILL.md`。在下一個工作階段中，它會以 `my-tool@skills-dir` 的形式載入，無需市場或安裝步驟。

如需自動載入規則、個人與專案範圍、工作區信任要求，以及如何更新或移除一個，請參閱 [Skills-directory plugins](/zh-TW/plugins-reference#skills-directory-plugins)。

## Plugin 結構概述

您已建立了具有 skill 的 plugin，但 plugins 可以包含更多內容：自訂 agents、hooks、MCP servers、LSP servers 和背景監視器。

<Warning>
  **常見錯誤**：不要將 `commands/`、`agents/`、`skills/` 或 `hooks/` 放在 `.claude-plugin/` 目錄內。只有 `plugin.json` 應該在 `.claude-plugin/` 內。所有其他目錄必須位於 plugin 根目錄級別。
</Warning>

| 目錄                | 位置         | 用途                                               |
| :---------------- | :--------- | :----------------------------------------------- |
| `.claude-plugin/` | Plugin 根目錄 | 包含 `plugin.json` 清單（如果元件使用預設位置，則為選用）             |
| `skills/`         | Plugin 根目錄 | 作為 `<name>/SKILL.md` 目錄的 Skills                  |
| `commands/`       | Plugin 根目錄 | 作為平面 Markdown 檔案的 Skills。新 plugins 請使用 `skills/` |
| `agents/`         | Plugin 根目錄 | 自訂 agent 定義                                      |
| `hooks/`          | Plugin 根目錄 | `hooks.json` 中的事件處理程式                            |
| `.mcp.json`       | Plugin 根目錄 | MCP server 配置                                    |
| `.lsp.json`       | Plugin 根目錄 | 用於程式碼智慧的 LSP server 配置                           |
| `monitors/`       | Plugin 根目錄 | `monitors.json` 中的背景監視器配置                        |
| `bin/`            | Plugin 根目錄 | 在啟用 plugin 時新增到 Bash tool 的 `PATH` 的可執行檔         |
| `settings.json`   | Plugin 根目錄 | 啟用 plugin 時應用的預設[設定](/zh-TW/settings)            |

<Note>
  **後續步驟**：準備好新增更多功能？跳至[開發更複雜的 plugins](#develop-more-complex-plugins) 以新增 agents、hooks、MCP servers 和 LSP servers。如需所有 plugin 元件的完整技術規格，請參閱 [Plugins 參考](/zh-TW/plugins-reference)。
</Note>

## 開發更複雜的 plugins

一旦您熟悉了基本 plugins，您就可以建立更複雜的擴展。

### 將 Skills 新增到您的 plugin

Plugins 可以包含 [Agent Skills](/zh-TW/skills) 以擴展 Claude 的功能。Skills 是模型調用的：Claude 根據任務上下文自動使用它們。

在您的 plugin 根目錄中新增 `skills/` 目錄，其中包含包含 `SKILL.md` 檔案的 Skill 資料夾：

```text theme={null}
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── code-review/
        └── SKILL.md
```

每個 `SKILL.md` 包含 YAML frontmatter 和說明。包含 `description` 以便 Claude 知道何時使用該 skill：

```yaml theme={null}
---
description: Reviews code for best practices and potential issues. Use when reviewing code, checking PRs, or analyzing code quality.
---

When reviewing code, check for:
1. Code organization and structure
2. Error handling
3. Security concerns
4. Test coverage
```

安裝 plugin 後，執行 `/reload-plugins` 以載入 Skills。如需完整的 Skill 編寫指南，包括漸進式揭露和工具限制，請參閱 [Agent Skills](/zh-TW/skills)。

### 將 LSP servers 新增到您的 plugin

<Tip>
  對於 TypeScript、Python 和 Rust 等常見語言，請從官方市場安裝預先建立的 LSP plugins。只有在您需要支援尚未涵蓋的語言時，才建立自訂 LSP plugins。
</Tip>

LSP（語言伺服器協議）plugins 為 Claude 提供即時程式碼智慧。如果您需要支援沒有官方 LSP plugin 的語言，您可以透過將 `.lsp.json` 檔案新增到您的 plugin 來建立自己的：

```json .lsp.json theme={null}
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": {
      ".go": "go"
    }
  }
}
```

安裝您的 plugin 的使用者必須在其機器上安裝語言伺服器二進位檔。

如需完整的 LSP 配置選項，請參閱 [LSP servers](/zh-TW/plugins-reference#lsp-servers)。

### 將背景監視器新增到您的 plugin

背景監視器讓您的 plugin 在背景中監視日誌、檔案或外部狀態，並在事件到達時通知 Claude。Claude Code 在 plugin 啟用時自動啟動每個監視器，因此您不需要指示 Claude 啟動監視。

在 plugin 根目錄中新增 `monitors/monitors.json` 檔案，其中包含監視器項目的陣列：

```json monitors/monitors.json theme={null}
[
  {
    "name": "error-log",
    "command": "tail -F ./logs/error.log",
    "description": "Application error log"
  }
]
```

來自 `command` 的每個 stdout 行都會在工作階段期間作為通知傳遞給 Claude。如需完整的架構，包括 `when` 觸發器和變數替換，請參閱 [Monitors](/zh-TW/plugins-reference#monitors)。

### 使用您的 plugin 提供預設設定

Plugins 可以在 plugin 根目錄中包含 `settings.json` 檔案，以在啟用 plugin 時應用預設配置。目前，只支援 `agent` 和 `subagentStatusLine` 金鑰。

設定 `agent` 會啟動 plugin 的其中一個[自訂 agents](/zh-TW/sub-agents) 作為主執行緒，應用其系統提示、工具限制和模型。這讓 plugin 可以在啟用時透過預設方式變更 Claude Code 的行為。

```json settings.json theme={null}
{
  "agent": "security-reviewer"
}
```

此範例啟動在 plugin 的 `agents/` 目錄中定義的 `security-reviewer` agent。來自 `settings.json` 的設定優先於在 `plugin.json` 中宣告的 `settings`。未知的金鑰會被無聲地忽略。

### 組織複雜的 plugins

對於具有許多元件的 plugins，請按功能組織您的目錄結構。如需完整的目錄配置和組織模式，請參閱 [Plugin 目錄結構](/zh-TW/plugins-reference#plugin-directory-structure)。

### 在本地測試您的 plugins

使用 `--plugin-dir` 旗標在開發期間測試 plugins。這會直接載入您的 plugin，無需安裝。

```bash theme={null}
claude --plugin-dir ./my-plugin
```

該旗標也接受 plugin 目錄的 `.zip` 檔案，這需要 Claude Code v2.1.128 或更新版本。

```bash theme={null}
claude --plugin-dir ./my-plugin.zip
```

當 `--plugin-dir` plugin 與已安裝的市場 plugin 具有相同名稱時，本地副本在該工作階段中優先。這讓您可以測試已安裝的 plugin 的變更，而無需先卸載它。由受管設定強制啟用或強制停用的 plugins 是唯一的例外：`--plugin-dir` 無法覆蓋這些。

當您對 plugin 進行變更時，執行 `/reload-plugins` 以取得更新，無需重新啟動。這會重新載入 plugins、skills、agents、hooks、plugin MCP servers 和 plugin LSP servers。測試您的 plugin 元件：

* 使用 `/plugin-name:skill-name` 嘗試您的 skills
* 檢查 agents 是否出現在 `/agents` 中
* 驗證 hooks 是否按預期工作

<Tip>
  您可以透過多次指定旗標來一次載入多個 plugins：

  ```bash theme={null}
  claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
  ```
</Tip>

若要測試已打包為 `.zip` 檔案並託管在 URL 上的 plugin（例如 CI 建置成品），請改用 `--plugin-url`。Claude Code 在啟動時擷取檔案並僅為該工作階段載入它。如果擷取失敗或檔案無效，Claude Code 會報告 plugin 載入錯誤並在沒有它的情況下啟動。與任何 plugin 來源相同的[信任考量](/zh-TW/discover-plugins#security)適用：只將此旗標指向您控制或信任的檔案。

若要載入多個 plugins，請為每個 URL 重複該旗標：

```bash theme={null}
claude --plugin-url https://example.com/my-plugin.zip --plugin-url https://example.com/other.zip
```

或將以空格分隔的 URL 作為一個引用的引數傳遞：

```bash theme={null}
claude --plugin-url "https://example.com/my-plugin.zip https://example.com/other.zip"
```

### 偵錯 plugin 問題

如果您的 plugin 未按預期工作：

1. **檢查結構**：確保您的目錄位於 plugin 根目錄，而不是在 `.claude-plugin/` 內
2. **個別測試元件**：分別檢查每個 skill、agent 和 hook
3. **使用驗證和偵錯工具**：如需 CLI 命令和故障排除技術，請參閱 [Debugging and development tools](/zh-TW/plugins-reference#debugging-and-development-tools)

### 共享您的 plugins

當您的 plugin 準備好共享時：

1. **新增文件**：包含 `README.md`，其中包含安裝和使用說明
2. **選擇版本控制策略**：決定是否設定明確的 `version` 或依賴 git commit SHA。請參閱 [version management](/zh-TW/plugins-reference#version-management)
3. **建立或使用市場**：透過 [plugin marketplaces](/zh-TW/plugin-marketplaces) 進行分發以進行安裝
4. **與他人測試**：在更廣泛的分發之前讓團隊成員測試 plugin

一旦您的 plugin 在市場中，其他人可以使用 [Discover and install plugins](/zh-TW/discover-plugins) 中的說明進行安裝。若要將 plugin 保持在您的團隊內部，請在 [private repository](/zh-TW/plugin-marketplaces#private-repositories) 中託管市場。

### 將您的 plugin 提交到官方市場

Anthropic 為 Claude Code plugins 維護兩個公開市場：

* **`claude-plugins-official`**：由 Anthropic 維護的精選 plugins 集合。在每個 Claude Code 安裝中自動可用。
* **`claude-community`**：公開社群市場，第三方提交在審查後會進入此市場。使用者使用 `/plugin marketplace add anthropics/claude-plugins-community` 新增它，並將其作為 `@claude-community` 進行安裝。

若要提交您的 plugin 以進行官方市場審查，請使用其中一個應用內提交表單：

* **Claude.ai**：[claude.ai/settings/plugins/submit](https://claude.ai/settings/plugins/submit)
* **Console**：[platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit)

在提交前在本地執行 `claude plugin validate`。審查管道在每個提交上執行相同的檢查，以及自動安全篩選。

已批准的 plugins 會固定到 [`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community) 目錄中的特定 commit SHA，當您將新 commits 推送到您的儲存庫時，CI 會自動更新該固定。公開目錄每晚從審查管道同步，因此批准和您的 plugin 出現在 `marketplace.json` 之間可能會有延遲。若要檢查您的 plugin 是否已可安裝，請在[官方目錄](https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json)中搜尋其名稱。

官方市場 `claude-plugins-official` 是單獨策劃的。Anthropic 根據其自行決定決定要包含哪些 plugins。沒有應用程序流程，提交表單不會將 plugins 新增到官方市場。

如果 Anthropic 在官方市場中列出您的 plugin，您的 CLI 可以提示 Claude Code 使用者進行安裝。請參閱 [Recommend your plugin from your CLI](/zh-TW/plugin-hints)。

<Note>
  如需完整的技術規格、偵錯技術和分發策略，請參閱 [Plugins reference](/zh-TW/plugins-reference)。
</Note>

## 將現有配置轉換為 plugins

如果您已經在 `.claude/` 目錄中有 skills 或 hooks，您可以將它們轉換為 plugin，以便更輕鬆地共享和分發。

### 遷移步驟

<Steps>
  <Step title="建立 plugin 結構">
    建立新的 plugin 目錄：

    ```bash theme={null}
    mkdir -p my-plugin/.claude-plugin
    ```

    在 `my-plugin/.claude-plugin/plugin.json` 建立清單檔案：

    ```json my-plugin/.claude-plugin/plugin.json theme={null}
    {
      "name": "my-plugin",
      "description": "Migrated from standalone configuration",
      "version": "1.0.0"
    }
    ```
  </Step>

  <Step title="複製您現有的檔案">
    將您現有的配置複製到 plugin 目錄：

    ```bash theme={null}
    # Copy commands
    cp -r .claude/commands my-plugin/

    # Copy agents (if any)
    cp -r .claude/agents my-plugin/

    # Copy skills (if any)
    cp -r .claude/skills my-plugin/
    ```
  </Step>

  <Step title="遷移 hooks">
    如果您在設定中有 hooks，請建立一個 hooks 目錄：

    ```bash theme={null}
    mkdir my-plugin/hooks
    ```

    使用您的 hooks 配置建立 `my-plugin/hooks/hooks.json`。從您的 `.claude/settings.json` 或 `settings.local.json` 複製 `hooks` 物件，因為格式相同。命令在 stdin 上接收 hook 輸入作為 JSON，因此使用 `jq` 來提取檔案路徑：

    ```json my-plugin/hooks/hooks.json theme={null}
    {
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npm run lint:fix" }]
          }
        ]
      }
    }
    ```
  </Step>

  <Step title="測試您遷移的 plugin">
    載入您的 plugin 以驗證一切正常：

    ```bash theme={null}
    claude --plugin-dir ./my-plugin
    ```

    測試每個元件：執行您的命令、檢查 agents 是否出現在 `/agents` 中，並驗證 hooks 是否正確觸發。
  </Step>
</Steps>

### 遷移時的變更

| 獨立（`.claude/`）           | Plugin                       |
| :----------------------- | :--------------------------- |
| 僅在一個專案中可用                | 可以透過市場共享                     |
| `.claude/commands/` 中的檔案 | `plugin-name/commands/` 中的檔案 |
| `settings.json` 中的 Hooks | `hooks/hooks.json` 中的 Hooks  |
| 必須手動複製以共享                | 使用 `/plugin install` 安裝      |

<Note>
  遷移後，您可以從 `.claude/` 中移除原始檔案以避免重複。載入時，plugin 版本將優先。
</Note>

## 後續步驟

現在您已了解 Claude Code 的 plugin 系統，以下是針對不同目標的建議路徑：

### 對於 plugin 使用者

* [探索和安裝 plugins](/zh-TW/discover-plugins)：瀏覽市場並安裝 plugins
* [配置團隊市場](/zh-TW/discover-plugins#configure-team-marketplaces)：為您的團隊設定儲存庫級別的 plugins

### 對於 plugin 開發人員

* [建立和分發市場](/zh-TW/plugin-marketplaces)：打包和共享您的 plugins
* [Plugins 參考](/zh-TW/plugins-reference)：完整的技術規格
* 深入探討特定的 plugin 元件：
  * [Skills](/zh-TW/skills)：skill 開發詳情
  * [Subagents](/zh-TW/sub-agents)：agent 配置和功能
  * [Hooks](/zh-TW/hooks)：事件處理和自動化
  * [MCP](/zh-TW/mcp)：外部工具整合
