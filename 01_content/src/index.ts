import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { readdirSync, realpathSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve as pathResolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * dsh-worktable 服务端：健康路由 + 工作区内容窗的数据路由。
 * 参考 dsh-better-sidebar 的架构——内容窗能力由本插件自己的服务端路由提供：
 *   - POST /api/worktable/fs     目录列表（资源管理器窗）
 *   - POST /api/worktable/git    git 状态（源代码管理窗）
 *   - WS   /api/worktable/term   node-pty 终端流（终端窗；依赖宿主 node_modules 中的
 *                                node-pty 与 ws，缺失时该路由不注册、终端窗降级提示）
 */

declare const __WT_VERSION__: string
const PLUGIN_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

export const name = 'dsh-worktable'
export const inject = ['webServer', 'sessions']

export const HEALTH_PATH = '/api/worktable/health'

const MAX_ENTRIES = 500

/** 本地文件/站点静态资源的 MIME 映射（file 与 site 两条路由共用） */
const FILE_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
}

const SITE_PREFIX = '/api/worktable/site'

// ── 整源反向代理（浏览器窗嵌入外部站点用）──────────────────────────────
// 背景：外部站点的 X-Frame-Options / CSP frame-ancestors / Chrome PNA（loopback 页
// 面访问内网地址被拦）都禁止宿主页面直接 iframe 它们。解法 = 本插件在 127.0.0.1
// 起一个整源反向代理：loopback→loopback 无嵌入限制；Node 侧转发请求并剥掉限制头。
// 每个目标源一个监听端口（根挂载，页面内相对路径/Cookie/重定向自然工作）。
const EMBED_PREFIX = '/api/worktable/embed'
/** 响应中禁止透传的嵌入限制头（大小写不敏感，逐一下列名单匹配） */
const EMBED_STRIP_RES_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'report-to',
  'reporting-endpoints',
  'permissions-policy',
  'content-encoding', // Node fetch 已自动解压，透传 gzip 头会让浏览器二次解压失败
  'content-length',   // 头部重写后长度必变，交给 Node 自算
])
/** 请求中不转发的逐跳/会话绑定头 */
const EMBED_STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'origin', 'referer', 'cookie', // 三者按目标源重建，见下方
])
/** Set-Cookie 清洗：去 Domain/Secure；SameSite 未显式为 none 时改 Lax（127.0.0.1 同源携带） */
function embedRewriteSetCookie(sc: string): string {
  return sc.split(';').filter((part) => {
    const k = part.split('=')[0].trim().toLowerCase()
    return k !== 'domain' && k !== 'secure' && k !== 'samesite'
  }).join(';') + '; SameSite=Lax'
}

/** 注入导航上报脚本：iframe 内页面发生导航（链接跳转 / pushState / popstate / hash 变化）
 *  时，把「真实目标地址」postMessage 给父页面，让工作台浏览器窗的地址栏与前进后退历史同步。
 *  用 `*` 跨源发送（iframe 代理源 127.0.0.1:<port> 与父页面不同源，必须跨源）。
 *  目标源（原始 URL origin）在注入时写死，脚本把代理路径拼回真实地址上报。
 *  另拦截 target=_blank/_new 链接与 window.open：不再新开浏览器窗口，改为在当前窗内导航，
 *  并向上报（同目标源走当前代理；跨源则交给父页面起新代理）。 */
