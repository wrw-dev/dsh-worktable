// preset-picker-dom.cjs — 探测 3080 页面真实 DOM：侧栏卡片/控制室/窗格选择器类名
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9362;
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(require('os').tmpdir(), 'wt-chrome-picker-dom'),
  'about:blank',
], { stdio: 'ignore' });
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }); }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) { try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {} await sleep(500); }
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  await sleep(3500);
  const info = await new Promise((res) => {
    send('Runtime.evaluate', { expression: `(function(){
      const out = { title: document.title, wt: [], panePick: 0, sidebar: [] };
      document.querySelectorAll('[class*="wt_"]').forEach((el) => {
        const c = el.className;
        if (typeof c === 'string' && !out.wt.includes(c)) out.wt.push(c);
      });
      out.wt = out.wt.slice(0, 60);
      out.panePick = document.querySelectorAll('.dsh-wt_panePick').length;
      out.hasConsoleCard = !!document.querySelector('[class*="console"]');
      out.bodySnippet = (document.body.innerText || '').slice(0, 600);
      return JSON.stringify(out);
    })()`, returnByValue: true }).then((r) => res(r.result.result.value));
  });
  console.log(info);
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
