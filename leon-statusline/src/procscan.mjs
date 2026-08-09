import { execFileSync } from 'node:child_process'

// 取樣來源是 PowerShell 的 Get-Process，不是 tasklist。
// 原因（2026-08-09 本機實測，347–359 個行程）：`tasklist /v /fo csv` 需 29–30 秒，
// 恆超過下面的 3 秒逾時 → 偵測器在真機上從未成功取樣過；`tasklist /fo csv`（602ms）沒有
// CPU Time 欄；`wmic` 已被 Windows 11 移除。Get-Process 約 270–310ms，直接給浮點 CPU 秒數。
//
// 命令的四個設計要點，每一項都有對應的靜態鎖（tests/procscan.test.mjs）：
// 1. `-NoProfile -NonInteractive`：不載入使用者 profile（慢且不可預期），也不等互動輸入。
// 2. 小數點明確指定 InvariantCulture：`$_.CPU` 直接字串串接會跟隨系統地區設定，
//    de-DE 之類的地區會吐出 `3,28125`（實測），數字剖析會壞掉。
// 3. 行程名放最後一欄：實測本機有 `Docker Desktop` 這種含空白的 ProcessName，
//    放中間會被空白分隔符切碎。pid 與 CPU 兩欄都不含空白，故只切前兩個分隔符即安全。
// 4. CPU 讀不到（受保護的系統行程，`$_.CPU` 為 `$null`；實測 355 個行程中有 116 個如此）
//    的列整列不輸出。**絕不補 0** —— 補 0 會讓那些行程的區間速率恆為 0，
//    永遠不可能被偵測到，是靜默失效。我們要抓的 node 是使用者自己的行程，讀得到。
const PS_COMMAND = [
  '$ci=[Globalization.CultureInfo]::InvariantCulture;',
  'Get-Process | ForEach-Object {',
  'if ($null -ne $_.CPU) {',
  "$_.Id.ToString($ci) + ' ' + $_.CPU.ToString($ci) + ' ' + $_.ProcessName",
  '} }',
].join(' ')

// 每列 `<pid> <cpu秒> <行程名>`。行程名可含空白，故用 (.+) 吃掉整個尾段
const ROW_RE = /^(\d+) (\S+) (.+)$/

// 注意：Get-Process 的 ProcessName 不帶副檔名（是 `node` 不是 `node.exe`）。
// 這裡照原樣使用、不自行把副檔名接回去 —— 補了就是捏造資料。
// 對使用者可見的變化：狀態列會顯示 node(31832) 0.86c 而非 node.exe(31832) 0.86c
function parseProcessLines(text) {
  if (typeof text !== 'string') return null
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const m = ROW_RE.exec(raw.trim())
    if (!m) continue
    const pid = Number(m[1])
    const cpuSeconds = Number(m[2])
    if (!Number.isInteger(pid) || pid < 0) continue
    if (!Number.isFinite(cpuSeconds) || cpuSeconds < 0) continue   // 非數字（含逗號小數點）整列丟掉，不補 0
    rows.push({ pid, name: m[3], cpuSeconds })
  }
  return rows.length ? rows : null
}

// 唯一與系統互動處。非 Windows 或任何失敗一律回 null（不 throw）
export function sampleProcesses({ exec, platform = process.platform } = {}) {
  if (platform !== 'win32') return null
  // encoding 必須是 utf8：拿到 Buffer 會讓 parseProcessLines 靜默回 null
  const run = exec || (() => execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', PS_COMMAND],
    { encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  ))
  try {
    return parseProcessLines(run())
  } catch {
    return null
  }
}