function injectNavNotifyScript(html: string, targetOrigin: string): string {
  const originJson = JSON.stringify(targetOrigin)
  const script =
    '<script>(function(){var O=' + originJson + ';' +
    'function r(){try{var p=location.pathname+location.search+location.hash;parent.postMessage({__wt_nav:true,url:O+p},"*")}catch(e){}}' +
    'window.addEventListener("load",r);window.addEventListener("popstate",r);window.addEventListener("hashchange",r);' +
    'try{var a=history.pushState,b=history.replaceState;history.pushState=function(){var x=a.apply(this,arguments);r();return x};history.replaceState=function(){var x=b.apply(this,arguments);r();return x}}catch(e){}' +
    // 拦截开新窗的链接/弹窗：改为当前窗导航（同源相对跳转走当前代理；跨源交父页面起新代理）
    'function navTo(href){try{var u=new URL(href,location.href);if(u.protocol!=="http:"&&u.protocol!=="https:")return;' +
    'if(u.origin===location.origin){if(u.href!==location.href)location.href=u.href;return;}' +
    'parent.postMessage({__wt_nav:true,url:u.href,kind:"nav"},"*")}catch(e){}}' +
    'try{document.addEventListener("click",function(ev){var el=ev.target&&ev.target.closest?ev.target.closest("a[href]"):null;if(!el)return;' +
    'var t=(el.getAttribute("target")||"").toLowerCase();if(t!=="_blank"&&t!=="_new")return;ev.preventDefault();navTo(el.getAttribute("href"))},true)}catch(e){}' +
    'try{var _o=window.open;window.open=function(u){try{if(u)navTo(u)}catch(e){}return null}}catch(e){}' +
    'r()' +
    '})()<\/script>'
  const i = html.toLowerCase().indexOf('</head>')
  return i >= 0 ? html.slice(0, i) + script + html.slice(i) : script + html
}

interface EmbedProxy {
  target: string          // 目标源（含协议，origin + 可选端口，如 http://192.168.1.193）
  server: any             // node:http Server
  port: number
  lastUsed: number
  dispose: () => void
}
const embedProxies = new Map<string, EmbedProxy>()
const EMBED_PROXY_MAX = 8      // LRU 上限：够用（8 个并发站点窗）且不滥用端口
const EMBED_PROXY_IDLE_MS = 60 * 60 * 1000

/** 转发浏览器（iframe 内页面）请求到目标源 */
async function embedForward(clientReq: any, clientRes: any, targetOrigin: string) {
  const u = new URL(clientReq.url ?? '/', targetOrigin)
  const inHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(clientReq.headers)) {
    if (EMBED_STRIP_REQ_HEADERS.has(k.toLowerCase())) continue
    if (v !== undefined) inHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  inHeaders.referer = targetOrigin + '/'
  const cookieHeader = clientReq.headers.cookie
  if (typeof cookieHeader === 'string' && cookieHeader) inHeaders.cookie = cookieHeader
  const init: any = { method: clientReq.method, headers: inHeaders, redirect: 'manual', signal: AbortSignal.timeout(30000) }
  if (clientReq.method !== 'GET' && clientReq.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const c of clientReq) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
    if (chunks.length) init.body = Buffer.concat(chunks)
  }
  let upstream: any = null
  try {
    upstream = await fetch(u.href, init)
  } catch (err) {
    // 内网穿透/弱网瞬时抖动（首连 DNS/隧道冷启动慢）：静默重试一次（新连接）
    try {
      init.signal = AbortSignal.timeout(30000)
      upstream = await fetch(u.href, init)
    } catch (err2) {
      const cause = (err2 as any)?.cause?.code ?? (err2 as any)?.cause?.message ?? String(err2)
      if (!clientRes.headersSent) clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '2' })
      clientRes.end('[worktable embed] upstream fetch failed: ' + cause + '（已自动重试一次；目标可能瞬时不可达，请刷新重试）')
      return
    }
  }
  const outHeaders: Record<string, any> = {}
  let setCookies: string[] | undefined
  // 注意：fetch 返回的 Headers 是类实例，Object.entries 拿不到条目，必须用 forEach；
  // 多条 set-cookie 用 getSetCookie() 单独取（forEach 会把它们合并成一个字符串丢条目）
  upstream.headers.forEach((v: string, k: string) => {
    const lk = k.toLowerCase()
    if (lk === 'set-cookie') return
    if (EMBED_STRIP_RES_HEADERS.has(lk)) return
    outHeaders[k] = v
  })
  if (typeof (upstream.headers as any).getSetCookie === 'function') {
    setCookies = ((upstream.headers as any).getSetCookie() as string[]).map(embedRewriteSetCookie)
  }
  // 重定向指回代理自身（保持整源体验，浏览器地址栏始终 127.0.0.1）
  const loc = upstream.headers.get('location')
  if (loc && upstream.status >= 300 && upstream.status < 400) {
    try { outHeaders.location = new URL(loc, u.href).href.replace(targetOrigin, `http://127.0.0.1:${(clientReq as any).__embedPort}`) } catch {}
  }
  if (setCookies) (outHeaders as any)['set-cookie'] = setCookies
  clientRes.writeHead(upstream.status, outHeaders)
  if (upstream.body) {
    const contentType = String(outHeaders['content-type'] ?? '')
    const isHtml = contentType.toLowerCase().includes('text/html')
    const reader = (upstream.body as any).getReader()
    try {
      // HTML 响应：缓冲拼接后在 </head> 前注入导航上报脚本，else 流式直写
      if (isHtml) {
        const chunks: Uint8Array[] = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const html = Buffer.concat(chunks as any).toString('utf8')
        const out = injectNavNotifyScript(html, targetOrigin)
        if (!clientRes.write(out, 'utf8')) await new Promise<void>((r) => clientRes.once('drain', r))
      } else {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!clientRes.write(value)) await new Promise<void>((r) => clientRes.once('drain', r))
        }
      }
    } finally { try { reader.releaseLock() } catch {} }
  }
  clientRes.end()
}

