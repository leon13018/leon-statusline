> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用 skills 擴展 Claude

> 在 Claude Code 中建立、管理和分享 skills，以擴展 Claude 的功能。包括自訂命令和捆綁的 skills。

Skills 擴展了 Claude 能做的事情。建立一個 `SKILL.md` 檔案，其中包含說明，Claude 就會將其新增到其工具組中。Claude 在相關時會使用 skills，或者您可以直接使用 `/skill-name` 叫用一個。

當您不斷將相同的劇本、檢查清單或多步驟程序貼到聊天中時，或當 CLAUDE.md 的某個部分已成長為程序而不是事實時，請建立一個 skill。與 CLAUDE.md 內容不同，skill 的主體僅在使用時載入，因此長參考資料在您需要之前幾乎不花費任何成本。

<Note>
  對於內建命令（如 `/help` 和 `/compact`）以及捆綁的 skills（如 `/debug` 和 `/code-review`），請參閱[命令參考](/zh-TW/commands)。

  **自訂命令已合併到 skills 中。** `.claude/commands/deploy.md` 中的檔案和 `.claude/skills/deploy/SKILL.md` 中的 skill 都會建立 `/deploy` 並以相同方式運作。您現有的 `.claude/commands/` 檔案會繼續運作。Skills 新增了可選功能：支援檔案的目錄、[控制您或 Claude 是否叫用它們](#control-who-invokes-a-skill)的 frontmatter，以及 Claude 在相關時自動載入它們的能力。
</Note>

Claude Code skills 遵循 [Agent Skills](https://agentskills.io) 開放標準，該標準適用於多個 AI 工具。Claude Code 使用額外功能擴展了該標準，例如[叫用控制](#control-who-invokes-a-skill)、[subagent 執行](#run-skills-in-a-subagent)和[動態上下文注入](#inject-dynamic-context)。

## 捆綁的 skills

Claude Code 包含一組捆綁的 skills，在每個工作階段中都可用，包括 `/code-review`、`/batch`、`/debug`、`/loop` 和 `/claude-api`。與大多數內建命令不同，內建命令直接執行固定邏輯，捆綁的 skills 是基於提示的：它們為 Claude 提供詳細的劇本，並讓它使用其工具來協調工作。您叫用它們的方式與任何其他 skill 相同，輸入 `/` 後跟 skill 名稱。

捆綁的 skills 在[命令參考](/zh-TW/commands)中與內建命令一起列出，在「目的」欄中標記為 **Skill**。

### 執行並驗證您的應用程式

三個捆綁的 skills 一起工作以啟動您的應用程式，並針對執行中的應用程式確認變更，而不是只針對測試：

| Skill                  | 目的                                        |
| :--------------------- | :---------------------------------------- |
| `/run`                 | 啟動並驅動您的應用程式以查看變更是否有效                      |
| `/verify`              | 建置並執行您的應用程式以確認程式碼變更是否執行預期的操作，無需回退到測試或型別檢查 |
| `/run-skill-generator` | 教導 `/run` 和 `/verify` 如何建置和啟動您的專案         |

{/* min-version: 2.1.145 */}所有三個 skills 都需要 Claude Code v2.1.145 或更新版本。

`/run` 和 `/verify` 無需設定即可運作。它們根據您的專案類型（CLI、伺服器、TUI、瀏覽器驅動）以及您的 README、`package.json` 或 `Makefile` 中的內容推斷啟動。該推斷對於需要超出標準啟動的任何內容的專案變得不可靠：資料庫、env 檔案、圖形工作階段、多步驟建置。

`/run-skill-generator` 改為記錄配方。它從乾淨的環境中讓您的應用程式執行，捕捉有效的內容（安裝命令、env 變數、啟動指令碼），並將其提交為每個專案的 skill，位於 `.claude/skills/run-<name>/`。之後，`/run`、`/verify` 和儲存庫中的任何其他代理都遵循記錄的配方，而不是重新發現它。每個專案執行一次 `/run-skill-generator`，如果建置或啟動程序變更，則再次執行。

## 開始使用

### 建立您的第一個 skill

此範例建立一個 skill，總結您的 git 儲存庫中未提交的變更，並標記任何風險的內容。它在 Claude 讀取之前將即時 diff 拉入提示中，因此回應是基於您的實際工作樹，而不是 Claude 從開啟的檔案中猜測的內容。當您詢問您的變更時，Claude 會自動載入該 skill，或者您可以直接使用 `/summarize-changes` 叫用它。

<Steps>
  <Step title="建立 skill 目錄">
    在您的個人 skills 資料夾中為 skill 建立一個目錄。個人 skills 在您的所有專案中都可用。

    ```bash theme={null}
    mkdir -p ~/.claude/skills/summarize-changes
    ```
  </Step>

  <Step title="編寫 SKILL.md">
    每個 skill 都需要一個 `SKILL.md` 檔案，包含兩部分：YAML frontmatter（在 `---` 標記之間），告訴 Claude 何時使用該 skill，以及包含 Claude 在執行該 skill 時遵循的說明的 markdown 內容。目錄名稱變成您輸入的命令，`description` 幫助 Claude 決定何時自動載入該 skill。

    將此儲存到 `~/.claude/skills/summarize-changes/SKILL.md`：

    ```yaml theme={null}
    ---
    description: Summarizes uncommitted changes and flags anything risky. Use when the user asks what changed, wants a commit message, or asks to review their diff.
    ---

    ## Current changes

    !`git diff HEAD`

    ## Instructions

    Summarize the changes above in two or three bullet points, then list any risks you notice such as missing error handling, hardcoded values, or tests that need updating. If the diff is empty, say there are no uncommitted changes.
    ```

    `` !`git diff HEAD` `` 這一行使用[動態上下文注入](#inject-dynamic-context)：Claude Code 執行該命令，並在 Claude 看到 skill 內容之前將該行替換為其輸出，因此說明會隨著目前的 diff 已內聯而到達。
  </Step>

  <Step title="測試 skill">
    開啟一個 git 專案，對任何檔案進行小編輯，並透過執行 `claude` 啟動 Claude Code。您可以透過兩種方式測試該 skill。

    **讓 Claude 自動叫用它**，詢問與描述相符的內容：

    ```text theme={null}
    What did I change?
    ```

    **或直接使用 skill 名稱叫用它**：

    ```text theme={null}
    /summarize-changes
    ```

    無論哪種方式，Claude 都應該以您編輯的簡短摘要和風險清單進行回應。
  </Step>
</Steps>

### Skills 的位置

您儲存 skill 的位置決定了誰可以使用它：

| 位置 | 路徑                                        | 適用於        |
| :- | :---------------------------------------- | :--------- |
| 企業 | 請參閱[受管設定](/zh-TW/settings#settings-files) | 您組織中的所有使用者 |
| 個人 | `~/.claude/skills/<skill-name>/SKILL.md`  | 您的所有專案     |
| 專案 | `.claude/skills/<skill-name>/SKILL.md`    | 僅此專案       |
| 外掛 | `<plugin>/skills/<skill-name>/SKILL.md`   | 啟用外掛的位置    |

當 skills 在各個層級共享相同名稱時，企業會覆蓋個人，個人會覆蓋專案。外掛 skills 使用 `plugin-name:skill-name` 命名空間，因此它們不能與其他層級衝突。如果您在 `.claude/commands/` 中有檔案，它們的運作方式相同，但如果 skill 和命令共享相同名稱，skill 優先。

<Note>
  將 `.claude-plugin/plugin.json` 新增到 skill 資料夾，它會載入為名為 `<name>@skills-dir` 的[外掛](/zh-TW/plugins-reference#skills-directory-plugins)，因此它可以捆綁代理、hooks 和 MCP 伺服器。在專案的 `.claude/skills/` 中，這需要先接受工作區信任對話。
</Note>

#### 即時變更偵測

Claude Code 監視 skill 目錄以尋找檔案變更。在 `~/.claude/skills/`、專案 `.claude/skills/` 或 `--add-dir` 目錄內的 `.claude/skills/` 中新增、編輯或移除 skill 會在目前工作階段內生效，無需重新啟動。建立在工作階段開始時不存在的頂級 skills 目錄需要重新啟動 Claude Code，以便可以監視新目錄。

<Note>
  即時變更偵測僅涵蓋 `SKILL.md` 文字。對於也是[外掛](/zh-TW/plugins-reference#skills-directory-plugins)的 skill 資料夾，`hooks/`、`.mcp.json`、`agents/` 和 `output-styles/` 的變更需要 `/reload-plugins` 才能生效。
</Note>

#### 從父目錄和巢狀目錄自動發現

專案 skills 從您的起始目錄中的 `.claude/skills/` 以及直到儲存庫根目錄的每個父目錄中載入，因此在子目錄中啟動 Claude 仍會拾取在根目錄定義的 skills。當您在起始目錄下方的子目錄中使用檔案時，Claude Code 也會按需從巢狀 `.claude/skills/` 目錄發現 skills。例如，如果您正在編輯 `packages/frontend/` 中的檔案，Claude Code 也會在 `packages/frontend/.claude/skills/` 中尋找 skills。這支援 monorepo 設定，其中套件有自己的 skills。

每個 skill 是一個以 `SKILL.md` 作為進入點的目錄：

```text theme={null}
my-skill/
├── SKILL.md           # 主要說明（必需）
├── template.md        # Claude 要填入的範本
├── examples/
│   └── sample.md      # 顯示預期格式的範例輸出
└── scripts/
    └── validate.sh    # Claude 可以執行的指令碼
```

`SKILL.md` 包含主要說明，是必需的。其他檔案是可選的，讓您建立更強大的 skills：Claude 要填入的範本、顯示預期格式的範例輸出、Claude 可以執行的指令碼或詳細的參考文件。從您的 `SKILL.md` 參考這些檔案，以便 Claude 知道它們包含什麼以及何時載入它們。請參閱[新增支援檔案](#add-supporting-files)以取得更多詳細資訊。

<Note>
  `.claude/commands/` 中的檔案仍然有效，並支援相同的 [frontmatter](#frontmatter-reference)。建議使用 Skills，因為它們支援額外功能，例如支援檔案。
</Note>

#### 來自其他目錄的 skills

`--add-dir` 旗標和 `/add-dir` 命令[授予檔案存取權](/zh-TW/permissions#additional-directories-grant-file-access-not-configuration)而不是設定發現，但 skills 是例外：已新增目錄中的 `.claude/skills/` 會自動載入。此例外僅適用於 `--add-dir` 和 `/add-dir`。`settings.json` 中的 `permissions.additionalDirectories` 設定僅授予檔案存取權，不會載入 skills。請參閱[即時變更偵測](#live-change-detection)以了解編輯在工作階段期間如何被拾取。

其他 `.claude/` 設定（例如 subagents、命令和輸出樣式）不會從其他目錄載入。請參閱[例外表](/zh-TW/permissions#additional-directories-grant-file-access-not-configuration)以取得完整的載入和未載入內容清單，以及跨專案共享設定的建議方式。

<Note>
  來自 `--add-dir` 目錄的 CLAUDE.md 檔案預設不會載入。若要載入它們，請設定 `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`。請參閱[從其他目錄載入](/zh-TW/memory#load-from-additional-directories)。
</Note>

## 設定 skills

Skills 透過 `SKILL.md` 頂部的 YAML frontmatter 和隨後的 markdown 內容進行設定。

### Skills 內容的類型

Skill 檔案可以包含任何說明，但思考您想如何叫用它們有助於指導要包含的內容：

**參考內容**新增 Claude 應用於您目前工作的知識。慣例、模式、風格指南、領域知識。此內容內聯執行，以便 Claude 可以將其與您的對話上下文一起使用。

```yaml theme={null}
---
name: api-conventions
description: API design patterns for this codebase
---

When writing API endpoints:
- Use RESTful naming conventions
- Return consistent error formats
- Include request validation
```

**任務內容**為 Claude 提供特定動作的逐步說明，例如部署、提交或程式碼生成。這些通常是您想使用 `/skill-name` 直接叫用的動作，而不是讓 Claude 決定何時執行它們。新增 `disable-model-invocation: true` 以防止 Claude 自動觸發它。

```yaml theme={null}
---
name: deploy
description: Deploy the application to production
context: fork
disable-model-invocation: true
---

Deploy the application:
1. Run the test suite
2. Build the application
3. Push to the deployment target
```

您的 `SKILL.md` 可以包含任何內容，但思考您想如何叫用該 skill（由您、由 Claude 或兩者）以及您想在哪裡執行它（內聯或在 subagent 中）有助於指導要包含的內容。對於複雜的 skills，您也可以[新增支援檔案](#add-supporting-files)以保持主要 skill 的焦點。

保持內容本身簡潔。一旦 skill 載入，其內容[在整個回合中保持在上下文中](#skill-content-lifecycle)，因此每一行都是一個重複的令牌成本。陳述要做什麼，而不是敘述如何或為什麼，並應用與您對 [CLAUDE.md 內容](/zh-TW/best-practices#write-an-effective-claude-md)所做的相同簡潔性測試。

### Frontmatter 參考

除了 markdown 內容外，您可以使用 `SKILL.md` 檔案頂部 `---` 標記之間的 YAML frontmatter 欄位來設定 skill 行為：

```yaml theme={null}
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---

Your skill instructions here...
```

所有欄位都是可選的。建議只使用 `description`，以便 Claude 知道何時使用該 skill。

| 欄位                         | 必需 | 描述                                                                                                                                                                            |
| :------------------------- | :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | 否  | Skill 清單中顯示的顯示名稱。預設為目錄名稱。請參閱[skill 如何獲得其命令名稱](#how-a-skill-gets-its-command-name)以了解這與您輸入的名稱在 `/` 後的差異。                                                                       |
| `description`              | 建議 | Skill 的功能以及何時使用它。Claude 使用此來決定何時應用該 skill。如果省略，使用 markdown 內容的第一段。前置關鍵使用案例：結合的 `description` 和 `when_to_use` 文字在 skill 清單中截斷至 1,536 個字元以減少上下文使用。                              |
| `when_to_use`              | 否  | Claude 應何時叫用該 skill 的額外上下文，例如觸發短語或範例請求。附加到 skill 清單中的 `description`，並計入 1,536 個字元的上限。                                                                                         |
| `argument-hint`            | 否  | 自動完成期間顯示的提示，指示預期的引數。範例：`[issue-number]` 或 `[filename] [format]`。                                                                                                              |
| `arguments`                | 否  | 用於 skill 內容中[`$name` 替換](#available-string-substitutions)的具名位置引數。接受空格分隔的字串或 YAML 清單。名稱按順序對應到引數位置。                                                                             |
| `disable-model-invocation` | 否  | 設定為 `true` 以防止 Claude 自動載入此 skill。用於您想使用 `/name` 手動觸發的工作流程。也防止該 skill 被[預載入到 subagents](/zh-TW/sub-agents#preload-skills-into-subagents)。預設值：`false`。                         |
| `user-invocable`           | 否  | 設定為 `false` 以從 `/` 功能表中隱藏。用於使用者不應直接叫用的背景知識。預設值：`true`。                                                                                                                        |
| `allowed-tools`            | 否  | 當此 skill 處於作用中時，Claude 可以使用而無需詢問許可的工具。接受空格分隔的字串或逗號分隔的字串，或 YAML 清單。                                                                                                            |
| `disallowed-tools`         | 否  | 當此 skill 處於作用中時從 Claude 的可用工具池中移除的工具。用於不應呼叫某些工具的自主 skills，例如用於背景迴圈的 `AskUserQuestion`。接受空格分隔的字串或逗號分隔的字串，或 YAML 清單。限制在您傳送下一則訊息時清除。                                             |
| `model`                    | 否  | 當此 skill 處於作用中時要使用的模型。覆蓋適用於目前回合的其餘部分，不會儲存到設定；工作階段模型在您的下一個提示時恢復。接受與 [`/model`](/zh-TW/model-config) 相同的值，或 `inherit` 以保持作用中的模型。                                                |
| `effort`                   | 否  | 當此 skill 處於作用中時的[努力級別](/zh-TW/model-config#adjust-effort-level)。覆蓋工作階段努力級別。預設值：繼承自工作階段。選項：`low`、`medium`、`high`、`xhigh`、`max`；可用級別取決於模型。                                      |
| `context`                  | 否  | 設定為 `fork` 以在分叉的 subagent 上下文中執行。                                                                                                                                             |
| `agent`                    | 否  | 當設定 `context: fork` 時要使用的 subagent 類型。                                                                                                                                        |
| `hooks`                    | 否  | 限定於此 skill 生命週期的 hooks。請參閱 [Skills 和代理中的 Hooks](/zh-TW/hooks#hooks-in-skills-and-agents) 以取得設定格式。                                                                             |
| `paths`                    | 否  | Glob 模式，限制何時啟動此 skill。接受逗號分隔的字串或 YAML 清單。設定時，Claude 僅在使用與模式相符的檔案時自動載入該 skill。使用與[路徑特定規則](/zh-TW/memory#path-specific-rules)相同的格式。                                             |
| `shell`                    | 否  | 用於此 skill 中 `` !`command` `` 和 ` ```! ` 區塊的 shell。接受 `bash`（預設）或 `powershell`。設定 `powershell` 會在 Windows 上透過 PowerShell 執行內聯 shell 命令。需要 `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`。 |

#### Skill 如何獲得其命令名稱

您輸入以叫用 skill 的命令來自 skill 檔案的位置。Frontmatter `name` 欄位設定在 skill 清單中顯示的顯示標籤，除了外掛根目錄 `SKILL.md` 外，不會改變您在 `/` 後輸入的內容。

下表顯示每個配置的命令名稱來自何處：

| Skill 位置                                            | 命令名稱來源                         | 範例                                                                                                                     |
| :-------------------------------------------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/skills/` 或 `.claude/skills/` 下的 Skill 目錄 | 目錄名稱                           | `.claude/skills/deploy-staging/SKILL.md` → `/deploy-staging`                                                           |
| `.claude/commands/` 下的檔案                            | 檔案名稱（不含副檔名）                    | `.claude/commands/deploy.md` → `/deploy`                                                                               |
| 外掛 `skills/` 子目錄                                    | 目錄名稱，由外掛命名空間                   | `my-plugin/skills/review/SKILL.md` → `/my-plugin:review`                                                               |
| 外掛根目錄 `SKILL.md`                                    | Frontmatter `name`，以外掛目錄名稱作為後備 | `my-plugin/SKILL.md` 搭配 `name: review` → `/my-plugin:review`。請參閱[路徑行為規則](/zh-TW/plugins-reference#path-behavior-rules) |

外掛根目錄情況是 `name` 設定命令名稱的唯一地方，因為沒有 skill 目錄可從中取得。如果 frontmatter 中未設定 `name`，則改用外掛的目錄名稱。

#### 可用的字串替換

Skills 支援 skill 內容中動態值的字串替換：

| 變數                     | 描述                                                                                                                                                       |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$ARGUMENTS`           | 叫用 skill 時傳遞的所有引數。如果 `$ARGUMENTS` 不在內容中，引數會附加為 `ARGUMENTS: <value>`。                                                                                     |
| `$ARGUMENTS[N]`        | 透過 0 為基礎的索引存取特定引數，例如 `$ARGUMENTS[0]` 表示第一個引數。                                                                                                            |
| `$N`                   | `$ARGUMENTS[N]` 的簡寫，例如 `$0` 表示第一個引數或 `$1` 表示第二個引數。                                                                                                       |
| `$name`                | 在 [`arguments`](#frontmatter-reference) frontmatter 清單中宣告的具名引數。名稱按順序對應到位置，因此使用 `arguments: [issue, branch]` 時，預留位置 `$issue` 擴展為第一個引數，`$branch` 擴展為第二個引數。 |
| `${CLAUDE_SESSION_ID}` | 目前的工作階段 ID。適用於記錄、建立工作階段特定檔案或將 skill 輸出與工作階段相關聯。                                                                                                          |
| `${CLAUDE_EFFORT}`     | 目前的努力級別：`low`、`medium`、`high`、`xhigh` 或 `max`。Ultracode 不是一個不同的級別，報告為 `xhigh`。使用此來根據作用中的努力設定調整 skill 說明。                                                 |
| `${CLAUDE_SKILL_DIR}`  | 包含 skill 的 `SKILL.md` 檔案的目錄。對於外掛 skills，這是外掛中 skill 的子目錄，而不是外掛根目錄。在 bash 注入命令中使用此來參考與 skill 捆綁的指令碼或檔案，無論目前的工作目錄如何。                                       |

索引引數使用 shell 風格的引用，因此將多字值包裝在引號中以將其作為單個引數傳遞。例如，`/my-skill "hello world" second` 使 `$0` 擴展為 `hello world`，`$1` 擴展為 `second`。`$ARGUMENTS` 預留位置始終擴展為輸入的完整引數字串。

**使用替換的範例：**

```yaml theme={null}
---
name: session-logger
description: Log activity for this session
---

Log the following to logs/${CLAUDE_SESSION_ID}.log:

$ARGUMENTS
```

### 新增支援檔案

Skills 可以在其目錄中包含多個檔案。這使 `SKILL.md` 專注於基本要素，同時讓 Claude 僅在需要時存取詳細的參考資料。大型參考文件、API 規格或範例集合不需要在每次 skill 執行時載入上下文。

```text theme={null}
my-skill/
├── SKILL.md (required - overview and navigation)
├── reference.md (detailed API docs - loaded when needed)
├── examples.md (usage examples - loaded when needed)
└── scripts/
    └── helper.py (utility script - executed, not loaded)
```

從 `SKILL.md` 參考支援檔案，以便 Claude 知道每個檔案包含什麼以及何時載入它：

```markdown theme={null}
## Additional resources

- For complete API details, see [reference.md](reference.md)
- For usage examples, see [examples.md](examples.md)
```

<Tip>將 `SKILL.md` 保持在 500 行以下。將詳細的參考資料移至單獨的檔案。</Tip>

### 控制誰叫用 skill

預設情況下，您和 Claude 都可以叫用任何 skill。您可以輸入 `/skill-name` 直接叫用它，Claude 可以在與您的對話相關時自動載入它。兩個 frontmatter 欄位讓您限制此：

* **`disable-model-invocation: true`**：只有您可以叫用該 skill。用於具有副作用或您想控制時機的工作流程，例如 `/commit`、`/deploy` 或 `/send-slack-message`。您不希望 Claude 因為您的程式碼看起來準備好就決定部署。

* **`user-invocable: false`**：只有 Claude 可以叫用該 skill。用於不可作為命令操作的背景知識。`legacy-system-context` skill 解釋舊系統如何運作。Claude 在相關時應該知道這一點，但 `/legacy-system-context` 對使用者來說不是有意義的動作。

此範例建立一個只有您可以觸發的部署 skill。`disable-model-invocation: true` 欄位防止 Claude 自動執行它：

```yaml theme={null}
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
---

Deploy $ARGUMENTS to production:

1. Run the test suite
2. Build the application
3. Push to the deployment target
4. Verify the deployment succeeded
```

以下是兩個欄位如何影響叫用和上下文載入：

| Frontmatter                      | 您可以叫用 | Claude 可以叫用 | 何時載入上下文                 |
| :------------------------------- | :---- | :---------- | :---------------------- |
| （預設）                             | 是     | 是           | 描述始終在上下文中，叫用時載入完整 skill |
| `disable-model-invocation: true` | 是     | 否           | 描述不在上下文中，您叫用時載入完整 skill |
| `user-invocable: false`          | 否     | 是           | 描述始終在上下文中，叫用時載入完整 skill |

<Note>
  在常規工作階段中，skill 描述會載入上下文，以便 Claude 知道可用的內容，但完整 skill 內容僅在叫用時載入。[預載入 skills 的 Subagents](/zh-TW/sub-agents#preload-skills-into-subagents) 的運作方式不同：完整 skill 內容在啟動時注入。
</Note>

### Skill 內容生命週期

當您或 Claude 叫用 skill 時，呈現的 `SKILL.md` 內容作為單一訊息進入對話，並在工作階段的其餘部分保持在那裡。Claude Code 不會在稍後的回合中重新讀取 skill 檔案，因此應將應該在整個任務中應用的指導寫成常設說明，而不是一次性步驟。

[Auto-compact](/zh-TW/how-claude-code-works#when-context-fills-up) 在令牌預算內轉發叫用的 skills。當對話被摘要以釋放上下文時，Claude Code 在摘要後重新附加每個 skill 的最新叫用，保留每個的前 5,000 個令牌。重新附加的 skills 共享 25,000 個令牌的組合預算。Claude Code 從最近叫用的 skill 開始填充此預算，因此如果您在一個工作階段中叫用了許多 skills，較舊的 skills 可能在 compaction 後完全被丟棄。

如果 skill 在第一個回應後似乎停止影響行為，內容通常仍然存在，模型正在選擇其他工具或方法。加強 skill 的 `description` 和說明，以便模型繼續偏好它，或使用 [hooks](/zh-TW/hooks) 來確定性地強制行為。如果 skill 很大或您在它之後叫用了其他幾個，請在 compaction 後重新叫用它以恢復完整內容。

### 為 skill 預先批准工具

`allowed-tools` 欄位在 skill 處於作用中時授予列出的工具的許可，因此 Claude 可以使用它們而無需提示您批准。它不會限制哪些工具可用：每個工具仍然可呼叫，您的[許可設定](/zh-TW/permissions)仍然管理未列出的工具。

對於簽入到專案的 `.claude/skills/` 目錄的 skills，`allowed-tools` 在您接受該資料夾的工作區信任對話後生效，與 `.claude/settings.json` 中的許可規則相同。在信任存放庫之前檢查專案 skills，因為 skill 可以授予自己廣泛的工具存取權限。

此 skill 讓 Claude 在您叫用它時執行 git 命令而無需每次使用批准：

```yaml theme={null}
---
name: commit
description: Stage and commit the current changes
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)
---
```

若要阻止 skill 使用某些工具，請在您的[許可設定](/zh-TW/permissions)中新增拒絕規則。

### 將引數傳遞給 skills

您和 Claude 都可以在叫用 skill 時傳遞引數。引數可透過 `$ARGUMENTS` 預留位置取得。

此 skill 透過編號修復 GitHub 問題。`$ARGUMENTS` 預留位置會被 skill 名稱後面的任何內容取代：

```yaml theme={null}
---
name: fix-issue
description: Fix a GitHub issue
disable-model-invocation: true
---

Fix GitHub issue $ARGUMENTS following our coding standards.

1. Read the issue description
2. Understand the requirements
3. Implement the fix
4. Write tests
5. Create a commit
```

當您執行 `/fix-issue 123` 時，Claude 會收到「Fix GitHub issue 123 following our coding standards...」

如果您使用引數叫用 skill，但 skill 不包含 `$ARGUMENTS`，Claude Code 會將 `ARGUMENTS: <your input>` 附加到 skill 內容的末尾，以便 Claude 仍然看到您輸入的內容。

若要按位置存取個別引數，請使用 `$ARGUMENTS[N]` 或較短的 `$N`：

```yaml theme={null}
---
name: migrate-component
description: Migrate a component from one framework to another
---

Migrate the $ARGUMENTS[0] component from $ARGUMENTS[1] to $ARGUMENTS[2].
Preserve all existing behavior and tests.
```

執行 `/migrate-component SearchBar React Vue` 會將 `$ARGUMENTS[0]` 替換為 `SearchBar`、`$ARGUMENTS[1]` 替換為 `React`、`$ARGUMENTS[2]` 替換為 `Vue`。使用 `$N` 簡寫的相同 skill：

```yaml theme={null}
---
name: migrate-component
description: Migrate a component from one framework to another
---

Migrate the $0 component from $1 to $2.
Preserve all existing behavior and tests.
```

## 進階模式

### 注入動態上下文

`` !`<command>` `` 語法在將 skill 內容傳送給 Claude 之前執行 shell 命令。命令輸出替換預留位置，因此 Claude 會收到實際資料，而不是命令本身。

此 skill 透過使用 GitHub CLI 擷取即時 PR 資料來總結拉取請求。`` !`gh pr diff` `` 和其他命令首先執行，其輸出會插入到提示中：

```yaml theme={null}
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Your task
Summarize this pull request...
```

當此 skill 執行時：

1. 每個 `` !`<command>` `` 立即執行（在 Claude 看到任何內容之前）
2. 輸出替換 skill 內容中的預留位置
3. Claude 收到具有實際 PR 資料的完全呈現的提示

這是預處理，不是 Claude 執行的內容。Claude 只看到最終結果。

替換對原始檔案執行一次。命令輸出會以純文字形式插入，不會重新掃描以尋找進一步的 `` !`<command>` `` 預留位置，因此命令無法發出預留位置供稍後的傳遞來展開。

內聯形式僅在 `!` 出現在行首或緊接在空白字元之後時被識別。如果 `!` 跟在另一個字元之後，如 `` KEY=!`cmd` ``，預留位置會保留為字面文字，命令不會執行。

對於多行命令，請使用以 ` ```! ` 開啟的圍欄程式碼區塊，而不是內聯形式：

````markdown theme={null}
## Environment
```!
node --version
npm --version
git status --short
```
````

若要停用來自使用者、專案、外掛或[其他目錄](#skills-from-additional-directories)來源的 skills 和自訂命令的此行為，請在[設定](/zh-TW/settings)中設定 `"disableSkillShellExecution": true`。每個命令會被替換為 `[shell command execution disabled by policy]` 而不是被執行。捆綁和受管 skills 不受影響。此設定在[受管設定](/zh-TW/permissions#managed-settings)中最有用，使用者無法覆蓋它。

<Tip>
  若要在 skill 執行時要求更深入的推理，請在 skill 內容中的任何位置包含 `ultrathink`。請參閱[使用 ultrathink 進行一次性深入推理](/zh-TW/model-config#use-ultrathink-for-one-off-deep-reasoning)。
</Tip>

### 在 subagent 中執行 skills

當您想要 skill 在隔離中執行時，將 `context: fork` 新增到您的 frontmatter。Skill 內容變成驅動 subagent 的提示。它將無法存取您的對話歷史記錄。

<Warning>
  `context: fork` 僅對具有明確說明的 skills 有意義。如果您的 skill 包含「使用這些 API 慣例」之類的指南而沒有任務，subagent 會收到指南但沒有可操作的提示，並返回而沒有有意義的輸出。
</Warning>

Skills 和 [subagents](/zh-TW/sub-agents) 以兩個方向協同運作：

| 方法                         | 系統提示                   | 任務           | 也載入                            |
| :------------------------- | :--------------------- | :----------- | :----------------------------- |
| 具有 `context: fork` 的 Skill | 來自代理類型                 | SKILL.md 內容  | CLAUDE.md，除非代理是 Explore 或 Plan |
| 具有 `skills` 欄位的 Subagent   | Subagent 的 markdown 主體 | Claude 的委派訊息 | 預載入的 skills + CLAUDE.md        |

使用 `context: fork`，您在 skill 中編寫任務並選擇代理類型來執行它。內建的 Explore 和 Plan 代理[跳過 CLAUDE.md 和 git status](/zh-TW/sub-agents#what-loads-at-startup)以保持其上下文較小，因此使用 `agent: Explore` 的分叉 skill 只看到 SKILL.md 內容和代理自己的系統提示。對於反向情況，其中您定義使用 skills 作為參考資料的自訂 subagent，請參閱 [Subagents](/zh-TW/sub-agents#preload-skills-into-subagents)。

#### 範例：使用 Explore 代理的研究 skill

此 skill 在分叉的 Explore 代理中執行研究。Skill 內容變成任務，代理提供針對程式碼庫探索最佳化的唯讀工具：

```yaml theme={null}
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly:

1. Find relevant files using Glob and Grep
2. Read and analyze the code
3. Summarize findings with specific file references
```

當此 skill 執行時：

1. 建立新的隔離上下文
2. Subagent 收到 skill 內容作為其提示（「Research \$ARGUMENTS thoroughly...」）
3. `agent` 欄位決定執行環境（模型、工具和許可）
4. 結果會總結並返回到您的主要對話

`agent` 欄位指定要使用的 subagent 設定。選項包括內建代理（`Explore`、`Plan`、`general-purpose`）或來自 `.claude/agents/` 的任何自訂 subagent。如果省略，使用 `general-purpose`。

### 限制 Claude 的 skill 存取

預設情況下，Claude 可以叫用任何沒有設定 `disable-model-invocation: true` 的 skill。定義 `allowed-tools` 的 Skills 在 skill 處於作用中時授予 Claude 對這些工具的存取權，無需每次使用批准。您的[許可設定](/zh-TW/permissions)仍然管理所有其他工具的基準批准行為。一些內建命令也可透過 Skill 工具取得，包括 `/init`、`/review` 和 `/security-review`。其他內建命令（例如 `/compact`）則不行。

控制 Claude 可以叫用哪些 skills 的三種方式：

**透過在 `/permissions` 中拒絕 Skill 工具來停用所有 skills**：

```text theme={null}
# Add to deny rules:
Skill
```

**使用[許可規則](/zh-TW/permissions)允許或拒絕特定 skills**：

```text theme={null}
# Allow only specific skills
Skill(commit)
Skill(review-pr *)

# Deny specific skills
Skill(deploy *)
```

許可語法：`Skill(name)` 用於精確匹配，`Skill(name *)` 用於帶有任何引數的前綴匹配。

**透過將 `disable-model-invocation: true` 新增到其 frontmatter 來隱藏個別 skills**。這會從 Claude 的上下文中完全移除該 skill。

<Note>
  `user-invocable` 欄位僅控制功能表可見性，不控制 Skill 工具存取。使用 `disable-model-invocation: true` 來阻止程式化叫用。
</Note>

### 從設定覆蓋 skill 可見性

`skillOverrides` 設定從您的[設定](/zh-TW/settings)控制 skill 可見性，而不是 skill 自己的 frontmatter。將其用於您不想編輯 SKILL.md 的 skills，例如簽入共享專案儲存庫或由 MCP 伺服器提供的 skills。`/skills` 功能表為您編寫：突出顯示 skill 並按 `Space` 循環狀態，然後按 `Enter` 儲存到 `.claude/settings.local.json`。

每個鍵是 skill 名稱，每個值是四種狀態之一：

| 值                       | 列出給 Claude | 在 `/` 功能表中 |
| :---------------------- | :--------- | :--------- |
| `"on"`                  | 名稱和描述      | 是          |
| `"name-only"`           | 僅名稱        | 是          |
| `"user-invocable-only"` | 隱藏         | 是          |
| `"off"`                 | 隱藏         | 隱藏         |

`skillOverrides` 中不存在的 skill 被視為 `"on"`。下面的範例將一個 skill 摺疊為其名稱，並完全關閉另一個：

```json theme={null}
{
  "skillOverrides": {
    "legacy-context": "name-only",
    "deploy": "off"
  }
}
```

外掛 skills 不受 `skillOverrides` 影響。透過 `/plugin` 改為管理這些。

## 分享 skills

Skills 可以根據您的受眾在不同範圍內分發：

* **專案 skills**：將 `.claude/skills/` 提交到版本控制
* **外掛**：在您的[外掛](/zh-TW/plugins)中建立 `skills/` 目錄
* **受管**：透過[受管設定](/zh-TW/settings#settings-files)部署組織範圍

### 生成視覺輸出

Skills 可以捆綁並執行任何語言的指令碼，為 Claude 提供超越單個提示可能的功能。一個強大的模式是生成視覺輸出：在您的瀏覽器中開啟的互動式 HTML 檔案，用於探索資料、偵錯或建立報告。

此範例建立一個程式碼庫探索器：一個互動式樹狀檢視，您可以在其中展開和摺疊目錄、一目瞭然地查看檔案大小，並按顏色識別檔案類型。

建立 Skill 目錄：

```bash theme={null}
mkdir -p ~/.claude/skills/codebase-visualizer/scripts
```

將此儲存到 `~/.claude/skills/codebase-visualizer/SKILL.md`。描述告訴 Claude 何時啟動此 Skill，說明告訴 Claude 執行捆綁的指令碼。指令碼路徑使用 [`${CLAUDE_SKILL_DIR}`](#available-string-substitutions)，因此無論 skill 是安裝在個人、專案或外掛層級，它都能正確解析：

````yaml theme={null}
---
name: codebase-visualizer
description: Generate an interactive collapsible tree visualization of your codebase. Use when exploring a new repo, understanding project structure, or identifying large files.
allowed-tools: Bash(python3 *)
---

# Codebase Visualizer

Generate an interactive HTML tree view that shows your project's file structure with collapsible directories.

## Usage

Run the visualization script from your project root:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/visualize.py .
```

This creates `codebase-map.html` in the current directory and opens it in your default browser.

## What the visualization shows

- **Collapsible directories**: Click folders to expand/collapse
- **File sizes**: Displayed next to each file
- **Colors**: Different colors for different file types
- **Directory totals**: Shows aggregate size of each folder
````

將此儲存到 `~/.claude/skills/codebase-visualizer/scripts/visualize.py`。此指令碼掃描目錄樹並生成一個自包含的 HTML 檔案，包含：

* 一個**摘要側邊欄**，顯示檔案計數、目錄計數、總大小和檔案類型數量
* 一個**長條圖**，按檔案類型（按大小排名前 8）分解程式碼庫
* 一個**可摺疊樹**，您可以在其中展開和摺疊目錄，具有顏色編碼的檔案類型指示器

該指令碼需要 Python 3，但僅使用內建程式庫，因此無需安裝套件：

```python expandable theme={null}
#!/usr/bin/env python3
"""Generate an interactive collapsible tree visualization of a codebase."""

import json
import sys
import webbrowser
from html import escape
from pathlib import Path
from collections import Counter

IGNORE = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build'}

def scan(path: Path, stats: dict) -> dict:
    result = {"name": path.name, "children": [], "size": 0}
    try:
        for item in sorted(path.iterdir()):
            if item.name in IGNORE or item.name.startswith('.'):
                continue
            if item.is_file():
                size = item.stat().st_size
                ext = item.suffix.lower() or '(no ext)'
                result["children"].append({"name": item.name, "size": size, "ext": ext})
                result["size"] += size
                stats["files"] += 1
                stats["extensions"][ext] += 1
                stats["ext_sizes"][ext] += size
            elif item.is_dir():
                stats["dirs"] += 1
                child = scan(item, stats)
                if child["children"]:
                    result["children"].append(child)
                    result["size"] += child["size"]
    except PermissionError:
        pass
    return result

def generate_html(data: dict, stats: dict, output: Path) -> None:
    ext_sizes = stats["ext_sizes"]
    total_size = sum(ext_sizes.values()) or 1
    sorted_exts = sorted(ext_sizes.items(), key=lambda x: -x[1])[:8]
    colors = {
        '.js': '#f7df1e', '.ts': '#3178c6', '.py': '#3776ab', '.go': '#00add8',
        '.rs': '#dea584', '.rb': '#cc342d', '.css': '#264de4', '.html': '#e34c26',
        '.json': '#6b7280', '.md': '#083fa1', '.yaml': '#cb171e', '.yml': '#cb171e',
        '.mdx': '#083fa1', '.tsx': '#3178c6', '.jsx': '#61dafb', '.sh': '#4eaa25',
    }
    lang_bars = "".join(
        f'<div class="bar-row"><span class="bar-label">{ext}</span>'
        f'<div class="bar" style="width:{(size/total_size)*100}%;background:{colors.get(ext,"#6b7280")}"></div>'
        f'<span class="bar-pct">{(size/total_size)*100:.1f}%</span></div>'
        for ext, size in sorted_exts
    )
    def fmt(b):
        if b < 1024: return f"{b} B"
        if b < 1048576: return f"{b/1024:.1f} KB"
        return f"{b/1048576:.1f} MB"

    html = f'''<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"><title>Codebase Explorer</title>
  <style>
    body {{ font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #1a1a2e; color: #eee; }}
    .container {{ display: flex; height: 100vh; }}
    .sidebar {{ width: 280px; background: #252542; padding: 20px; border-right: 1px solid #3d3d5c; overflow-y: auto; flex-shrink: 0; }}
    .main {{ flex: 1; padding: 20px; overflow-y: auto; }}
    h1 {{ margin: 0 0 10px 0; font-size: 18px; }}
    h2 {{ margin: 20px 0 10px 0; font-size: 14px; color: #888; text-transform: uppercase; }}
    .stat {{ display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #3d3d5c; }}
    .stat-value {{ font-weight: bold; }}
    .bar-row {{ display: flex; align-items: center; margin: 6px 0; }}
    .bar-label {{ width: 55px; font-size: 12px; color: #aaa; }}
    .bar {{ height: 18px; border-radius: 3px; }}
    .bar-pct {{ margin-left: 8px; font-size: 12px; color: #666; }}
    .tree {{ list-style: none; padding-left: 20px; }}
    details {{ cursor: pointer; }}
    summary {{ padding: 4px 8px; border-radius: 4px; }}
    summary:hover {{ background: #2d2d44; }}
    .folder {{ color: #ffd700; }}
    .file {{ display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; }}
    .file:hover {{ background: #2d2d44; }}
    .size {{ color: #888; margin-left: auto; font-size: 12px; }}
    .dot {{ width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }}
  </style>
</head><body>
  <div class="container">
    <div class="sidebar">
      <h1>📊 Summary</h1>
      <div class="stat"><span>Files</span><span class="stat-value">{stats["files"]:,}</span></div>
      <div class="stat"><span>Directories</span><span class="stat-value">{stats["dirs"]:,}</span></div>
      <div class="stat"><span>Total size</span><span class="stat-value">{fmt(data["size"])}</span></div>
      <div class="stat"><span>File types</span><span class="stat-value">{len(stats["extensions"])}</span></div>
      <h2>By file type</h2>
      {lang_bars}
    </div>
    <div class="main">
      <h1>📁 {escape(data["name"])}</h1>
      <ul class="tree" id="root"></ul>
    </div>
  </div>
  <script>
    const data = {json.dumps(data)};
    const colors = {json.dumps(colors)};
    function fmt(b) {{ if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }}
    function esc(s) {{ return s.replace(/[&<>"']/g, c => ({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}}[c])); }}
    function render(node, parent) {{
      if (node.children) {{
        const det = document.createElement('details');
        det.open = parent === document.getElementById('root');
        det.innerHTML = `<summary><span class="folder">📁 ${{esc(node.name)}}</span><span class="size">${{fmt(node.size)}}</span></summary>`;
        const ul = document.createElement('ul'); ul.className = 'tree';
        node.children.sort((a,b) => (b.children?1:0)-(a.children?1:0) || a.name.localeCompare(b.name));
        node.children.forEach(c => render(c, ul));
        det.appendChild(ul);
        const li = document.createElement('li'); li.appendChild(det); parent.appendChild(li);
      }} else {{
        const li = document.createElement('li'); li.className = 'file';
        li.innerHTML = `<span class="dot" style="background:${{colors[node.ext]||'#6b7280'}}"></span>${{esc(node.name)}}<span class="size">${{fmt(node.size)}}</span>`;
        parent.appendChild(li);
      }}
    }}
    data.children.forEach(c => render(c, document.getElementById('root')));
  </script>
</body></html>'''
    output.write_text(html)

if __name__ == '__main__':
    target = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    stats = {"files": 0, "dirs": 0, "extensions": Counter(), "ext_sizes": Counter()}
    data = scan(target, stats)
    out = Path('codebase-map.html')
    generate_html(data, stats, out)
    print(f'Generated {out.absolute()}')
    webbrowser.open(f'file://{out.absolute()}')
```

若要測試，在任何專案中開啟 Claude Code 並詢問「Visualize this codebase.」Claude 執行指令碼、生成 `codebase-map.html` 並在您的瀏覽器中開啟它。

此模式適用於任何視覺輸出：相依性圖表、測試涵蓋範圍報告、API 文件或資料庫架構視覺化。捆綁的指令碼完成繁重工作，而 Claude 處理協調。

## 疑難排解

### Skill 未觸發

如果 Claude 在預期時不使用您的 skill：

1. 檢查描述是否包含使用者會自然說出的關鍵字
2. 驗證 skill 是否出現在「What skills are available?」中
3. 嘗試重新表述您的請求以更密切地匹配描述
4. 如果 skill 是使用者可叫用的，請使用 `/skill-name` 直接叫用它

### Skill 觸發過於頻繁

如果 Claude 在您不想要時使用您的 skill：

1. 使描述更具體
2. 如果您只想手動叫用，請新增 `disable-model-invocation: true`

### Skill 描述被截斷

Skill 描述會載入上下文，以便 Claude 知道可用的內容。所有 skill 名稱始終包含在內，但如果您有許多 skills，描述會被縮短以適應字元預算，這可能會去除 Claude 需要匹配您的請求的關鍵字。預算在模型上下文視窗的 1% 處動態縮放。當預算溢出時，您最少叫用的 skills 的描述會首先被捨棄，因此您實際使用的 skills 會保留其完整文字。執行 `/doctor` 以查看預算是否溢出以及哪些 skills 受到影響。

若要提高預算，請設定 [`skillListingBudgetFraction`](/zh-TW/settings#available-settings) 設定（例如 `0.02` = 2%）或 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 環境變數為固定字元計數。若要為其他 skills 釋放預算，請在 [`skillOverrides`](#override-skill-visibility-from-settings) 中將低優先順序項目設定為 `"name-only"`，以便它們列出而不顯示描述。您也可以在來源處修剪 `description` 和 `when_to_use` 文字：前置關鍵使用案例，因為每個項目的結合文字無論預算如何都限制在 1,536 個字元。此上限可透過 [`maxSkillDescriptionChars`](/zh-TW/settings#available-settings) 進行設定。

## 相關資源

* **[除錯您的設定](/zh-TW/debug-your-config)**：診斷為什麼 skill 沒有出現或觸發
* **[Subagents](/zh-TW/sub-agents)**：委派任務給專門的代理
* **[Plugins](/zh-TW/plugins)**：使用其他擴展功能打包和分發 skills
* **[Hooks](/zh-TW/hooks)**：自動化工具事件周圍的工作流程
* **[Memory](/zh-TW/memory)**：管理 CLAUDE.md 檔案以取得持久上下文
* **[Commands](/zh-TW/commands)**：內建命令和捆綁 skills 的參考
* **[Permissions](/zh-TW/permissions)**：控制工具和 skill 存取
