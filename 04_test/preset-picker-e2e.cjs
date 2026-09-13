// preset-picker-e2e.cjs — 预置资源「本地资源路径」浏览弹窗端到端验证
// 路径：侧栏工作区卡 → 打开分栏 → 空内容窗格选择器点 📌 预置 → 新增条目 → 本地资源路径
//       → 📂 弹窗导航/选文件/选目录回填 → 手填仍可用。产物 04_test\out\preset-picker-*.png
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9363;
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 独立临时目录作为浏览目标（含一个文件 + 一个子目录）
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wt-picker-'));
fs.writeFileSync(path.join(TMP, 'readme.md'), '# demo file');
fs.mkdirSync(path.join(TMP, 'subdir'));
const MODAL = '.dsh-wt_pathPicker';

const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(require('os').tmpdir(), 'wt-chrome-picker-e2e2'),
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
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const b64 = r && ((r.result && r.result.data) || r.data);
    if (!b64) { console.log('SHOT-FAIL', name, JSON.stringify(r && r.error || r).slice(0, 200)); return false; }
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1000) { console.log('SHOT-FAIL(tiny)', name, buf.length); return false; }
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log('SHOT', name, buf.length);
    return true;
  };

  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  await sleep(3000);

  // 1) 编程入口：splitStore.open 布局 + 首窗直接放预置面板（真实用户路径 = 侧栏布局卡 →
  //    空窗格磁贴 → 📌 预置；此处经调试出口 __dshWorktable 等价直达，绕开会话绑定态依赖）
  const ws1 = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const wt = window.__dshWorktable;
    if (!wt || !wt.splitStore) return { ok: false, why: 'no-debug-exit' };
    const okOpen = wt.splitStore.open({
      id: 'layout-e2e', title: 'E2E测试',
      left: null, top: null,
      main: [{ id: 'p1', title: '窗口1', min: 200, content: { kind: 'builtin', type: 'presets' } }],
      leftWidth: { default: 260, min: 160, max: 480 },
      chatWidth: { default: 360, min: 240, max: 600 },
      topHeight: { default: 200, min: 120, max: 480 },
      chatSide: 'right', chatFullHeight: false,
    });
    await sleep(1500);
    return { ok: !!okOpen, active: wt.splitStore.active, hasPresets: !!document.querySelector('.dsh-wt_presets, [class*="preset"]') };
  })()`);
  console.log('WS', JSON.stringify(ws1));

  // 2) 预置面板已直达（窗格 content=presets）——确认面板挂载
  const preset = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) {
      const add = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().includes('新增条目'));
      if (add) return { ok: true };
      await sleep(600);
    }
    return { ok: false, why: 'no-add-btn' };
  })()`);
  console.log('PRESET', JSON.stringify(preset));
  await shot('preset-picker-2-presets.png');

  // 3) 新增条目 → 切「本地资源路径」类型
  const form = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const findBtn = (text) => [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().includes(text));
    for (let i = 0; i < 10; i++) { const b = findBtn('新增条目'); if (b) { b.click(); break; } await sleep(500); }
    await sleep(600);
    const dirBtn = findBtn('本地资源路径');
    if (dirBtn) dirBtn.click();
    await sleep(400);
    return {
      formShown: !!document.querySelector('.dsh-wt_presetForm'),
      browseBtn: !!document.querySelector('.dsh-wt_presetBrowse'),
    };
  })()`);
  console.log('FORM', JSON.stringify(form));
  await shot('preset-picker-3-form.png');

  // 4) 点 📂 → 弹窗出现（初始=服务端默认目录）——验证 portal 置顶 + 盘符条
  const modal1 = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('.dsh-wt_presetBrowse').click();
    await sleep(1500);
    const m = document.querySelector('${MODAL}');
    if (!m) return { shown: false };
    const inBody = m.parentElement === document.body;
    const z = getComputedStyle(m).zIndex;
    const rect = m.getBoundingClientRect();
    // 元素从中心点取顶层元素，确认弹窗确实压在最上面（不被遮挡）
    const onTop = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(Math.max(rect.top, 0) + Math.min(rect.height / 2, 200))
    ) === m || !!(document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(Math.max(rect.top, 0) + Math.min(rect.height / 2, 200))
    ) || {}).closest?.('${MODAL}');
    return {
      shown: true,
      portalToBody: inBody,
      zIndex: z,
      onTop,
      title: (m.querySelector('.dsh-wt_pathPickerTitle')||{}).textContent,
      drives: [...m.querySelectorAll('.dsh-wt_pathPickerDrive')].map(b => b.textContent),
      rows: m.querySelectorAll('.dsh-wt_subRow').length,
      cwd: (m.querySelector('.dsh-wt_pathPickerCwd')||{}).textContent,
    };
  })()`);
  console.log('MODAL1', JSON.stringify(modal1));
  await shot('preset-picker-4-modal.png');

  // 4b) 点盘符 C → cwd 切到 C:\\（盘符高亮应落在 C）
  const driveClick = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = document.querySelector('${MODAL}');
    if (!m) return { ok: false, why: 'no-modal' };
    const c = [...m.querySelectorAll('.dsh-wt_pathPickerDrive')].find(b => b.textContent.trim() === 'C');
    if (!c) return { ok: false, why: 'no-C-drive' };
    c.click();
    await sleep(1500);
    const m2 = document.querySelector('${MODAL}');
    const on = (m2.querySelector('.dsh-wt_pathPickerDrive.on')||{}).textContent;
    return { ok: true, cwd: (m2.querySelector('.dsh-wt_pathPickerCwd')||{}).textContent, activeDrive: on, rows: m2.querySelectorAll('.dsh-wt_subRow').length };
  })()`);
  console.log('DRIVE', JSON.stringify(driveClick));
  await shot('preset-picker-4b-drive.png');

  // 5) 面包屑「默认」→ 关闭弹窗 → 手填文件路径（手填入口仍在）
  const manual = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('${MODAL} .dsh-wt_presetBack').click();
    await sleep(300);
    const input = document.querySelector('.dsh-wt_presetForm .dsh-wt_customPathInput[spellcheck="false"]');
    if (!input) return { manualOk: false, why: 'no-input' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(path.win32.join(TMP, 'readme.md'))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(800);
    return { manualOk: true, val: input.value };
  })()`);
  console.log('MANUAL', JSON.stringify(manual));
  await shot('preset-picker-5-manual.png');

  // 6) 重开弹窗：initial=已填文件路径 → 服务端落父目录 → 列表应含 readme.md / subdir
  const modal2 = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('.dsh-wt_presetBrowse').click();
    await sleep(1800);
    const m = document.querySelector('${MODAL}');
    if (!m) return { shown: false };
    const rows = [...m.querySelectorAll('.dsh-wt_subRow')].map(r => (r.querySelector('.dsh-wt_subName')||{}).textContent);
    return { shown: true, cwd: (m.querySelector('.dsh-wt_pathPickerCwd')||{}).textContent, rows: rows.slice(0, 10) };
  })()`);
  console.log('MODAL2', JSON.stringify(modal2));
  await shot('preset-picker-6-modal-initial.png');

  // 7) 点 subdir 行进入 → 「选择当前目录」→ 回填 + 弹窗关闭
  const picked = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m0 = document.querySelector('${MODAL}');
    if (!m0) return { ok: false, why: 'modal-closed' };
    const rowSub = [...m0.querySelectorAll('.dsh-wt_subRow')].find(r => (r.textContent||'').includes('subdir'));
    if (!rowSub) return { ok: false, why: 'no-subdir-row' };
    rowSub.click();
    await sleep(1200);
    const m = document.querySelector('${MODAL}');
    const cwd = (m.querySelector('.dsh-wt_pathPickerCwd')||{}).textContent;
    m.querySelector('.dsh-wt_pathPickerBtns .dsh-wt_presetBtnPrimary').click();
    await sleep(700);
    const input = document.querySelector('.dsh-wt_presetForm .dsh-wt_customPathInput[spellcheck="false"]');
    return { ok: true, cwdAfterNav: cwd, modalClosed: !document.querySelector('${MODAL}'), inputVal: input ? input.value : null };
  })()`);
  console.log('PICKED', JSON.stringify(picked));
  await shot('preset-picker-7-picked.png');

  // 8) 文件选择路径：输入框设回 TMP 根 → 开弹窗（落根目录）→ 点 readme.md 行 → 直接回填文件路径
  const pickedFile = await ev(`(async function(){
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const input0 = document.querySelector('.dsh-wt_presetForm .dsh-wt_customPathInput[spellcheck="false"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input0, ${JSON.stringify(TMP)});
    input0.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    document.querySelector('.dsh-wt_presetBrowse').click();
    await sleep(1500);
    const m = document.querySelector('${MODAL}');
    if (!m) return { ok: false, why: 'modal-not-shown' };
    const rowFile = [...m.querySelectorAll('.dsh-wt_subRow')].find(r => (r.textContent||'').includes('readme.md'));
    if (!rowFile) return { ok: false, why: 'no-file-row', rows: [...m.querySelectorAll('.dsh-wt_subRow')].map(r => (r.querySelector('.dsh-wt_subName')||{}).textContent) };
    rowFile.click();
    await sleep(600);
    const input = document.querySelector('.dsh-wt_presetForm .dsh-wt_customPathInput[spellcheck="false"]');
    return { ok: true, modalClosed: !document.querySelector('${MODAL}'), inputVal: input ? input.value : null };
  })()`);
  console.log('PICKEDFILE', JSON.stringify(pickedFile));
  await shot('preset-picker-8-picked-file.png');

  console.log('TMPDIR', TMP);
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