/** 取/懒建一个目标源的整源代理；返回该源的代理根 URL（http://127.0.0.1:<port>） */
function ensureEmbedProxy(ctx: Context, targetOrigin: string): Promise<string> {
  const key = targetOrigin.replace(/\/+$/, '')
  const existing = embedProxies.get(key)
  if (existing) {
    existing.lastUsed = Date.now()
    return Promise.resolve(`http://127.0.0.1:${existing.port}`)
  }
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const ep = embedProxies.get(key)
      if (ep) { ep.lastUsed = Date.now(); (req as any).__embedPort = ep.port }
      embedForward(req, res, key).catch(() => { try { res.end() } catch {} })
    })
    server.on('error', (err: any) => {
      embedProxies.delete(key)
      reject(err)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr: any = server.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      if (!port) { server.close(); reject(new Error('no port')); return }
      const entry: EmbedProxy = {
        target: key, server, port, lastUsed: Date.now(),
        dispose: () => { try { server.close() } catch {} },
      }
      embedProxies.set(key, entry)
      ctx.effect(() => entry.dispose, 'dsh-worktable: embed proxy server')
      // 惰性清扫：借每次新建代理的时机做 LRU 淘汰 + 空闲回收（不常驻定时器）
      sweepEmbedProxies()
      resolvePromise(`http://127.0.0.1:${port}`)
    })
  })
}

function sweepEmbedProxies() {
  const now = Date.now()
  for (const [k, p] of embedProxies) {
    if (now - p.lastUsed > EMBED_PROXY_IDLE_MS) { p.dispose(); embedProxies.delete(k) }
  }
  while (embedProxies.size > EMBED_PROXY_MAX) {
    let oldest: string | null = null
    let oldestT = Infinity
    for (const [k2, p2] of embedProxies) if (p2.lastUsed < oldestT) { oldest = k2; oldestT = p2.lastUsed }
    if (!oldest) break
    const victim = embedProxies.get(oldest)
    victim?.dispose()
    embedProxies.delete(oldest)
  }
}

/** 目标 URL 归一为 origin（scheme://host[:port]，去掉路径） */
function originOf(u: string): string | null {
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch { return null }
}

// 原生皮肤模板（esbuild text loader 嵌入；/api/worktable/template 路由直接下发）
// @ts-ignore
import dshellCss from '../template/dshell.css'
// @ts-ignore
import dshellHtml from '../template/dshell.html'
const TEMPLATE_PREFIX = '/api/worktable/template'

/**
 * 从本插件模块位置向祖先方向查找并加载 node_modules 包（如 ws / node-pty）。
 * 本包经 junction 链接进 profile，普通 import 可能解析不到 profile 级依赖；
 * 同时尝试 junction 路径与 realpath 两条祖先链。
 */
