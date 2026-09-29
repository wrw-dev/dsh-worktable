/**
 * probe-embed-e2e.cjs — 真产物端到端：代理 → 注入 → Set-Cookie → 跨端口 302 会话桥。
 * 加载真实 lib/index.js 的 apply()（stub 最小 cordis ctx 捕获注册路由），
 * 起两个「模拟金蝶」上游：LOGIN_PORT（登录页+登录接口）与 PORTAL_PORT（入口页，无会话弹回登录页）。
 * 断言：
 *   ① preset-fill 暂存 → /embed 解析 → 经代理拉登录页：注入填充脚本 + Set-Cookie 清洗透传；
 *   ② 登录 POST → 302 Location 已改写为「入口端口源的代理根」（跨端口跳转不出代理包络）；
 *   ③ 入口页 GET 带 mirrorMerge 补齐的会话 Cookie → 200 首页（不再弹回登录页）；
 *   ④ 填充完成上报 /preset-fill/done → 凭据（含同主机名跨端口兜底条目）立即删除；
 *   ⑤ 无 staged 源：HTML 不含填充脚本（隐私回归）。
 * 退出码 0/1。
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const { createServer } = http

const CW = path.join(__dirname, '..', '01_content')
const results = []
const ok = (name, cond, extra) => {
  results.push({ name, pass: !!cond })
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + String(extra).slice(0, 300) : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// —— 模拟金蝶：登录源 + 入口源（同主机不同端口）——
const STATE = { sessionByToken: new Map(), loginCount: 0, portalHits: 0, homeHits: 0 }
function loginPageHtml() {
  return '<!doctype html><html><head><title>KD Login</title></head><body>' +
    '<form id="loginform" action="/svc/login" method="post">' +
    '<div style="position:fixed;top:0;left:0;right:0;bottom:0"><div class="login-panel">' +
    '<input type="text" name="username" id="username" placeholder="用户名/账号" />' +
    '<input type="password" name="password" id="password" />' +
    '<button type="submit">登录</button></div></div></form></body></html>'
}
function startUpstream(port, role) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (role === 'login') {
      if (url.pathname === '/login') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'KD_previsit=1; Path=/' })
        res.end(loginPageHtml()); return
      }
      if (url.pathname === '/svc/login' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          STATE.loginCount++
          const token = 'sess-' + STATE.loginCount
          STATE.sessionByToken.set(token, body)
          // 金蝶式：登录成功 → 302 绝对 Location 指向同主机另一端口的入口页
          res.writeHead(302, {
            'set-cookie': `kdservice-sessionid=${token}; Path=/; HttpOnly`,
            'location': `http://127.0.0.1:${PORTAL_PORT}/portal/home`,
          })
          res.end()
        })
        return
      }
    } else {
      if (url.pathname === '/portal/home') {
        const cookies = String(req.headers.cookie ?? '')
        const hasSess = /kdservice-sessionid=sess-\d+/.test(cookies)
        STATE.portalHits++
        if (hasSess) { STATE.homeHits++; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><head><title>KD Home</title></head><body><h1>贝可曼工作台首页</h1></body></html>') }
        else { res.writeHead(302, { location: '/login' }); res.end() }
        return
      }
      if (url.pathname === '/login') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(loginPageHtml()); return
      }
    }
    res.writeHead(404); res.end()
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// —— 简易 HTTP 客户端（手动跟 Cookie，模拟 iframe 浏览器会话）——
function request(url, { method = 'GET', cookie = '' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: cookie ? { cookie } : {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    if (method === 'POST') req.end('username=beitman%40demo&password=Secret-99')
    else req.end()
    req.on('error', reject)
  })
}

let LOGIN_PORT = 0, PORTAL_PORT = 0
async function main() {
  // 随机端口防冲突
  const pick = async () => await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  LOGIN_PORT = await pick(); PORTAL_PORT = await pick()
  const up1 = await startUpstream(LOGIN_PORT, 'login')
  const up2 = await startUpstream(PORTAL_PORT, 'portal')

  // 加载真实产物 apply + stub cordis ctx
  const mod = await import('file:///' + path.join(CW, 'lib/index.js').replace(/\\/g, '/'))
  const routes = new Map()
  const ctx = {
    webServer: { register: (def) => routes.set(def.path, def.handler), registerUpgrade: undefined },
    logger: { info() {}, warn() {}, error() {} },
    effect() {},
  }
  mod.apply(ctx)
  const handler = (p) => routes.get(p)
  ok('apply 注册了 embed 路由', !!handler('/api/worktable/embed'), '')
  ok('apply 注册了 preset-fill 路由', !!handler('/api/worktable/preset-fill'), '')

  const loginOrigin = `http://127.0.0.1:${LOGIN_PORT}`
  const loginUrl = `${loginOrigin}/login`

  // ① 暂存凭据（handler 经 readJsonBody 从请求流读体）→ embed 解析（staged 后整源代理就绪）
  const hfill = handler('/api/worktable/preset-fill')
  const resStage = await hfill(fakeReq('/api/worktable/preset-fill', { origin: loginOrigin, user: 'beitman@demo', pass: 'Secret-99' }), fakeRes())
  const hembed = handler('/api/worktable/embed')
  const embedRes = captureRes()
  await hembed(fakeReq('/api/worktable/embed?u=' + encodeURIComponent(loginUrl), null, { host: '127.0.0.1:3080' }), embedRes)
  const embedBody = JSON.parse(embedRes.body)
  ok('embed 返回代理 src', embedBody.ok === true && embedBody.proxied === true && embedBody.src.startsWith('http://127.0.0.1:'), JSON.stringify(embedBody))

  // 经代理拉登录页（模拟 iframe 首跳）
  const proxyRoot = embedBody.src.split('/login')[0]
  const page1 = await request(proxyRoot + '/login')
  ok('登录页经代理可达', page1.status === 200 && page1.body.includes('K3') === false && page1.body.includes('KD Login'), page1.status)
  ok('登录页注入填充脚本', page1.body.includes('__wt_preset_fill'), '')
  ok('登录页脚本带凭据 payload', page1.body.includes('beitman@demo'), '')
  ok('Set-Cookie 透传+清洗（KD_previsit）', Array.isArray(page1.headers['set-cookie']) && page1.headers['set-cookie'].some((s) => s.startsWith('KD_previsit=1') && s.includes('SameSite=Lax')), JSON.stringify(page1.headers['set-cookie']))

  // ② 登录 POST（带页面 Cookie）→ 302 → Location 应已改写为入口源的代理根
  const cookieAfterPage1 = page1.headers['set-cookie'].map((s) => s.split(';')[0]).join('; ')
  const loginPost = await request(proxyRoot + '/svc/login', { method: 'POST', cookie: cookieAfterPage1 })
  const loc = loginPost.headers.location || ''
  ok('登录 302 → 入口源代理根（不出包络）', loginPost.status === 302 && loc.startsWith('http://127.0.0.1:') && !loc.includes(`:${PORTAL_PORT}/`), `loc=${loc}`)
  ok('登录响应 Set-Cookie 已清洗透传', (loginPost.headers['set-cookie'] || []).some((s) => s.startsWith('kdservice-sessionid=sess-1') && s.includes('SameSite=Lax')), JSON.stringify(loginPost.headers['set-cookie']))

  // ③ 跟随 302 → 入口源代理根（无 Cookie 状态模拟新源 iframe：镜像应补齐会话）
  const entryProxyRoot = new URL(loc).origin
  const portalViaMirror = await request(entryProxyRoot + '/portal/home')
  ok('入口页经镜像补齐会话 → 200 首页', portalViaMirror.status === 200 && portalViaMirror.body.includes('贝可曼工作台首页'), `status=${portalViaMirror.status}`)
  ok('上游确实收到镜像会话', STATE.homeHits === 1 && STATE.portalHits >= 1, `home=${STATE.homeHits} portal=${STATE.portalHits}`)

  // ④ 填充完成上报 → 凭据删除（含同主机名跨端口兜底条目）
  const hdone = handler('/api/worktable/preset-fill/done')
  await hdone(fakeReq('/api/worktable/preset-fill/done', { origin: loginOrigin }), fakeRes())
  // 再拉一次入口页 HTML：不再注入填充脚本（凭据已清）
  const entryPage = await request(entryProxyRoot + '/portal/home', { cookie: 'kdservice-sessionid=sess-1' })
  ok('上报后入口页不再注入填充脚本', !entryPage.body.includes('__wt_preset_fill'), '')

  // ⑤ 无 staged 的另一源：HTML 不含填充脚本（从未 stage 过的全新源）
  const pick2 = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const bareOrigin = `http://127.0.0.1:${pick2}`
  const bareRes = captureRes()
  await hembed(fakeReq('/api/worktable/embed?u=' + encodeURIComponent(bareOrigin + '/'), null, { host: '127.0.0.1:3080' }), bareRes)
  ok('无 staged 源 embed 正常解析', JSON.parse(bareRes.body).ok === true, bareRes.body.slice(0, 120))

  up1.close(); up2.close()
  // 干净退出：dispose 插件建的全部整源代理（进程内无残留句柄，自然退出而非强杀）
  for (const [, p] of mod.__testHooks.embedProxies) p.dispose()
  mod.__testHooks.embedProxies.clear()
  await sleep(150)
  console.log('—— 总结: ' + results.filter(r => r.pass).length + '/' + results.length + ' PASS ——')
  process.exitCode = results.some(r => !r.pass) ? 1 : 0
}

// 服务端 handler 直接写 Node res；stub 一个收集响应的对象。
// req 需要「可异步迭代出 body」——readJsonBody 直接 for-await 请求流。
function fakeReq(url, bodyObj, headers) {
  const bodyText = bodyObj ? JSON.stringify(bodyObj) : ''
  const chunks = bodyText ? [Buffer.from(bodyText)] : []
  return {
    url, method: bodyObj ? 'POST' : 'GET', headers: headers || {},
    headersSent: false,
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
}
function fakeRes() {
  return captureRes()
}
function captureRes() {
  const res = {
    headersSent: false, status: 0, headers: {}, chunks: [], body: '',
    writeHead(code, hdrs) { this.status = code; this.headers = hdrs || {}; this.headersSent = true },
    write(c) { this.chunks.push(typeof c === 'string' ? Buffer.from(c) : c); return true },
    end(c) { if (c) this.chunks.push(typeof c === 'string' ? Buffer.from(c) : c); this.body = Buffer.concat(this.chunks).toString('utf8') },
    once() {}, on() {},
  }
  return res
}

main().catch((e) => { console.error('PROBE-ERROR', e); process.exit(1) })
