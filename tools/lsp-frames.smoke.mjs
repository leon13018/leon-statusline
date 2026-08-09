// `lsp-frames.mjs` 的煙霧測試：用假造的 LSP 輸出餵解析器，確認畸形標頭不會無限迴圈。
// 用法：node tools/lsp-frames.smoke.mjs        （零依賴，不需 vitest；exit code 非 0 即失敗）
//
// 註：本 repo 的 vitest 只收 `leon-statusline/tests/**/*.test.mjs`，而 tools/ 在該 package 之外，
// 故寫成可直接用 node 執行的獨立煙霧測試，不動既有測試設定。
//
// ## Watchdog（重要）
//
// 本解析器的回歸模式是**無限迴圈**（見 lsp-frames.mjs 檔頭的缺陷 3）。無限迴圈發生在
// `feed()` 內部，該呼叫永遠不返回 —— 測試裡寫任何「迴圈計數上限」或耗時斷言都**走不到**，
// 結果是整支腳本永久掛住：那是「當機」不是「測試失敗」，CI 只會看到逾時。
//
// 因此 watchdog 必須在卡住的呼叫**之外**：本檔預設以父行程身分把自己 spawn 成子行程並設逾時，
// 子行程若卡死就殺掉並判定**失敗**（exit 1），確保回歸時得到的是明確的失敗而非當機。
// 子行程由環境變數 `LSP_SMOKE_CHILD` 標記，直接執行全部案例。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createFrameReader } from './lsp-frames.mjs'

const WATCHDOG_MS = 15_000

// ── 父行程：spawn 自己並看門 ──────────────────────────────────────────────
if (!process.env.LSP_SMOKE_CHILD) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, LSP_SMOKE_CHILD: '1' },
    timeout: WATCHDOG_MS,
    encoding: 'utf8',
  })
  process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM'
  if (timedOut) {
    console.log(`\n✗ watchdog：子行程逾時 ${WATCHDOG_MS}ms 未結束`)
    console.log('  解析器極可能回歸為無限迴圈（feed() 不返回）。這是失敗，不是當機。')
    process.exit(1)
  }
  process.exit(r.status ?? 1)
}

// ── 子行程：實際案例 ──────────────────────────────────────────────────────
let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