function loadPkg(pkg: string): any | null {
  const starts = new Set<string>()
  try { starts.add(dirname(fileURLToPath(import.meta.url))) } catch {}
  try { starts.add(realpathSync(dirname(fileURLToPath(import.meta.url)))) } catch {}
  for (const start of starts) {
    let dir: string | null = start
    while (dir && dir !== pathResolve(dir, '..')) {
      try {
        const req = createRequire(pathToFileURL(pathResolve(dir, '__wt_probe__.js')).href)
        return req(pkg)
      } catch {}
      dir = pathResolve(dir, '..')
    }
  }
  // 兜底：DSH 标准目录 ~/.dsh/profiles/*/node_modules（宿主按 realpath 加载时前两条链都找不到）
  try {
    const profilesDir = pathResolve(homedir(), '.dsh', 'profiles')
    for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!profile.isDirectory() && !profile.isSymbolicLink()) continue
      const nm = pathResolve(profilesDir, profile.name, 'node_modules')
      try {
        const req = createRequire(pathToFileURL(pathResolve(nm, '__wt_probe__.js')).href)
        return req(pkg)
      } catch {}
    }
  } catch {}
  return null
}

/** 解析会话工作目录：服务端 header.cwd 优先，其次客户端传入 cwd，最后进程 cwd */
function serverCwd(ctx: any, sessionId?: string, clientCwd?: string): string {
  if (sessionId) {
    try {
      const headerCwd = ctx.sessions?.get?.(sessionId)?.header?.cwd
      if (typeof headerCwd === 'string' && headerCwd) return headerCwd
    } catch {}
  }
  if (typeof clientCwd === 'string' && clientCwd) return clientCwd
  return process.cwd()
}

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}

/** 列出一个目录层级（目录在前、大小写不敏感排序、上限 500、隐藏项标注） */
async function listDirectory(path: string) {
  const abs = pathResolve(path)
  const dirents = await readdir(abs, { withFileTypes: true })
  const entries = dirents
    .map((d) => ({ name: d.name, path: abs + sep + d.name, isDir: d.isDirectory(), hidden: d.name.startsWith('.') }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  const truncated = entries.length > MAX_ENTRIES
  return { path: abs, entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated }
}

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolvePromise(stdout)
    })
  })
}

/** git 状态快照（porcelain v1 -z；非仓库返回 isRepo:false） */
async function gitStatus(cwd: string) {
  try {
    const branchRaw = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const porcelain = await gitExec(['status', '--porcelain=v1', '-z'], cwd)
    const entries = porcelain
      .split('\0')
      .filter((s) => s.length > 2)
      .map((s) => ({ xy: s.slice(0, 2), path: s.slice(3) }))
    return { isRepo: true, branch: branchRaw.trim() || 'HEAD', entries }
  } catch {
    return { isRepo: false, branch: undefined, entries: [] }
  }
}

/** 终端 WebSocket 升级路由（同步注册 + ctx.effect，同 better-sidebar；node-pty 缺失时不注册） */
function setupTerminal(webServer: any, ctx: any) {
  if (typeof webServer.registerUpgrade !== 'function') return
  const wsMod = loadPkg('ws')
  const ptyMod = loadPkg('node-pty')
  ctx.logger?.info?.('[dsh-worktable] term deps: ws=' + (wsMod ? 'ok' : 'MISSING') + ' node-pty=' + (ptyMod ? 'ok' : 'MISSING'))
  if (!wsMod || !ptyMod) {
    ctx.logger?.warn('[dsh-worktable] 终端路由未注册：ws/node-pty 不可用')
    return
  }
  const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default?.WebSocketServer
  if (!WebSocketServer) return
  const pty = ptyMod.default ?? ptyMod
  const wss = new WebSocketServer({ noServer: true })
  const spawnShell = (): { cmd: string; args: string[] } =>
    process.platform === 'win32'
      ? { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] } // -NoProfile：跳过用户配置（oh-my-posh 花哨提示符在 xterm 里是乱码，PSReadLine 长输入行不换行被截断）
      : { cmd: process.env.SHELL || '/bin/bash', args: [] }
  const clampDim = (v: number, fallback: number) => Math.min(1024, Math.max(2, Number.isFinite(v) ? v : fallback))

  ctx.effect(() => webServer.registerUpgrade({
    path: '/api/worktable/term',
    handler: (req: any, socket: any, head: any) => {
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        const u = new URL(req.url ?? '/', 'http://dsh.internal')
        const cwd = serverCwd(ctx, u.searchParams.get('sessionId') || undefined, u.searchParams.get('cwd') || undefined)
        const cols = clampDim(Number(u.searchParams.get('cols')), 80)
        const rows = clampDim(Number(u.searchParams.get('rows')), 24)
        let term: any = null
        try {
          const shell = spawnShell()
          term = pty.spawn(shell.cmd, shell.args, { name: 'xterm-256color', cols, rows, cwd, env: process.env })
        } catch (err) {
          try { ws.send('\r\n[worktable] 终端启动失败：' + String(err)) } catch {}
          try { ws.close() } catch {}
          return
        }
        term.onData((d: string) => { try { ws.send(d) } catch {} })
        term.onExit(() => { try { ws.close() } catch {} })
        ws.on('message', (raw: any) => {
          const text = String(raw)
          try {
            const msg = JSON.parse(text)
            if (msg && msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
              term.resize(clampDim(msg.cols, cols), clampDim(msg.rows, rows))
              return
            }
          } catch {}
          try { term.write(text) } catch {}
        })
        ws.on('close', () => { try { term.kill() } catch {} })
      })
    },
  }), 'dsh-worktable: terminal upgrade')
}

