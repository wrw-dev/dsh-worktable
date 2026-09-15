// 最小化/最大化/切标签保活回归探针（K3Cloud 登录态不丢）。
// 独立无头 Chrome + 一次性临时 profile，不触碰用户真实浏览器与真实 localStorage。
// 判定：iframe DOM 元素跨「最小化→还原 / 最大化让位→还原 / 切走标签→切回」保持同一元素，
// 且 iframe 内 JS 标记（__WT_MARKER__）不被清空 = 未重载。
const http = require('http');
const { spawn } = require('child_process');

const PORT = 9337;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = require('os').tmpdir() + '\\wt-chrome-keepalive-' + Date.now();
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: 'ignore' });

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } });
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {}
    await sleep(500);
  }
  if (!list) throw new Error('Chrome CDP 未就绪');
  const target = list.find((t) => t.type === 'page') || list[0];
  const WebSocket = require('C:/Users/26294/.dsh/profiles/web/node_modules/ws');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.on('open', r));
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');

  // 种一个两窗格布局：p1=浏览器（同源页面，可读 contentDocument 打标记）、p2=资源管理器
  const layout = {
    order: [], lastUsed: {}, hidden: [], nameOverrides: {},
    shortcuts: [],
    layouts: [{
      id: 't-ka', title: '保活探针', top: null, left: null,
      main: [
        { id: 'p1', title: '网页', min: 200, content: null, tabs: [{ id: 't1', title: '网页', content: { kind: 'builtin', type: 'browser', url: 'http://127.0.0.1:3080/' } }], active: 0 },
        { id: 'p2', title: '文件', min: 200, content: null, tabs: [{ id: 't2', title: '文件', content: { kind: 'builtin', type: 'explorer' } }], active: 0 },
      ],
      leftWidth: { default: 260, min: 160, max: 480 },
      chatWidth: { default: 360, min: 240, max: 600 },
      topHeight: { default: 200, min: 120, max: 480 },
      chatSide: 'right', chatFullHeight: false,
    }],
  };
  const seed = "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(" + JSON.stringify(layout) + ")); } }catch(e){}";
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });

  // 等工作台客户端就绪
  let ready = null;
  for (let i = 0; i < 40; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  if (ready !== true) throw new Error('工作台客户端未就绪');
  await sleep(1200);

  // 打开布局（分栏工作区）：传入完整 LayoutSpec
  const opened = await evaluate("(function(){ var st=window.__dshWorktable.splitStore; var spec=" + JSON.stringify(layout.layouts[0]) + "; var r=st.open(spec); return r===true && st.active; })()");
  if (opened !== true) throw new Error('分栏工作区未打开: ' + JSON.stringify(opened));
  // 等浏览器 iframe 就绪（同源可读）
  let iframeOk = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    iframeOk = await evaluate("(function(){ var f=document.querySelector('iframe.dsh-wt_paneFrame'); try { return !!(f && f.contentDocument && f.contentDocument.readyState==='complete'); } catch(e){ return false; } })()");
    if (iframeOk === true) break;
  }
  if (iframeOk !== true) throw new Error('iframe 未就绪');
  // 给 iframe 打标记（重载即丢）
  await evaluate("(function(){ document.querySelector('iframe.dsh-wt_paneFrame').contentWindow.__WT_MARKER__=42; })()");

  const check = async (label) => {
    const r = await evaluate("(function(){ var f=document.querySelector('iframe.dsh-wt_paneFrame'); if(!f) return {alive:false}; try { return { alive:true, marker:f.contentWindow.__WT_MARKER__, parked:!!document.querySelector('.dsh-wt_paneParked') }; } catch(e){ return { alive:false, err:String(e) }; } })()");
    const pass = r && r.alive && r.marker === 42;
    console.log((pass ? 'PASS' : 'FAIL') + ' [' + label + '] ' + JSON.stringify(r));
    return !!pass;
  };

  let allOk = true;

  // ① 最小化 → 还原
  await evaluate("(function(){ window.__dshWorktable.splitStore.setPaneMinimized('main',0,true); return true })()");
  await sleep(600);
  allOk = (await check('最小化(保活)')) && allOk;
  await evaluate("(function(){ window.__dshWorktable.splitStore.setPaneMinimized('main',0,false); return true })()");
  await sleep(600);
  allOk = (await check('最小化后还原')) && allOk;

  // ② 最大化另一窗（本窗让位最小化）→ 还原（用户实际路径）
  await evaluate("(function(){ window.__dshWorktable.splitStore.setPaneMaximized('main',1,true); return true })()");
  await sleep(600);
  allOk = (await check('他窗最大化(本窗让位)')) && allOk;
  await evaluate("(function(){ window.__dshWorktable.splitStore.setPaneMaximized('main',1,false); return true })()");
  await sleep(600);
  allOk = (await check('他窗还原(本窗回位)')) && allOk;

  // ③ 同窗格切走标签 → 切回
  await evaluate("(function(){ window.__dshWorktable.splitStore.openTab('main',0,{kind:'builtin',type:'explorer'}); return true })()");
  await sleep(600);
  await evaluate("(function(){ window.__dshWorktable.splitStore.setActiveTab('main',0,'t1'); return true })()");
  await sleep(600);
  allOk = (await check('切走标签后切回')) && allOk;

  // ④ iframe DOM 元素身份：给元素挂 expando，再走一轮最小化还原，元素必须是同一个
  await evaluate("(function(){ document.querySelector('iframe.dsh-wt_paneFrame').__WT_EL__='same'; window.__dshWorktable.splitStore.setPaneMinimized('main',0,true); return true })()");
  await sleep(500);
  await evaluate("(function(){ window.__dshWorktable.splitStore.setPaneMinimized('main',0,false); return true })()");
  await sleep(600);
  const sameEl = await evaluate("(function(){ var f=document.querySelector('iframe.dsh-wt_paneFrame'); return !!(f && f.__WT_EL__==='same' && f.contentWindow.__WT_MARKER__===42); })()");
  console.log((sameEl === true ? 'PASS' : 'FAIL') + ' [DOM元素同一性+标记] ' + JSON.stringify(sameEl));
  allOk = (sameEl === true) && allOk;

  console.log(allOk ? 'RESULT: ALL PASS' : 'RESULT: HAS FAILURES');
  try { proc.kill(); } catch {}
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR:', e && e.message); try { proc.kill(); } catch {}; process.exit(2); });
