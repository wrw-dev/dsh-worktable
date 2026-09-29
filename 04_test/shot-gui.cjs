// shot-gui.cjs — 无头 Chrome 截图宿主 GUI（验证新客户端 bundle 加载 + 工作台渲染）
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const PORT = 9391
const OUT = path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const chrome = candidates.find((p) => fs.existsSync(p))
if (!chrome) { console.log('NO_BROWSER_FOUND'); process.exit(1) }

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,950', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(require('os').tmpdir(), 'wt-shot-gui-1'),
  'about:blank',
], { stdio: 'ignore' })
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  let list = null
  for (let i = 0; i < 40; i++) { try { list = await getJSON('/json/list'); if (list && list.length) break } catch {} await sleep(500) }
  if (!list || !list.length) { console.log('NO_TARGET'); proc.kill(); process.exit(1) }
  const WebSocket = require('C:/Users/26294/.dsh/profiles/web/node_modules/ws')
  const target = list.find((t) => t.type === 'page') || list[0]
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0; const pending = new Map()
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  await new Promise((r) => ws.on('open', r))
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text }
    return r.result && r.result.result ? r.result.result.value : undefined
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
  await sleep(5000)

  const info = await ev(`(function(){
    const errs = window.__errCount || 0
    const wt = !!window.__dshWorktable
    const side = !!document.querySelector('.dsh-worktable, [class*="worktable"]')
    const presetsTile = [...document.querySelectorAll('button,div,span')].some(el => (el.textContent||'').includes('预置'))
    return { url: location.href, title: document.title, wtDebugExit: wt, sidebarVisible: side, presetsTile }
  })()`)
  console.log('INFO', JSON.stringify(info))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const b64 = shot && ((shot.result && shot.result.data) || shot.data)
  if (b64) { fs.writeFileSync(path.join(OUT, 'gui-after-fix.png'), Buffer.from(b64, 'base64')); console.log('SHOT ok') }
  else console.log('SHOT fail')
  ws.close(); proc.kill(); process.exit(0)
})().catch((e) => { console.error(e); proc.kill(); process.exit(1) })
