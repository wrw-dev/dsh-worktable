/**
 * probe-preset-fill-server.cjs — 预置填充修复（2026-09）服务端回归探针：
 * 经 esbuild CLI 打桩 bundle（harness 只 re-export 内部函数）加载真实源码逻辑，断言：
 *   ① 注入器：无 staged → 只注入导航上报，不含填充脚本（隐私回归）；
 *   ② 填充脚本结构（源码常量）：矩形可见性/祖链扫描/用户名回退配对/写入策略/30s 补填/上报握手；
 *   ③ embedRewriteSetCookie 行为不回归；
 *   ④ Cookie 镜像（mirrorCapture/mirrorMerge/mirrorHostOf）：捕获→补齐→同名不覆盖→按主机名隔离。
 * 跑完打印 PASS/FAIL 摘要，退出码 0/1。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { Module } = require('module')

const CW = path.join(__dirname, '..', '01_content')
const OUTDIR = path.join(__dirname, '.run-preset-fill')
fs.mkdirSync(OUTDIR, { recursive: true })

const results = []
const ok = (name, cond, extra) => {
  results.push({ name, pass: !!cond })
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

// —— 打桩 bundle：src/index.ts 的 __testHooks 出口（内部函数白盒）——
const harness = ["import { __testHooks as H } from '../../01_content/src/index'", 'export const injectNavNotifyScript = H.injectNavNotifyScript', 'export const embedRewriteSetCookie = H.embedRewriteSetCookie', 'export const mirrorCapture = H.mirrorCapture', 'export const mirrorMerge = H.mirrorMerge', 'export const mirrorHostOf = H.mirrorHostOf'].join('\n')
fs.writeFileSync(path.join(OUTDIR, 'harness.ts'), harness)
const esb = path.join(CW, 'node_modules/@esbuild/win32-x64/esbuild.exe')
execFileSync(esb, [
  path.join(OUTDIR, 'harness.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--external:@deepseek-ai/*', '--external:ws', '--external:node-pty',
  '--loader:.css=text', '--loader:.html=text',
  '--outfile=' + path.join(OUTDIR, 'harness.cjs'),
], { cwd: CW, stdio: 'pipe' })

// 模块解析钩子：harness.cjs 内若出现运行时外部依赖（理论上没有），落到宿主 node_modules 兜底
const HOST = 'C:/Users/26294/.dsh/profiles/web/node_modules'
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  try { return origResolve.call(this, request, parent, ...rest) } catch (e) {
    if (!request.startsWith('.') && !path.isAbsolute(request)) {
      try { return origResolve.call(this, path.join(HOST, request), parent, ...rest) } catch {}
    }
    throw e
  }
}
const mod = require(path.join(OUTDIR, 'harness.cjs'))
const { injectNavNotifyScript, embedRewriteSetCookie, mirrorCapture, mirrorMerge, mirrorHostOf } = mod

async function main() {
  // mirrorHostOf 基础
  ok('mirrorHostOf 取主机名', mirrorHostOf('http://192.168.1.10:6885') === '192.168.1.10' && mirrorHostOf('https://example.com') === 'example.com', '')

  // ① 无 staged：只注入导航上报，不注入填充脚本
  const plain = injectNavNotifyScript('<html><head></head><body></body></html>', 'http://192.168.1.10:6885')
  ok('无 staged 不注入填充脚本', !plain.includes('__wt_preset_fill'), '')
  ok('无 staged 仍注入导航上报', plain.includes('__wt_nav'), '')

  // ② 填充脚本结构（源码常量断言——脚本本体是模板字符串拼接，产物与源码一致由 e2e 兜底）
  const src = fs.readFileSync(path.join(CW, 'src/index.ts'), 'utf8')
  const fillSeg = src.slice(src.indexOf('const fillScriptOpen'), src.indexOf('interface EmbedProxy'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n') // 剥整行注释（说明文字会含敏感词误匹配）
  ok('可见性：矩形+祖链（代码不用 offsetParent）', fillSeg.includes('getBoundingClientRect') && !fillSeg.includes('offsetParent'), '')
  ok('可见性：祖先链零尺寸检查', fillSeg.includes('clientWidth===0'), '')
  ok('配对：全页最后可见文本框兜底', fillSeg.includes('function anyVisible'), '')
  ok('配对：中文账号词识别', fillSeg.includes('账号'), '')
  ok('写入：首填无条件+补填只救空值', fillSeg.includes('function put(el,v)') && fillSeg.includes('cur===v'), '')
  ok('写入：补填不碰焦点字段', fillSeg.includes('document.activeElement'), '')
  ok('循环：500ms×60 补填', fillSeg.includes('tries>60'), '')
  ok('握手：完成上报 postMessage', fillSeg.includes('__wt_preset_fill'), '')
  ok('脚本拼接：<script> 恰一处、无嵌套开标签', (fillSeg.match(/<script>/g) || []).length === 1 && (fillSeg.replace(/<\\\//g, '</').match(/<\/script>/g) || []).length >= 1, '')
  ok('凭据窗口：90 秒同主机名兜底', src.includes('mirrorHostOf(k) === h'), '')

  // ③ Set-Cookie 清洗行为不回归
  const sc = embedRewriteSetCookie('kdservice-sessionid=abc; Path=/; HttpOnly; Domain=x; Secure')
  ok('Set-Cookie 去 Domain/Secure + SameSite=Lax', !sc.includes('Domain=') && !sc.includes('Secure') && sc.includes('SameSite=Lax') && sc.startsWith('kdservice-sessionid=abc'), sc)

  // ④ Cookie 镜像：捕获 → 补齐 → 同名不覆盖 → 隔离
  mirrorCapture('h1', ['a=1; Path=/', 'b=2'])
  mirrorCapture('h1', ['a=9']) // 同名覆盖（镜像跟随最新）
  const m1 = mirrorMerge('h1', '')
  ok('镜像捕获+合并（同名取最新）', m1 === 'a=9; b=2', 'm1=' + m1)
  const m2 = mirrorMerge('h1', 'a=local; c=3')
  ok('镜像只补缺（同名以浏览器值为准）', m2 === 'a=local; c=3; b=2', 'm2=' + m2)
  mirrorCapture('h2', ['x=1'])
  ok('镜像按主机名隔离', mirrorMerge('h2', '') === 'x=1' && mirrorMerge('nope', '') === null, '')
  ok('空桶返回 null（请求头保持原样）', mirrorMerge('empty', '') === null, '')

  console.log('—— 总结: ' + results.filter(r => r.pass).length + '/' + results.length + ' PASS ——')
  process.exitCode = results.some(r => !r.pass) ? 1 : 0
}

main().catch((e) => { console.error('PROBE-ERROR', e); process.exit(1) })