export function apply(ctx: Context) {
  const webServer = (ctx as any).webServer
  if (!webServer) {
    ctx.logger?.warn('[dsh-worktable] ctx.webServer 不可用（headless profile？），跳过服务端路由')
    return
  }

  webServer.register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (_req: any, res: any) => {
      json(res, 200, { plugin: 'dsh-worktable', version: PLUGIN_VERSION, ok: true })
    },
  })

  // 本地文件读取（资源管理器点击 .html 后浏览器标签内打开）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/file',
    handler: async (req: any, res: any) => {
      try {
        const u = new URL(req.url ?? '/', 'http://dsh.internal')
        const p = u.searchParams.get('path') || ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        const abs = pathResolve(p)
        const stat = await import('node:fs/promises').then((m) => m.stat(abs))
        if (stat.size > 20 * 1024 * 1024) { json(res, 413, { error: 'file too large' }); return }
        const data = await readFile(abs)
        const ext = (abs.split('.').pop() || '').toLowerCase()
        const types: Record<string, string> = {
          html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
          css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
          json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
          pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
        }
        res.writeHead(200, { 'content-type': FILE_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  // 本地站点（目录级静态托管）：点开 index.html 时挂载整个所在目录，
  // 让 ./assets/... 等相对引用正常解析（前缀路由，余下路径 = <rootToken>/<相对路径>）。
  // 原生皮肤模板：HTML 骨架 + 设计系统样式表（随插件分发，主题自动适配）
  webServer.register({
    kind: 'prefix',
    path: TEMPLATE_PREFIX,
    handler: (req: any, res: any) => {
      try {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const rel = pathname.slice(TEMPLATE_PREFIX.length)
        if (rel === '/dshell.css') {
          res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
          res.end(dshellCss)
        } else {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(dshellHtml)
        }
      } catch (err) {
        res.writeHead(404); res.end(String(err))
      }
    },
  })

  webServer.register({
    kind: 'prefix',
    path: SITE_PREFIX,
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const segs = pathname.slice(SITE_PREFIX.length).split('/').filter(Boolean)
        const rootToken = decodeURIComponent(segs.shift() ?? '')
        const rel = segs.map((s) => { try { return decodeURIComponent(s) } catch { return s } }).join('/')
        if (!rootToken) { json(res, 400, { error: 'missing root' }); return }
        const root = pathResolve(rootToken)
        let abs = pathResolve(root, rel)
        if (abs !== root && !abs.startsWith(root + sep)) { json(res, 403, { error: 'outside root' }); return }
        const statMod = await import('node:fs/promises')
        let info = await statMod.stat(abs).catch(() => null)
        if (info && info.isDirectory()) {
          abs = pathResolve(abs, 'index.html')
          info = await statMod.stat(abs).catch(() => null)
        }
        if (!info || !info.isFile()) { json(res, 404, { error: 'not found' }); return }
        if (info.size > 40 * 1024 * 1024) { json(res, 413, { error: 'file too large' }); return }
        const data = await readFile(abs)
        const ext = (abs.split('.').pop() || '').toLowerCase()
        res.writeHead(200, { 'content-type': FILE_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  // 浏览器窗嵌入外部站点：/api/worktable/embed?u=<完整URL>
  // 返回 { ok, src } —— src = 可直接作为 iframe src 的地址（127.0.0.1 整源代理根 + 原路径）。
  // 目标不可达/非法时 ok:false + fallback=原 URL，客户端回退直连（让浏览器原生报错）。
  webServer.register({
    kind: 'exact',
    path: EMBED_PREFIX,
    handler: async (req: any, res: any) => {
      const started = Date.now()
      try {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const u = new URL(req.url ?? '/', 'http://dsh.internal')
        const target = u.searchParams.get('u') || ''
        const origin = originOf(target)
        if (!origin) { json(res, 400, { ok: false, error: 'bad url', fallback: target }); return }
        const parsed = new URL(target)
        // 宿主自身 origin（如 http://127.0.0.1:3080）：直连（作为浏览器窗输入若指到宿主会递归 iframe）
        // 注意：|| 与 && 混用需加括号分组，否则 ('localhost'||...) 恒真导致所有 loopback 都被判为真 → 都不走代理
        const hostHeader = String(req.headers?.host ?? '')
        const isSelf = (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1')
          && origin === (hostHeader.includes(':') ? 'http://' + hostHeader : 'http://' + hostHeader + ':80')
        if (isSelf) {
          json(res, 200, { ok: true, src: target, proxied: false })
          return
        }
        // 其余（含 loopback 本地服务）统一走整源代理：可剥 XFO/CSP 限制并注入导航上报脚本，
        // 让页面内导航（链接跳转/pushState/popstate）同步到工作台地址栏与前进后退。
        const proxyRoot = await ensureEmbedProxy(ctx, origin)
        json(res, 200, { ok: true, src: proxyRoot + parsed.pathname + parsed.search, proxied: true, ms: Date.now() - started })
      } catch (err) {
        json(res, 200, { ok: false, error: String(err), fallback: (new URL(req.url ?? '/', 'http://dsh.internal')).searchParams.get('u') || '' })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/fs',
    handler: async (req: any, res: any) => {
      try {
        const body = await readJsonBody(req)
        const path = typeof body.path === 'string' && body.path
          ? body.path
          : serverCwd(ctx, body.sessionId, body.cwd)
        json(res, 200, await listDirectory(path))
      } catch (err) {
        json(res, 500, { path: '', entries: [], truncated: false, error: String(err) })
      }
    },
  })

  // 工作区列表（自定义窗口会话分组用）：读宿主 ~/.dsh/storages/workspace.json（只读）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/workspaces',
    handler: async (_req: any, res: any) => {
      try {
        const file = pathResolve(homedir(), '.dsh', 'storages', 'workspace.json')
        const raw = await readFile(file, 'utf8')
        // 容忍 BOM（外部工具改写可能带 EF BB BF，JSON.parse 会抛错）
        json(res, 200, JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw))
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  // 本地文件写入（MD 编辑模式保存回磁盘）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/write',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readJsonBody(req)
        const p = typeof body.path === 'string' ? body.path : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        if (content.length > 20 * 1024 * 1024) { json(res, 413, { error: 'content too large' }); return }
        const abs = pathResolve(p)
        await import('node:fs/promises').then((m) => m.writeFile(abs, content, 'utf8'))
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
    },
  })

  // 新建分组：创建目录（仅当父目录已存在，避免递归误建深层垃圾目录）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/mkdir',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readJsonBody(req)
        const p = typeof body.path === 'string' ? body.path.trim() : ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        const abs = pathResolve(p)
        const fsx = await import('node:fs/promises')
        const parent = dirname(abs)
        try { await fsx.access(parent) } catch { json(res, 400, { error: 'parent not found' }); return }
        await fsx.mkdir(abs)
        json(res, 200, { ok: true, path: abs })
      } catch (err: any) {
        json(res, err?.code === 'EEXIST' ? 200 : 500, err?.code === 'EEXIST' ? { ok: true, exists: true } : { error: String(err) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/git',
    handler: async (req: any, res: any) => {
      const body = await readJsonBody(req)
      const cwd = serverCwd(ctx, body.sessionId, body.cwd)
      json(res, 200, await gitStatus(cwd))
    },
  })

  setupTerminal(webServer, ctx)
}
