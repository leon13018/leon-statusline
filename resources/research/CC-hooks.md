> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用 hooks 攔截和控制代理行為

> 在代理執行的關鍵點使用 hooks 攔截和自訂代理行為

Hooks 是回調函數，在代理事件發生時執行您的程式碼，例如工具被呼叫、會話啟動或執行停止。使用 hooks，您可以：

* **阻止危險操作**在執行前，例如破壞性的 shell 命令或未授權的檔案存取
* **記錄和審計**每個工具呼叫以進行合規性、除錯或分析
* **轉換輸入和輸出**以清理資料、注入認證或重定向檔案路徑
* **要求人工批准**敏感操作，例如資料庫寫入或 API 呼叫
* **追蹤會話生命週期**以管理狀態、清理資源或傳送通知

本指南涵蓋 hooks 的工作原理、如何配置它們，並提供常見模式的範例，例如阻止工具、修改輸入和轉發通知。

## Hooks 如何工作

<Steps>
  <Step title="事件觸發">
    代理執行期間發生某事，SDK 觸發事件：工具即將被呼叫（`PreToolUse`）、工具返回結果（`PostToolUse`）、子代理啟動或停止、代理空閒或執行完成。請參閱[完整事件列表](#available-hooks)。
  </Step>

  <Step title="SDK 收集已註冊的 hooks">
    SDK 檢查為該事件類型註冊的 hooks。這包括您在 `options.hooks` 中傳遞的回調 hooks 和來自設定檔案的 shell 命令 hooks，當相應的 [`settingSources`](/zh-TW/agent-sdk/typescript#settingSources) 或 [`setting_sources`](/zh-TW/agent-sdk/python#setting_sources) 項目啟用時（預設 `query()` 選項就是這樣）。
  </Step>

  <Step title="匹配器篩選哪些 hooks 執行">
    如果 hook 有 [`matcher`](#matchers) 模式（例如 `"Write|Edit"`），SDK 會針對事件的目標（例如工具名稱）測試它。沒有匹配器的 hooks 會針對該類型的每個事件執行。
  </Step>

  <Step title="回調函數執行">
    每個匹配的 hook 的[回調函數](#callback-functions)接收有關正在發生的事情的輸入：工具名稱、其參數、會話 ID 和其他事件特定的詳細資訊。
  </Step>

  <Step title="您的回調返回決定">
    執行任何操作（記錄、API 呼叫、驗證）後，您的回調返回[輸出物件](#outputs)，告訴代理該做什麼：允許操作、阻止它、修改輸入或將上下文注入對話。
  </Step>
</Steps>

以下範例將這些步驟組合在一起。它註冊一個 `PreToolUse` hook（步驟 1），帶有 `"Write|Edit"` 匹配器（步驟 3），因此回調只針對檔案寫入工具觸發。觸發時，回調接收工具的輸入（步驟 4），檢查檔案路徑是否針對 `.env` 檔案，並返回 `permissionDecision: "deny"` 以阻止操作（步驟 5）：

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import (
      AssistantMessage,
      ClaudeSDKClient,
      ClaudeAgentOptions,
      HookMatcher,
      ResultMessage,
  )


  # 定義一個接收工具呼叫詳細資訊的 hook 回調
  async def protect_env_files(input_data, tool_use_id, context):
      # 從工具的輸入參數中提取檔案路徑
      file_path = input_data["tool_input"].get("file_path", "")
      file_name = file_path.split("/")[-1]

      # 如果針對 .env 檔案，阻止操作
      if file_name == ".env":
          return {
              "hookSpecificOutput": {
                  "hookEventName": input_data["hook_event_name"],
                  "permissionDecision": "deny",
                  "permissionDecisionReason": "Cannot modify .env files",
              }
          }

      # 返回空物件以允許操作
      return {}


  async def main():
      options = ClaudeAgentOptions(
          hooks={
              # 為 PreToolUse 事件註冊 hook
              # 匹配器篩選為僅 Write 和 Edit 工具呼叫
              "PreToolUse": [HookMatcher(matcher="Write|Edit", hooks=[protect_env_files])]
          }
      )

      async with ClaudeSDKClient(options=options) as client:
          await client.query("Update the database configuration")
          async for message in client.receive_response():
              # 篩選助手和結果訊息
              if isinstance(message, (AssistantMessage, ResultMessage)):
                  print(message)


  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

  // 使用 HookCallback 類型定義 hook 回調
  const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
    // 將輸入轉換為特定 hook 類型以確保類型安全
    const preInput = input as PreToolUseHookInput;

    // 轉換 tool_input 以存取其屬性（在 SDK 中類型為 unknown）
    const toolInput = preInput.tool_input as Record<string, unknown>;
    const filePath = toolInput?.file_path as string;
    const fileName = filePath?.split("/").pop();

    // 如果針對 .env 檔案，阻止操作
    if (fileName === ".env") {
      return {
        hookSpecificOutput: {
          hookEventName: preInput.hook_event_name,
          permissionDecision: "deny",
          permissionDecisionReason: "Cannot modify .env files"
        }
      };
    }

    // 返回空物件以允許操作
    return {};
  };

  for await (const message of query({
    prompt: "Update the database configuration",
    options: {
      hooks: {
        // 為 PreToolUse 事件註冊 hook
        // 匹配器篩選為僅 Write 和 Edit 工具呼叫
        PreToolUse: [{ matcher: "Write|Edit", hooks: [protectEnvFiles] }]
      }
    }
  })) {
    // 篩選助手和結果訊息
    if (message.type === "assistant" || message.type === "result") {
      console.log(message);
    }
  }
  ```
</CodeGroup>

## 可用的 hooks

SDK 為代理執行的不同階段提供 hooks。某些 hooks 在兩個 SDK 中都可用，而其他則僅限 TypeScript。

| Hook 事件              | Python SDK | TypeScript SDK | 觸發條件                       | 使用案例範例                       |
| -------------------- | ---------- | -------------- | -------------------------- | ---------------------------- |
| `PreToolUse`         | 是          | 是              | 工具呼叫請求（可以阻止或修改）            | 阻止危險的 shell 命令               |
| `PostToolUse`        | 是          | 是              | 工具執行結果                     | 將所有檔案變更記錄到審計追蹤               |
| `PostToolUseFailure` | 是          | 是              | 工具執行失敗                     | 處理或記錄工具錯誤                    |
| `PostToolBatch`      | 否          | 是              | 一整批工具呼叫解決，每批一次，在下一個模型呼叫之前  | 為整個批次注入約定                    |
| `UserPromptSubmit`   | 是          | 是              | 使用者提示提交                    | 將額外上下文注入提示                   |
| `MessageDisplay`     | 否          | 是              | 助手訊息包含文字完成，每則訊息一次，包含完整訊息文字 | 編輯或重新格式化顯示的文字，不改變記錄          |
| `Stop`               | 是          | 是              | 代理執行停止                     | 在退出前保存會話狀態                   |
| `SubagentStart`      | 是          | 是              | 子代理初始化                     | 追蹤平行任務生成                     |
| `SubagentStop`       | 是          | 是              | 子代理完成                      | 聚合來自平行任務的結果                  |
| `PreCompact`         | 是          | 是              | 對話壓縮請求                     | 在摘要前存檔完整記錄                   |
| `PermissionRequest`  | 是          | 是              | 權限對話將顯示                    | 自訂權限處理                       |
| `SessionStart`       | 否          | 是              | 會話初始化                      | 初始化記錄和遙測                     |
| `SessionEnd`         | 否          | 是              | 會話終止                       | 清理臨時資源                       |
| `Notification`       | 是          | 是              | 代理狀態訊息                     | 將代理狀態更新傳送到 Slack 或 PagerDuty |
| `Setup`              | 否          | 是              | 會話設定/維護                    | 執行初始化任務                      |
| `TeammateIdle`       | 否          | 是              | 隊友變為空閒                     | 重新分配工作或通知                    |
| `TaskCompleted`      | 否          | 是              | 背景任務完成                     | 聚合來自平行任務的結果                  |
| `ConfigChange`       | 否          | 是              | 配置檔案變更                     | 動態重新載入設定                     |
| `WorktreeCreate`     | 否          | 是              | Git worktree 已建立           | 追蹤隔離的工作區                     |
| `WorktreeRemove`     | 否          | 是              | Git worktree 已移除           | 清理工作區資源                      |

## 配置 hooks

要配置 hook，請在代理選項的 `hooks` 欄位中傳遞它（Python 中的 `ClaudeAgentOptions`，TypeScript 中的 `options` 物件）：

<CodeGroup>
  ```python Python theme={null}
  options = ClaudeAgentOptions(
      hooks={"PreToolUse": [HookMatcher(matcher="Bash", hooks=[my_callback])]}
  )

  async with ClaudeSDKClient(options=options) as client:
      await client.query("Your prompt")
      async for message in client.receive_response():
          print(message)
  ```

  ```typescript TypeScript theme={null}
  for await (const message of query({
    prompt: "Your prompt",
    options: {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [myCallback] }]
      }
    }
  })) {
    console.log(message);
  }
  ```
</CodeGroup>

`hooks` 選項是一個字典（Python）或物件（TypeScript），其中：

* **鍵**是 [hook 事件名稱](#available-hooks)（例如 `'PreToolUse'`、`'PostToolUse'`、`'Stop'`）
* **值**是[匹配器](#matchers)的陣列，每個都包含可選的篩選模式和您的[回調函數](#callback-functions)

### 匹配器

使用匹配器篩選您的回調何時觸發。`matcher` 欄位根據 hook 事件類型匹配不同的值。例如，工具型 hooks 匹配工具名稱，而 `Notification` hooks 匹配通知類型。請參閱 [Claude Code hooks 參考](/zh-TW/hooks#matcher-patterns)以取得每個事件類型的完整匹配器值列表。

SDK 匹配器遵循與[設定檔案中的匹配器](/zh-TW/hooks#matcher-patterns)相同的規則：只包含字母、數字、`_` 和 `|` 的匹配器會被比較為精確字串，其中 `|` 分隔替代項，因此 `Write|Edit` 精確匹配這兩個工具。匹配器 `*`、空字串或完全省略匹配器會匹配事件的每次出現；包含任何其他字元的匹配器會被評估為正規表達式，因此 `^mcp__` 匹配每個 MCP 工具。像 `mcp__memory` 這樣的匹配器只包含字母和底線，因此會被比較為精確字串且不匹配任何工具；使用 `mcp__memory__.*` 來匹配來自該伺服器的每個工具。

| 選項        | 類型               | 預設值         | 描述                                                                                                                                                                                                                       |
| --------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matcher` | `string`         | `undefined` | 針對事件的篩選欄位匹配的模式，遵循上述比較規則。對於工具 hooks，這是工具名稱。內建工具包括 `Bash`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`WebFetch`、`Agent` 等（請參閱[工具輸入類型](/zh-TW/agent-sdk/typescript#tool-input-types)以取得完整列表）。MCP 工具使用模式 `mcp__<server>__<action>`。 |
| `hooks`   | `HookCallback[]` | -           | 必需。當模式匹配時執行的回調函數陣列                                                                                                                                                                                                       |
| `timeout` | `number`         | `60`        | 超時時間（秒）                                                                                                                                                                                                                  |

盡可能使用 `matcher` 模式來針對特定工具。帶有 `'Bash'` 的匹配器只針對 Bash 命令執行，而省略模式會針對事件的每次出現執行您的回調。請注意，對於工具型 hooks，匹配器只按**工具名稱**篩選，不按檔案路徑或其他參數篩選。要按檔案路徑篩選，請在回調內檢查 `tool_input.file_path`。

<Tip>
  **發現工具名稱：** 請參閱[工具輸入類型](/zh-TW/agent-sdk/typescript#tool-input-types)以取得內建工具名稱的完整列表，或新增沒有匹配器的 hook 以記錄您的會話進行的所有工具呼叫。

  **MCP 工具命名：** MCP 工具始終以 `mcp__` 開頭，後跟伺服器名稱和操作：`mcp__<server>__<action>`。例如，如果您配置名為 `playwright` 的伺服器，其工具將被命名為 `mcp__playwright__browser_screenshot`、`mcp__playwright__browser_click` 等。伺服器名稱來自您在 `mcpServers` 配置中使用的鍵。
</Tip>

### 回調函數

#### 輸入

每個 hook 回調接收三個參數：

* **輸入資料：** 一個包含事件詳細資訊的類型物件。每個 hook 類型都有自己的輸入形狀（例如，`PreToolUseHookInput` 包括 `tool_name` 和 `tool_input`，而 `NotificationHookInput` 包括 `message`）。請參閱 [TypeScript](/zh-TW/agent-sdk/typescript#hookinput) 和 [Python](/zh-TW/agent-sdk/python#hookinput) SDK 參考中的完整類型定義。
  * 所有 hook 輸入共享 `session_id`、`cwd` 和 `hook_event_name`。
  * 當 hook 在子代理內觸發時，`agent_id` 和 `agent_type` 會被填充。在 TypeScript 中，這些在基本 hook 輸入上，可供所有 hook 類型使用。在 Python 中，它們僅在 `PreToolUse`、`PostToolUse` 和 `PostToolUseFailure` 上。
* **工具使用 ID**（`str | None` / `string | undefined`）：關聯同一工具呼叫的 `PreToolUse` 和 `PostToolUse` 事件。
* **上下文：** 在 TypeScript 中，包含用於取消的 `signal` 屬性（`AbortSignal`）。在 Python 中，此參數保留供將來使用。

#### 輸出

您的回調返回一個具有兩類欄位的物件：

* **頂級欄位**在每個事件上的工作方式相同：`systemMessage` 向使用者顯示訊息，`continue`（Python 中的 `continue_`）決定此 hook 後代理是否繼續執行。
* **`hookSpecificOutput`** 控制目前操作。內部的欄位取決於 hook 事件類型。對於 `PreToolUse` hooks，這是您設定 `permissionDecision`（`"allow"`、`"deny"`、`"ask"` 或 `"defer"`）、`permissionDecisionReason` 和 `updatedInput` 的地方。返回 `"defer"` 會結束查詢，以便您可以[稍後繼續](/zh-TW/hooks#defer-a-tool-call-for-later)。對於 `PostToolUse` hooks，您可以設定 `additionalContext` 以將資訊附加到工具結果。要在 Claude 看到之前替換工具的輸出，請設定 `updatedToolOutput`，這適用於兩個 SDK 中的任何工具。較舊的 `updatedMCPToolOutput` 欄位僅替換 MCP 工具輸出，已被棄用。

返回 `{}` 以允許操作而不進行變更。SDK 回調 hooks 使用與 [Claude Code shell 命令 hooks](/zh-TW/hooks#json-output) 相同的 JSON 輸出格式，其記錄每個欄位和事件特定選項。對於 SDK 類型定義，請參閱 [TypeScript](/zh-TW/agent-sdk/typescript#synchookjsonoutput) 和 [Python](/zh-TW/agent-sdk/python#synchookjsonoutput) SDK 參考。

<Note>
  當多個 hooks 或權限規則適用時，**deny** 優先於 **defer**，**defer** 優先於 **ask**，**ask** 優先於 **allow**。如果任何 hook 返回 `deny`，操作將被阻止，無論其他 hooks 如何。
</Note>

#### 非同步輸出

預設情況下，代理在您的 hook 返回前等待。如果您的 hook 執行副作用（記錄、傳送 webhook）並且不需要影響代理的行為，您可以改為返回非同步輸出。這告訴代理立即繼續，無需等待 hook 完成：

<CodeGroup>
  ```python Python theme={null}
  async def async_hook(input_data, tool_use_id, context):
      # 啟動背景任務，然後立即返回
      asyncio.create_task(send_to_logging_service(input_data))
      return {"async_": True, "asyncTimeout": 30000}
  ```

  ```typescript TypeScript theme={null}
  const asyncHook: HookCallback = async (input, toolUseID, { signal }) => {
    // 啟動背景任務，然後立即返回
    sendToLoggingService(input).catch(console.error);
    return { async: true, asyncTimeout: 30000 };
  };
  ```
</CodeGroup>

| 欄位             | 類型       | 描述                                                  |
| -------------- | -------- | --------------------------------------------------- |
| `async`        | `true`   | 表示非同步模式。代理無需等待即可繼續。在 Python 中，使用 `async_` 以避免保留關鍵字。 |
| `asyncTimeout` | `number` | 背景操作的可選超時時間（毫秒）                                     |

<Note>
  非同步輸出無法阻止、修改或將上下文注入操作，因為代理已經繼續。僅將它們用於副作用，例如記錄、指標或通知。
</Note>

## 範例

### 修改工具輸入

此範例攔截 Write 工具呼叫並重寫 `file_path` 參數以預先加上 `/sandbox`，將所有檔案寫入重定向到沙箱目錄。回調返回帶有修改路徑的 `updatedInput` 和 `permissionDecision: 'allow'` 以自動批准重寫的操作：

<CodeGroup>
  ```python Python theme={null}
  async def redirect_to_sandbox(input_data, tool_use_id, context):
      if input_data["hook_event_name"] != "PreToolUse":
          return {}

      if input_data["tool_name"] == "Write":
          original_path = input_data["tool_input"].get("file_path", "")
          return {
              "hookSpecificOutput": {
                  "hookEventName": input_data["hook_event_name"],
                  "permissionDecision": "allow",
                  "updatedInput": {
                      **input_data["tool_input"],
                      "file_path": f"/sandbox{original_path}",
                  },
              }
          }
      return {}
  ```

  ```typescript TypeScript theme={null}
  const redirectToSandbox: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};

    const preInput = input as PreToolUseHookInput;
    const toolInput = preInput.tool_input as Record<string, unknown>;
    if (preInput.tool_name === "Write") {
      const originalPath = toolInput.file_path as string;
      return {
        hookSpecificOutput: {
          hookEventName: preInput.hook_event_name,
          permissionDecision: "allow",
          updatedInput: {
            ...toolInput,
            file_path: `/sandbox${originalPath}`
          }
        }
      };
    }
    return {};
  };
  ```
</CodeGroup>

<Note>
  使用 `updatedInput` 時，您還必須包括 `permissionDecision: 'allow'` 以自動批准修改的輸入，或 `permissionDecision: 'ask'` 以將其顯示給使用者。使用 `'defer'` 時，`updatedInput` 會被忽略。始終返回新物件，而不是改變原始 `tool_input`。
</Note>

### 新增上下文並阻止工具

此範例阻止寫入 `/etc` 目錄並向模型和使用者解釋原因：

* `permissionDecision: 'deny'` 停止工具呼叫。
* `permissionDecisionReason` 告訴模型原因，以便它避免重試。
* `systemMessage` 向使用者顯示發生了什麼。

<CodeGroup>
  ```python Python theme={null}
  async def block_etc_writes(input_data, tool_use_id, context):
      file_path = input_data["tool_input"].get("file_path", "")

      if file_path.startswith("/etc"):
          return {
              # 頂級欄位：顯示給使用者的訊息
              "systemMessage": "Remember: system directories like /etc are protected.",
              # hookSpecificOutput：阻止操作
              "hookSpecificOutput": {
                  "hookEventName": input_data["hook_event_name"],
                  "permissionDecision": "deny",
                  "permissionDecisionReason": "Writing to /etc is not allowed",
              },
          }
      return {}
  ```

  ```typescript TypeScript theme={null}
  const blockEtcWrites: HookCallback = async (input, toolUseID, { signal }) => {
    const preInput = input as PreToolUseHookInput;
    const toolInput = preInput.tool_input as Record<string, unknown>;
    const filePath = toolInput?.file_path as string;

    if (filePath?.startsWith("/etc")) {
      return {
        // 頂級欄位：顯示給使用者的訊息
        systemMessage: "Remember: system directories like /etc are protected.",
        // hookSpecificOutput：阻止操作
        hookSpecificOutput: {
          hookEventName: preInput.hook_event_name,
          permissionDecision: "deny",
          permissionDecisionReason: "Writing to /etc is not allowed"
        }
      };
    }
    return {};
  };
  ```
</CodeGroup>

### 自動批准特定工具

預設情況下，代理可能在使用某些工具前提示權限。此範例通過返回 `permissionDecision: 'allow'` 自動批准唯讀檔案系統工具（Read、Glob、Grep），讓它們無需使用者確認即可執行，同時讓所有其他工具受到正常權限檢查：

<CodeGroup>
  ```python Python theme={null}
  async def auto_approve_read_only(input_data, tool_use_id, context):
      if input_data["hook_event_name"] != "PreToolUse":
          return {}

      read_only_tools = ["Read", "Glob", "Grep"]
      if input_data["tool_name"] in read_only_tools:
          return {
              "hookSpecificOutput": {
                  "hookEventName": input_data["hook_event_name"],
                  "permissionDecision": "allow",
                  "permissionDecisionReason": "Read-only tool auto-approved",
              }
          }
      return {}
  ```

  ```typescript TypeScript theme={null}
  const autoApproveReadOnly: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};

    const preInput = input as PreToolUseHookInput;
    const readOnlyTools = ["Read", "Glob", "Grep"];
    if (readOnlyTools.includes(preInput.tool_name)) {
      return {
        hookSpecificOutput: {
          hookEventName: preInput.hook_event_name,
          permissionDecision: "allow",
          permissionDecisionReason: "Read-only tool auto-approved"
        }
      };
    }
    return {};
  };
  ```
</CodeGroup>

### 註冊多個 hooks

當事件觸發時，所有匹配的 hooks 並行執行。對於權限決定，最嚴格的結果獲勝：單個 `deny` 會阻止工具呼叫，無論其他 hooks 返回什麼。由於完成順序是不確定的，請編寫每個 hook 以獨立行動，而不是依賴另一個 hook 已執行。

下面的範例為每個工具呼叫註冊三個獨立檢查：

<CodeGroup>
  ```python Python theme={null}
  options = ClaudeAgentOptions(
      hooks={
          "PreToolUse": [
              HookMatcher(hooks=[authorization_check]),
              HookMatcher(hooks=[input_validator]),
              HookMatcher(hooks=[audit_logger]),
          ]
      }
  )
  ```

  ```typescript TypeScript theme={null}
  const options = {
    hooks: {
      PreToolUse: [
        { hooks: [authorizationCheck] },
        { hooks: [inputValidator] },
        { hooks: [auditLogger] }
      ]
    }
  };
  ```
</CodeGroup>

### 使用多工具匹配器篩選

使用多工具匹配器在相關工具間共享一個回調。此範例註冊三個具有不同範圍的匹配器：

* 管道分隔的精確列表（`Write|Edit|Delete`）僅針對檔案修改工具觸發 `file_security_hook`。
* 正規表達式（`^mcp__`）針對任何名稱以 `mcp__` 開頭的 MCP 工具觸發 `mcp_audit_hook`。
* 省略的匹配器針對每個工具呼叫（無論名稱如何）觸發 `global_logger`。

<CodeGroup>
  ```python Python theme={null}
  options = ClaudeAgentOptions(
      hooks={
          "PreToolUse": [
              # 匹配檔案修改工具
              HookMatcher(matcher="Write|Edit|Delete", hooks=[file_security_hook]),
              # 匹配所有 MCP 工具
              HookMatcher(matcher="^mcp__", hooks=[mcp_audit_hook]),
              # 匹配所有內容（無匹配器）
              HookMatcher(hooks=[global_logger]),
          ]
      }
  )
  ```

  ```typescript TypeScript theme={null}
  const options = {
    hooks: {
      PreToolUse: [
        // 匹配檔案修改工具
        { matcher: "Write|Edit|Delete", hooks: [fileSecurityHook] },

        // 匹配所有 MCP 工具
        { matcher: "^mcp__", hooks: [mcpAuditHook] },

        // 匹配所有內容（無匹配器）
        { hooks: [globalLogger] }
      ]
    }
  };
  ```
</CodeGroup>

### 追蹤子代理活動

使用 `SubagentStop` hooks 監控子代理何時完成其工作。請參閱 [TypeScript](/zh-TW/agent-sdk/typescript#hookinput) 和 [Python](/zh-TW/agent-sdk/python#hookinput) SDK 參考中的完整輸入類型。此範例在每次子代理完成時記錄摘要：

<CodeGroup>
  ```python Python theme={null}
  async def subagent_tracker(input_data, tool_use_id, context):
      # 子代理完成時記錄子代理詳細資訊
      print(f"[SUBAGENT] Completed: {input_data['agent_id']}")
      print(f"  Transcript: {input_data['agent_transcript_path']}")
      print(f"  Tool use ID: {tool_use_id}")
      print(f"  Stop hook active: {input_data.get('stop_hook_active')}")
      return {}


  options = ClaudeAgentOptions(
      hooks={"SubagentStop": [HookMatcher(hooks=[subagent_tracker])]}
  )
  ```

  ```typescript TypeScript theme={null}
  import { HookCallback, SubagentStopHookInput } from "@anthropic-ai/claude-agent-sdk";

  const subagentTracker: HookCallback = async (input, toolUseID, { signal }) => {
    // 轉換為 SubagentStopHookInput 以存取子代理特定欄位
    const subInput = input as SubagentStopHookInput;

    // 子代理完成時記錄子代理詳細資訊
    console.log(`[SUBAGENT] Completed: ${subInput.agent_id}`);
    console.log(`  Transcript: ${subInput.agent_transcript_path}`);
    console.log(`  Tool use ID: ${toolUseID}`);
    console.log(`  Stop hook active: ${subInput.stop_hook_active}`);
    return {};
  };

  const options = {
    hooks: {
      SubagentStop: [{ hooks: [subagentTracker] }]
    }
  };
  ```
</CodeGroup>

### 從 hooks 發出 HTTP 請求

Hooks 可以執行非同步操作，例如 HTTP 請求。在您的 hook 內捕捉錯誤，而不是讓它們傳播，因為未處理的異常可能會中斷代理。

此範例在每個工具完成後傳送 webhook，記錄哪個工具執行以及何時執行。hook 捕捉錯誤，以便失敗的 webhook 不會中斷代理：

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import json
  import urllib.request
  from datetime import datetime


  def _send_webhook(tool_name):
      """同步幫助程式，將工具使用資料 POST 到外部 webhook。"""
      data = json.dumps(
          {
              "tool": tool_name,
              "timestamp": datetime.now().isoformat(),
          }
      ).encode()
      req = urllib.request.Request(
          "https://api.example.com/webhook",
          data=data,
          headers={"Content-Type": "application/json"},
          method="POST",
      )
      urllib.request.urlopen(req)


  async def webhook_notifier(input_data, tool_use_id, context):
      # 僅在工具完成後觸發（PostToolUse），而不是之前
      if input_data["hook_event_name"] != "PostToolUse":
          return {}

      try:
          # 在執行緒中執行阻止 HTTP 呼叫以避免阻止事件迴圈
          await asyncio.to_thread(_send_webhook, input_data["tool_name"])
      except Exception as e:
          # 記錄錯誤但不引發。失敗的 webhook 不應停止代理
          print(f"Webhook request failed: {e}")

      return {}
  ```

  ```typescript TypeScript theme={null}
  import { query, HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

  const webhookNotifier: HookCallback = async (input, toolUseID, { signal }) => {
    // 僅在工具完成後觸發（PostToolUse），而不是之前
    if (input.hook_event_name !== "PostToolUse") return {};

    try {
      await fetch("https://api.example.com/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: (input as PostToolUseHookInput).tool_name,
          timestamp: new Date().toISOString()
        }),
        // 傳遞 signal 以便在 hook 超時時取消請求
        signal
      });
    } catch (error) {
      // 分別處理取消和其他錯誤
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Webhook request cancelled");
      }
      // 不重新拋出。失敗的 webhook 不應停止代理
    }

    return {};
  };

  // 註冊為 PostToolUse hook
  for await (const message of query({
    prompt: "Refactor the auth module",
    options: {
      hooks: {
        PostToolUse: [{ hooks: [webhookNotifier] }]
      }
    }
  })) {
    console.log(message);
  }
  ```
</CodeGroup>

### 將通知轉發到 Slack

使用 `Notification` hooks 接收來自代理的系統通知並將其轉發到外部服務。通知針對特定事件類型觸發，例如：

* `permission_prompt` 當 Claude 需要權限時
* `idle_prompt` 當 Claude 等待輸入時
* `auth_success` 當認證完成時
* `elicitation_dialog`、`elicitation_complete` 和 `elicitation_response` 用於使用者提示引導流程

每個通知都包括帶有人類可讀描述的 `message` 欄位，以及可選的 `title`。

此範例將每個通知轉發到 Slack 頻道。它需要 [Slack 傳入 webhook URL](https://api.slack.com/messaging/webhooks)，您可以通過將應用程式新增到 Slack 工作區並啟用傳入 webhooks 來建立：

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import json
  import urllib.request

  from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, HookMatcher


  def _send_slack_notification(message):
      """同步幫助程式，通過傳入 webhook 將訊息傳送到 Slack。"""
      data = json.dumps({"text": f"Agent status: {message}"}).encode()
      req = urllib.request.Request(
          "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
          data=data,
          headers={"Content-Type": "application/json"},
          method="POST",
      )
      urllib.request.urlopen(req)


  async def notification_handler(input_data, tool_use_id, context):
      try:
          # 在執行緒中執行阻止 HTTP 呼叫以避免阻止事件迴圈
          await asyncio.to_thread(_send_slack_notification, input_data.get("message", ""))
      except Exception as e:
          print(f"Failed to send notification: {e}")

      # 返回空物件。通知 hooks 不修改代理行為
      return {}


  async def main():
      options = ClaudeAgentOptions(
          hooks={
              # 為通知事件註冊 hook（不需要匹配器）
              "Notification": [HookMatcher(hooks=[notification_handler])],
          },
      )

      async with ClaudeSDKClient(options=options) as client:
          await client.query("Analyze this codebase")
          async for message in client.receive_response():
              print(message)


  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { query, HookCallback, NotificationHookInput } from "@anthropic-ai/claude-agent-sdk";

  // 定義一個將通知傳送到 Slack 的 hook 回調
  const notificationHandler: HookCallback = async (input, toolUseID, { signal }) => {
    // 轉換為 NotificationHookInput 以存取訊息欄位
    const notification = input as NotificationHookInput;

    try {
      // POST 通知訊息到 Slack 傳入 webhook
      await fetch("https://hooks.slack.com/services/YOUR/WEBHOOK/URL", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Agent status: ${notification.message}`
        }),
        // 傳遞 signal 以便在 hook 超時時取消請求
        signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Notification cancelled");
      } else {
        console.error("Failed to send notification:", error);
      }
    }

    // 返回空物件。通知 hooks 不修改代理行為
    return {};
  };

  // 為通知事件註冊 hook（不需要匹配器）
  for await (const message of query({
    prompt: "Analyze this codebase",
    options: {
      hooks: {
        Notification: [{ hooks: [notificationHandler] }]
      }
    }
  })) {
    console.log(message);
  }
  ```
</CodeGroup>

## 修復常見問題

### Hook 未觸發

* 驗證 hook 事件名稱正確且區分大小寫（`PreToolUse`，而不是 `preToolUse`）
* 檢查您的匹配器模式是否與工具名稱完全匹配
* 確保 hook 在 `options.hooks` 中的正確事件類型下
* 對於非工具 hooks，如 `Stop` 和 `SubagentStop`，匹配器匹配不同的欄位（請參閱[匹配器模式](/zh-TW/hooks#matcher-patterns)）
* 當代理達到 [`max_turns`](/zh-TW/agent-sdk/python#claudeagentoptions) 限制時，hooks 可能不會觸發，因為會話在 hooks 可以執行前結束

### 匹配器未按預期篩選

匹配器只匹配**工具名稱**，不匹配檔案路徑或其他參數。要按檔案路徑篩選，請在您的 hook 內檢查 `tool_input.file_path`：

```typescript theme={null}
const myHook: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  const toolInput = preInput.tool_input as Record<string, unknown>;
  const filePath = toolInput?.file_path as string;
  if (!filePath?.endsWith(".md")) return {}; // 跳過非 markdown 檔案
  // 處理 markdown 檔案...
  return {};
};
```

### Hook 超時

* 增加 `HookMatcher` 配置中的 `timeout` 值
* 在 TypeScript 中使用第三個回調參數中的 `AbortSignal` 以優雅地處理取消

### 工具意外被阻止

* 檢查所有 `PreToolUse` hooks 是否返回 `permissionDecision: 'deny'`
* 將記錄新增到您的 hooks 以查看它們返回的 `permissionDecisionReason`
* 驗證匹配器模式不會太寬泛（空匹配器匹配所有工具）

### 修改的輸入未應用

* 確保 `updatedInput` 在 `hookSpecificOutput` 內，而不是在頂級：

  ```typescript theme={null}
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: "new command" }
    }
  };
  ```

* 返回 `permissionDecision: 'allow'` 以自動批准修改的輸入，或 `'ask'` 以向使用者顯示以供批准

* 在 `hookSpecificOutput` 中包括 `hookEventName` 以識別輸出適用於哪個 hook 類型

### Python 中不可用會話 hooks

`SessionStart` 和 `SessionEnd` 可以在 TypeScript 中註冊為 SDK 回調 hooks，但在 Python SDK 中不可用（`HookEvent` 省略它們）。在 Python 中，它們僅作為[shell 命令 hooks](/zh-TW/hooks#hook-events) 在設定檔案中定義（例如 `.claude/settings.json`）。要從您的 SDK 應用程式載入 shell 命令 hooks，請使用 [`setting_sources`](/zh-TW/agent-sdk/python#settingsource) 或 [`settingSources`](/zh-TW/agent-sdk/typescript#settingsource) 包括適當的設定來源：

<CodeGroup>
  ```python Python theme={null}
  options = ClaudeAgentOptions(
      setting_sources=["project"],  # 載入 .claude/settings.json 包括 hooks
  )
  ```

  ```typescript TypeScript theme={null}
  const options = {
    settingSources: ["project"] // 載入 .claude/settings.json 包括 hooks
  };
  ```
</CodeGroup>

要改為執行初始化邏輯作為 Python SDK 回調，請使用 `client.receive_response()` 的第一條訊息作為您的觸發器。

### 子代理權限提示倍增

生成多個子代理時，每個子代理可能會分別請求權限。子代理不會自動繼承父代理權限。要避免重複提示，請使用 `PreToolUse` hooks 自動批准特定工具，或配置適用於子代理會話的權限規則。

### 子代理的遞迴 hook 迴圈

生成子代理的 `UserPromptSubmit` hook 如果這些子代理觸發相同的 hook，可能會建立無限迴圈。要防止這種情況：

* 在生成子代理前檢查 hook 輸入中的子代理指示器
* 使用共享變數或會話狀態來追蹤您是否已在子代理內
* 將 hooks 範圍限制為僅針對頂級代理會話執行

### systemMessage 未出現在輸出中

`systemMessage` 欄位向使用者顯示訊息，而不是模型。預設情況下，SDK 不會在訊息流中呈現 hook 輸出，因此除非您設定 `includeHookEvents`（Python 中的 `include_hook_events`），否則訊息可能不會出現。要改為將上下文傳遞給模型，請返回 [`additionalContext`](/zh-TW/hooks#add-context-for-claude)。

如果您需要可靠地將 hook 決定呈現給您的應用程式，請分別記錄它們或使用專用輸出頻道。

## 相關資源

* [Claude Code hooks 參考](/zh-TW/hooks)：完整的 JSON 輸入/輸出架構、事件文件和匹配器模式
* [Claude Code hooks 指南](/zh-TW/hooks-guide)：shell 命令 hook 範例和逐步解說
* [TypeScript SDK 參考](/zh-TW/agent-sdk/typescript)：hook 類型、輸入/輸出定義和配置選項
* [Python SDK 參考](/zh-TW/agent-sdk/python)：hook 類型、輸入/輸出定義和配置選項
* [權限](/zh-TW/agent-sdk/permissions)：控制您的代理可以做什麼
* [自訂工具](/zh-TW/agent-sdk/custom-tools)：建立工具以擴展代理功能
