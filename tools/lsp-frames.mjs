// LSP 基礎協定（base protocol）訊息框架解析器
//
// 為什麼獨立成一支：`ata-storm.mjs` 與 `ata-diagnose.mjs` 都要解析 server→client 的訊息，
// 這段又特別容易寫錯，故抽出共用並附煙霧測試（`lsp-frames.smoke.mjs`）。
//
// 初版（內嵌在 ata-storm.mjs 裡）有三個疊在一起的缺陷，最壞情況會無限空轉並卡死清理：
//   1. 以已 decode 的 JS 字串累積緩衝 —— `Content-Length` 是**位元組**數，非 ASCII 內容
//      會使長度比較錯位；`toString('utf8')` 在 chunk 邊界也可能切壞多位元組字元。
//   2. 找不到 `Content-Length:` 字面時直接 `buf = ''`，把整個緩衝區丟掉 —— 標頭若被
//      chunk 邊界切成兩半（`Content-Len` | `gth:`）就會解析失步。
//   3. 標頭區若含第二個標頭（如 `Content-Type`），`Number(...)` 得到 `NaN`：不 break、
//      `slice(hEnd + 4 + NaN)` 退化成 `slice(0)` 使緩衝區不變、`JSON.parse('')` 拋出後
//      `continue` → `for(;;)` 永久空轉，事件迴圈被佔住，`finally` 的清理永遠不執行，
//      churn 目錄與 LSP 行程就會殘留。
//
// 本版的核心不變式：**每一條 `continue` 都必定發生在緩衝區已經前進之後**，
// 因此不存在原地打轉的路徑；只有「資料尚未到齊」才 `break`（保留緩衝等下一個 chunk）。

const SEP = Buffer.from('\r\n\r\n')
const MAX_HEADER_BYTES = 64 * 1024   // 尚未出現標頭終止符時的累積上限，防止惡意/失步輸入吃光記憶體

/**
 * 建立一個 chunk 消費函式：把每個收到的 Buffer 餵進去，解析完整的訊息就呼叫 onMessage。
 * @param {(msg: any) => void} onMessage 收到一則完整且能 JSON.parse 的訊息時呼叫
 * @returns {(chunk: Buffer|string) => void}
 */
export const createFrameReader = onMessage => {
  let buf = Buffer.alloc(0)

  return chunk => {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])

    for (;;) {
      const sep = buf.indexOf(SEP)
      if (sep === -1) {
        // 標頭尚未到齊（可能正好被 chunk 邊界切斷）→ 保留緩衝等下一個 chunk。
        // 但若已累積到不合理的量仍無終止符，代表已經失步，整段丟棄以免無限膨脹
        // （此時保留尾巴沒有意義：既然已失步，殘留的位元組只會污染下一個標頭）。
        if (buf.length > MAX_HEADER_BYTES) buf = Buffer.alloc(0)
        break
      }

      // 標頭一律為 ASCII；用 latin1 解避免任何多位元組解讀問題。
      // 刻意不做行首錨定，改取整段中**最後一個** Content-Length —— 失步後殘留的垃圾
      // 可能與真正的標頭黏在同一行（`AAAAContent-Length: 22`），錨定會導致永遠無法復原。
      const header = buf.subarray(0, sep).toString('latin1')
      let len = NaN
      for (const m of header.matchAll(/content-length:[ \t]*(\d+)/gi)) len = Number(m[1])

      if (!Number.isInteger(len) || len < 0) {
        // 標頭壞掉或缺少 Content-Length：丟棄這一段**並前進**（絕不原地不動）
        buf = buf.subarray(sep + SEP.length)
        continue
      }

      if (buf.length < sep + SEP.length + len) break   // 本體尚未到齊 → 等下一個 chunk

      // 依**位元組**切出本體，再整段 decode —— 多位元組字元不會被切壞
      const body = buf.subarray(sep + SEP.length, sep + SEP.length + len).toString('utf8')
      buf = buf.subarray(sep + SEP.length + len)

      let msg
      try { msg = JSON.parse(body) } catch { continue }   // 此時緩衝區已前進，continue 安全
      onMessage(msg)
    }
  }
}
