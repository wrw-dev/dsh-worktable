// probe-project-shot.cjs — 真实界面截图（通用版）：播种指定项目（多窗口挂站点产物）
// → 打开该项目 → 等 iframe 全部就绪 → 截图到指定 PNG。
// 用法：node probe-project-shot.cjs <spec.json> <out.png>
// spec 结构（全部必填，含中文/反斜杠路径时保存为 UTF-8）：
// {
//   "project": { "id": "ai-news", "title": "AI资讯", "icon": "📰", "folder": "E:\\path\\to\\proj" },
//   "windows": [ { "title": "AI热榜", "file": "w1-ai-hotlist.html" }, ... ],
//   "viewport": { "width": 1920, "height": 1200 },
//   "topRatio": 0.55
// }
// 窗口布局：≤3 个全放顶行；>3 个顶行 3 个 + 主行其余；右侧恒为对话窗。
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SPEC_PATH = process.argv[2];
const OUT_PATH = process.argv[3];
if (!SPEC_PATH || !OUT_PATH) { console.error('用法: node probe-project-shot.cjs <spec.json> <out.png>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

const PORT = 9383;
const PROFILE = path.join(process.env.TEMP || '.', 'wt-chrome-shot-' + Date.now());
const VIEW = spec.viewport || { width: 1920, height: 1200 };
const SCALE = spec.scale || 1;
const TOP_RATIO = spec.topRatio ?? 0.55;

// 窗口 → 行分布（顶行最多 3 个，其余进主行）
const wins = spec.windows;
const topWins = wins.length <= 3 ? wins : wins.slice(0, 3);
const mainWins = wins.length <= 3 ? [] : wins.slice(3);
const toTab = (w) => ({ id: 't-' + w.title, title: w.title, content: { kind: 'iframe', url: '/api/worktable/site/' + encodeURIComponent(w.folder) + '/' + encodeURIComponent(w.file) } });
const toPane = (w) => ({ id: 'p-' + w.title, title: w.title, min: 160, tabs: [toTab(w)], active: 0 });

const projects = {
  order: [spec.project.id], lastUsed: {}, hidden: [], nameOverrides: {}, iconOverrides: {}, shortcuts: [],
  layouts: [{
    id: spec.project.id, title: spec.project.title, icon: spec.project.icon,
    top: topWins.length ? topWins.map(toPane) : null,
    main: mainWins.length ? mainWins.map(toPane) : (topWins.length ? [] : []),
    chatWidth: { default: 360, min: 240, max: 600 },
    topHeight: { default: 300, min: 120, max: 720 },
    topHeightRatio: TOP_RATIO,
    chatSide: 'right', chatFullHeight: false,
  }],
  bindings: {},
  folders: { [spec.project.id]: spec.project.folder },
  views: {}, removed: [],
};
const view = { query: '', searchOpen: false, orderBy: 'manual', dock: 'footer', floatTop: null, sortMigratedV2: true };

const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=' + VIEW.width + ',' + VIEW.height, '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'inherit'] });
setTimeout(() => { try { process.stdout.write('[watchdog] 超时 150s，强制退出\n'); } catch {} try { proc.kill(); } catch {} process.exit(3); }, 150000);

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => process.stdout.write('[step] ' + msg + '\n');
process.on('uncaughtException', (e) => { try { process.stdout.write('[uncaught] ' + (e && e.stack || e) + '\n'); } catch {} try { proc.kill(); } catch {} process.exit(2); });
process.on('unhandledRejection', (e) => { try { process.stdout.write('[unrej] ' + (e && e.stack || e) + '\n'); } catch {} try { proc.kill(); } catch {} process.exit(2); });

(async () => {
  step('启动: ' + spec.project.title + ' (' + wins.length + ' 窗口)');
  let list = null;
  for (let i = 0; i < 40; i++) { try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {} await sleep(500); }
  if (!list) throw new Error('chrome devtools 未就绪');
  step('chrome devtools 就绪');
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  ws.addEventListener('error', (ev) => { try { process.stdout.write('[ws error] ' + (ev.message || ev) + '\n'); } catch {} });
  ws.addEventListener('close', () => { try { process.stdout.write('[ws close]\n'); } catch {} });
  await new Promise((r, rej) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  step('ws open');
  await send('Runtime.enable');
  await send('Page.enable');
  // 播种 localStorage（仅对宿主源生效）
  const seed = "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify(" + JSON.stringify(view) + ")); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(" + JSON.stringify(projects) + ")); } }catch(e){}";
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  if (ready !== true) throw new Error('工作台客户端未就绪');
  step('工作台客户端就绪');
  await sleep(1500);
  // 1) 展开侧栏
  await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  await sleep(1600);
  // 2) 点开目标项目卡（按名称精确匹配）
  const clickRes = await evaluate("(function(){ var name=" + JSON.stringify(spec.project.title) + "; var cards=[].slice.call(document.querySelectorAll('.dsh-wt_projects .dsh-wt_layout')); var card=cards.find(function(c){ var el=c.querySelector('.dsh-wt_layoutName'); return el && el.textContent===name; }); if(!card) return 'no-card'; card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return 'ok'; })()");
  console.log('CLICK:', JSON.stringify(clickRes));
  if (clickRes !== 'ok') throw new Error('未找到项目卡: ' + spec.project.title);
  step('项目卡已点击，等待 ' + wins.length + ' 个站点窗渲染');
  // 3) 等 5 个站点 iframe 全部渲染完成（同源可直接读 contentDocument）
  const EXPECT = wins.length;
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const st = await evaluate("(function(){ var fs=[].slice.call(document.querySelectorAll('iframe.dsh-wt_paneFrame')); if(fs.length!==" + EXPECT + ") return 'count:'+fs.length; for (var i=0;i<fs.length;i++){ try { var d=fs[i].contentDocument; if(!d||d.readyState!=='complete'||!d.body||d.body.innerText.length<10) return 'loading:'+i; } catch(e){ return 'x:'+i; } } return 'ready'; })()");
    if (st === 'ready') { ok = true; break; }
    if (i % 5 === 4) console.log('wait', st);
  }
  if (!ok) throw new Error('iframe 未全部就绪');
  step('iframe 全部就绪，截图');
  await sleep(2500);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const r = await send('Page.captureScreenshot', SCALE > 1
    ? { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: SCALE } }
    : { format: 'png' });
  fs.writeFileSync(OUT_PATH, Buffer.from(r.result.data, 'base64'));
  step('SHOT ' + OUT_PATH);
  try { ws.close(); } catch {}
  // Windows 下 Chrome 子进程树可能拖住退出：整树强杀，不靠看门狗
  const { execSync } = require('child_process');
  try { execSync('taskkill /pid ' + proc.pid + ' /t /f', { stdio: 'ignore' }); } catch {}
  process.exit(0);
})().catch((e) => { try { process.stdout.write('[fail] ' + (e && e.message || String(e)) + '\n'); } catch {} try { require('child_process').execSync('taskkill /pid ' + proc.pid + ' /t /f', { stdio: 'ignore' }); } catch {} process.exit(1); });
