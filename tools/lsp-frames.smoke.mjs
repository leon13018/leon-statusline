// `lsp-frames.mjs` 的煙霧測試：用假造的 LSP 輸出餵解析器，確認畸形標頭不會無限迴圈。
// 用法：node tools/lsp-frames.smoke.mjs        （零依賴，不需 vitest；exit code 非 0 即失敗）
//
// 註：本 repo 的 vitest 只收 `leon-statusline/tests/**/*.test.mjs`，而 tools/ 在該 package 之外，
// 故寫成可直接用 node 執行的獨立煙霧測試，不動既有測試設定。
import { createFrameReader } from './lsp-frames.mjs'

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

// 所有測試都包在 watchdog 下：解析器若無限迴圈，整支腳本會停在這裡不返回，
// 故用同步的迴圈計數上限來偵測（見 case 3 的 hostile 輸入）。
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
  // 找一個落在 UTF-8 多位元組序列中間的切點
  const cut = f.length - 7
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

// 10. ⚠️ 終極防呆：連續餵大量畸形標頭段，必須在有限時間內返回。
//     若解析器有原地打轉的路徑，這裡會直接掛住（測試逾時即為失敗）。
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

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`)
process.exit(fail === 0 ? 0 : 1)