const frame = (obj, extraHeaders = '') => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n${extraHeaders}\r\n`, 'ascii'), body])
}

// 收訊輔助：回傳 [feed, got]
const reader = () => {
  const got = []
  return [createFrameReader(m => got.push(m)), got]
}

console.log('lsp-frames 煙霧測試')

// 1. 基本：一個 chunk 一則訊息
{
  const [feed, got] = reader()
  feed(frame({ jsonrpc: '2.0', method: 'a' }))
  check('單一完整訊息', got.length === 1 && got[0].method === 'a', JSON.stringify(got))
}

// 2. 一個 chunk 內多則訊息
{
  const [feed, got] = reader()
  feed(Buffer.concat([frame({ method: 'a' }), frame({ method: 'b' }), frame({ method: 'c' })]))
  check('單一 chunk 內三則訊息', got.length === 3 && got[2].method === 'c', JSON.stringify(got))
}

// 3. ⚠️ 迴歸重點：標頭含第二個標頭（Content-Type）。
//    舊版在此 Number(...) 得 NaN → 緩衝區不前進 → for(;;) 永久空轉。
{
  const [feed, got] = reader()
  feed(frame({ method: 'withContentType' }, 'Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n'))
  check('標頭含 Content-Type（舊版會無限迴圈）', got.length === 1 && got[0].method === 'withContentType', JSON.stringify(got))
}

// 4. ⚠️ 迴歸重點：完全畸形、缺少 Content-Length 的標頭段，必須被丟棄且能繼續解析後續訊息
{
  const [feed, got] = reader()
  feed(Buffer.concat([
    Buffer.from('Garbage-Header: 1\r\n\r\n', 'ascii'),      // 無 Content-Length
    frame({ method: 'afterGarbage' }),
  ]))
  check('缺 Content-Length 的段被丟棄且不卡死', got.length === 1 && got[0].method === 'afterGarbage', JSON.stringify(got))
}

// 5. ⚠️ 迴歸重點：標頭被 chunk 邊界切成兩半（Content-Len | gth:）
{
  const [feed, got] = reader()
  const f = frame({ method: 'splitHeader' })
  feed(f.subarray(0, 11))    // "Content-Len"
  check('切半標頭：前半不應產生訊息', got.length === 0)
  feed(f.subarray(11))
  check('切半標頭：後半到齊後解析成功', got.length === 1 && got[0].method === 'splitHeader', JSON.stringify(got))
}

// 6. 本體被 chunk 邊界切開
{
  const [feed, got] = reader()
  const f = frame({ method: 'splitBody', pad: 'xxxxxxxxxx' })
  const cut = f.length - 5
  feed(f.subarray(0, cut))
  check('切半本體：未到齊不產生訊息', got.length === 0)
  feed(f.subarray(cut))
  check('切半本體：到齊後解析成功', got.length === 1 && got[0].method === 'splitBody', JSON.stringify(got))
}

// 7. ⚠️ 位元組 vs 字元：非 ASCII 內容（Content-Length 是位元組數）
{
  const [feed, got] = reader()
  const obj = { method: '中文訊息', text: '失敗查找位置與診斷重算' }
  feed(frame(obj))
  check('非 ASCII 本體長度正確', got.length === 1 && got[0].text === obj.text, JSON.stringify(got))
}

// 8. 非 ASCII 且在多位元組字元中間切開 chunk
{
  const [feed, got] = reader()
  const f = frame({ method: '多位元組', text: '中文中文中文' })
  const cut = f.length - 7   // 落在 UTF-8 多位元組序列中間
  feed(f.subarray(0, cut))
  feed(f.subarray(cut))
  check('多位元組字元跨 chunk 不被切壞', got.length === 1 && got[0].text === '中文中文中文', JSON.stringify(got))
}

// 9. 本體不是合法 JSON → 丟棄該則，但後續訊息仍能解析（不得卡死）
{
  const [feed, got] = reader()
  const bad = Buffer.from('{not json', 'utf8')
  feed(Buffer.concat([
    Buffer.from(`Content-Length: ${bad.length}\r\n\r\n`, 'ascii'), bad,
    frame({ method: 'afterBadJson' }),
  ]))
  check('壞 JSON 被跳過且不卡死', got.length === 1 && got[0].method === 'afterBadJson', JSON.stringify(got))
}

// 10. ⚠️ 終極防呆：連續餵大量畸形標頭段。
//     若解析器有原地打轉的路徑，這裡會卡在 feed() 內 —— 由父行程的 watchdog 判定失敗。
{
  const [feed, got] = reader()
  const t0 = Date.now()
  for (let i = 0; i < 5000; i++) feed(Buffer.from('Content-Length: abc\r\n\r\n', 'ascii'))
  feed(frame({ method: 'survived' }))
  const ms = Date.now() - t0
  check('5000 段畸形標頭後仍能解析且未卡死', got.length === 1 && got[0].method === 'survived', JSON.stringify(got))
  check(`耗時合理（${ms}ms < 5000ms）`, ms < 5000)
}

// 11. 無標頭終止符的巨量垃圾流：不得無限膨脹記憶體，且之後仍能恢復解析
{
  const [feed, got] = reader()
  for (let i = 0; i < 40; i++) feed(Buffer.alloc(8 * 1024, 0x41))   // 320KB 的 'A'，無 \r\n\r\n
  feed(frame({ method: 'recovered' }))
  check('巨量無終止符垃圾後仍能恢復解析', got.length === 1 && got[0].method === 'recovered', JSON.stringify(got))
}

// 12. onMessage 拋例外不得逃出 feed()（否則 uncaughtException 會讓呼叫端的 finally 不執行，
//     churn 目錄與 LSP 行程殘留）。後續訊息仍須繼續處理。
{
  const seen = []
  const feed = createFrameReader(m => {
    seen.push(m.method)
    if (m.method === 'boom') throw new TypeError("Cannot read properties of undefined (reading 'uri')")
  })
  let threw = false
  try {
    feed(Buffer.concat([frame({ method: 'boom' }), frame({ method: 'afterBoom' })]))
  } catch { threw = true }
  check('onMessage 拋例外不會逃出 feed()', !threw)
  check('onMessage 拋例外後仍繼續處理後續訊息', seen.length === 2 && seen[1] === 'afterBoom', JSON.stringify(seen))
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`)
process.exit(fail === 0 ? 0 : 1)
