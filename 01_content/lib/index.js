// src/index.ts
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve as pathResolve, sep } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// template/dshell.css
var dshell_default = `/* dsh-worktable \u539F\u751F\u76AE\u80A4 \xB7 DSH \u8BBE\u8BA1\u7CFB\u7EDF\u7EC4\u4EF6\u5E93\r
   \u7528\u6CD5\uFF1A<link rel="stylesheet" href="/api/worktable/template/dshell.css">\r
   \u6240\u6709\u989C\u8272\u8D70 DSH \u4E3B\u9898\u53D8\u91CF\uFF08--dsw-alias-*\uFF09\uFF0C\u81EA\u52A8\u9002\u914D\u660E\u6697\u4E3B\u9898\u3002 */\r
:root { color-scheme: dark; }\r
* { box-sizing: border-box; }\r
html, body { margin: 0; padding: 0; }\r
body {\r
  background: var(--dsw-alias-bg-base, #0b0e14);\r
  color: var(--dsw-alias-label-primary, #e6e8eb);\r
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;\r
  font-size: 13px;\r
  line-height: 1.6;\r
}\r
.dshell { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; min-height: 100%; }\r
/* \u6587\u5B57\u5C42\u7EA7 */\r
.dshell-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8eb); }\r
.dshell-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa4b2); }\r
.dshell-muted { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11.5px; }\r
/* \u5361\u7247 */\r
.dshell-card { border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 10px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); padding: 12px 14px; }\r
.dshell-card + .dshell-card { margin-top: 10px; }\r
/* \u6309\u94AE\uFF08\u7EFF\u8272\u4E3B\u6309\u94AE / \u5E7D\u7075\u6309\u94AE / \u5371\u9669\uFF09 */\r
.dshell-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; border: 1px solid transparent; background: #3fb950; color: #0b0e14; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }\r
.dshell-btn:hover { filter: brightness(1.08); }\r
.dshell-btnGhost { background: transparent; border-color: var(--dsw-alias-border-l1, #262b36); color: var(--dsw-alias-label-secondary, #9aa4b2); }\r
.dshell-btnGhost:hover { color: var(--dsw-alias-label-primary, #e6e8eb); border-color: var(--dsw-alias-border-l2, #3a4150); }\r
.dshell-btnDanger { background: transparent; border-color: #f85149; color: #f85149; }\r
/* \u72B6\u6001\u5FBD\u6807\uFF08\u5706\u70B9 + \u6587\u5B57\uFF1B\u7EFF=\u5DF2\u5B8C\u6210 \u9EC4=\u5F85\u529E/\u5F85\u53D1\u5E03 \u7070=\u672A\u5F00\u59CB\uFF09 */\r
.dshell-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, #262b36); font-size: 11.5px; color: var(--dsw-alias-label-secondary, #9aa4b2); background: var(--dsw-alias-fill-l1, rgba(255,255,255,.03)); }\r
.dshell-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #6b7280); }\r
.dshell-badgeDone { color: #3fb950; border-color: rgba(63,185,80,.4); }\r
.dshell-badgeDone::before { background: #3fb950; box-shadow: 0 0 5px #3fb950; }\r
.dshell-badgeWait { color: #d29922; border-color: rgba(210,153,34,.4); }\r
.dshell-badgeWait::before { background: #d29922; box-shadow: 0 0 5px #d29922; }\r
.dshell-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #6b7280); }\r
.dshell-dotDone { background: #3fb950; box-shadow: 0 0 5px #3fb950; }\r
.dshell-dotWait { background: #d29922; box-shadow: 0 0 5px #d29922; }\r
/* \u6807\u7B7E\u9875 */\r
.dshell-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, #262b36); }\r
.dshell-tab { padding: 7px 12px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #9aa4b2); cursor: pointer; border: none; background: none; font: inherit; border-bottom: 2px solid transparent; margin-bottom: -1px; }\r
.dshell-tabOn { color: var(--dsw-alias-label-primary, #e6e8eb); border-bottom-color: var(--dsw-alias-state-accent-primary, #4f8ef7); }\r
/* \u5217\u8868 */\r
.dshell-list { display: flex; flex-direction: column; gap: 6px; }\r
.dshell-listItem { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 8px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); cursor: pointer; }\r
.dshell-listItem:hover { border-color: var(--dsw-alias-border-l2, #3a4150); background: var(--dsw-alias-fill-l1, rgba(255,255,255,.05)); }\r
.dshell-listItemTitle { font-size: 12.5px; color: var(--dsw-alias-label-primary, #e6e8eb); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\r
.dshell-listItemMeta { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary, #6b7280); }\r
/* \u7F51\u683C / \u7EDF\u8BA1 */\r
.dshell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }\r
.dshell-stat { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 10px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.02)); }\r
.dshell-statLabel { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa4b2); }\r
.dshell-statValue { font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8eb); }\r
.dshell-statDelta { font-size: 11px; color: #3fb950; }\r
/* \u8FDB\u5EA6\u6761 */\r
.dshell-progress { height: 6px; border-radius: 3px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.06)); overflow: hidden; }\r
.dshell-progressBar { height: 100%; border-radius: 3px; background: #3fb950; }\r
/* \u8F93\u5165 */\r
.dshell-input, .dshell-textarea { width: 100%; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1, #262b36); border-radius: 8px; background: var(--dsw-alias-fill-l1, rgba(255,255,255,.03)); color: var(--dsw-alias-label-primary, #e6e8eb); font: inherit; font-size: 12.5px; outline: none; }\r
.dshell-input:focus, .dshell-textarea:focus { border-color: var(--dsw-alias-state-accent-primary, #4f8ef7); }\r
/* \u8868\u683C */\r
.dshell-table { width: 100%; border-collapse: collapse; font-size: 12px; }\r
.dshell-table th, .dshell-table td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #262b36); }\r
.dshell-table th { color: var(--dsw-alias-label-secondary, #9aa4b2); font-weight: 500; }\r
/* \u952E\u503C\u5BF9 */\r
.dshell-kv { display: flex; flex-direction: column; gap: 6px; }\r
.dshell-kvRow { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }\r
.dshell-kvKey { color: var(--dsw-alias-label-secondary, #9aa4b2); }\r
.dshell-kvValue { color: var(--dsw-alias-label-primary, #e6e8eb); text-align: right; }\r
/* \u5206\u5272\u7EBF */\r
.dshell-divider { height: 1px; background: var(--dsw-alias-border-l1, #262b36); margin: 6px 0; }\r
/* \u6EDA\u52A8\u6761 */\r
::-webkit-scrollbar { width: 10px; height: 10px; }\r
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 5px; }\r
::-webkit-scrollbar-track { background: transparent; }\r
`;

// template/dshell.html
var dshell_default2 = '<!doctype html>\r\n<!-- dsh-worktable \u539F\u751F\u76AE\u80A4\u6A21\u677F\uFF1A\u65B0\u9875\u9762\u4EE5\u6B64\u4E3A\u57FA\u7840\uFF0C\u66FF\u6362\u4E0B\u9762\u793A\u4F8B\u5185\u5BB9\u5373\u53EF\u3002\r\n     \u6837\u5F0F\u8868\u7531\u63D2\u4EF6\u63D0\u4F9B\uFF08\u968F\u4E3B\u9898\u81EA\u52A8\u9002\u914D\uFF09\uFF0C\u4E0D\u8981\u590D\u5236\u6216\u6539\u5199\u5B83\u3002 -->\r\n<html lang="zh-CN">\r\n<head>\r\n  <meta charset="utf-8" />\r\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\r\n  <title>\u6211\u7684\u7A97\u53E3</title>\r\n  <link rel="stylesheet" href="/api/worktable/template/dshell.css" />\r\n</head>\r\n<body>\r\n  <div class="dshell">\r\n    <!-- \u6807\u9898\u533A -->\r\n    <h1 class="dshell-title">\u7A97\u53E3\u6807\u9898</h1>\r\n    <p class="dshell-sub">\u4E00\u53E5\u8BDD\u8BF4\u660E\u8FD9\u4E2A\u7A97\u53E3\u505A\u4EC0\u4E48\u3002</p>\r\n\r\n    <!-- \u72B6\u6001\u5FBD\u6807\uFF1A\u5DF2\u5B8C\u6210 dshell-badgeDone / \u8FDB\u884C\u4E2D dshell-badgeWait / \u9ED8\u8BA4 -->\r\n    <div>\r\n      <span class="dshell-badge dshell-badgeDone">\u5DF2\u5B8C\u6210</span>\r\n      <span class="dshell-badge dshell-badgeWait">\u8FDB\u884C\u4E2D</span>\r\n      <span class="dshell-badge">\u672A\u5F00\u59CB</span>\r\n    </div>\r\n\r\n    <!-- \u6807\u7B7E\u9875 -->\r\n    <div class="dshell-tabs">\r\n      <button class="dshell-tab dshell-tabOn">\u6982\u89C8</button>\r\n      <button class="dshell-tab">\u8BE6\u60C5</button>\r\n      <button class="dshell-tab">\u8BBE\u7F6E</button>\r\n    </div>\r\n\r\n    <!-- \u7EDF\u8BA1\u5361\u7247\u7F51\u683C -->\r\n    <div class="dshell-grid">\r\n      <div class="dshell-stat">\r\n        <div class="dshell-statLabel">\u603B\u6570</div>\r\n        <div class="dshell-statValue">128</div>\r\n        <div class="dshell-statDelta">+12.4%</div>\r\n      </div>\r\n      <div class="dshell-stat">\r\n        <div class="dshell-statLabel">\u8FDB\u884C\u4E2D</div>\r\n        <div class="dshell-statValue">7</div>\r\n      </div>\r\n      <div class="dshell-stat">\r\n        <div class="dshell-statLabel">\u5DF2\u5B8C\u6210</div>\r\n        <div class="dshell-statValue">121</div>\r\n      </div>\r\n    </div>\r\n\r\n    <!-- \u5217\u8868 -->\r\n    <div class="dshell-list">\r\n      <div class="dshell-listItem">\r\n        <span class="dshell-listItemTitle">\u6761\u76EE\u4E00\uFF1A\u793A\u4F8B\u5185\u5BB9\u6807\u9898</span>\r\n        <span class="dshell-listItemMeta">\u6628\u5929</span>\r\n      </div>\r\n      <div class="dshell-listItem">\r\n        <span class="dshell-listItemTitle">\u6761\u76EE\u4E8C\uFF1A\u793A\u4F8B\u5185\u5BB9\u6807\u9898</span>\r\n        <span class="dshell-badge dshell-badgeDone">\u5DF2\u53D1\u5E03</span>\r\n      </div>\r\n    </div>\r\n\r\n    <!-- \u5361\u7247 + \u952E\u503C\u5BF9 -->\r\n    <div class="dshell-card">\r\n      <h2 class="dshell-sub" style="margin:0 0 8px">\u8BE6\u60C5</h2>\r\n      <div class="dshell-kv">\r\n        <div class="dshell-kvRow"><span class="dshell-kvKey">\u5B57\u6BB5 A</span><span class="dshell-kvValue">\u503C A</span></div>\r\n        <div class="dshell-kvRow"><span class="dshell-kvKey">\u5B57\u6BB5 B</span><span class="dshell-kvValue">\u503C B</span></div>\r\n      </div>\r\n      <div class="dshell-divider"></div>\r\n      <div class="dshell-progress"><div class="dshell-progressBar" style="width:72%"></div></div>\r\n    </div>\r\n\r\n    <!-- \u64CD\u4F5C\u533A -->\r\n    <div style="display:flex;gap:8px">\r\n      <button class="dshell-btn">\u4E3B\u8981\u64CD\u4F5C</button>\r\n      <button class="dshell-btn dshell-btnGhost">\u6B21\u8981\u64CD\u4F5C</button>\r\n    </div>\r\n  </div>\r\n</body>\r\n</html>\r\n';

// src/index.ts
var PLUGIN_VERSION = false ? "dev" : "0.3.1";
var name = "dsh-worktable";
var inject = ["webServer", "sessions"];
var HEALTH_PATH = "/api/worktable/health";
var MAX_ENTRIES = 500;
var FILE_TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm"
};
var SITE_PREFIX = "/api/worktable/site";
var EMBED_PREFIX = "/api/worktable/embed";
var EMBED_STRIP_RES_HEADERS = /* @__PURE__ */ new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "report-to",
  "reporting-endpoints",
  "permissions-policy",
  "content-encoding",
  // Node fetch 已自动解压，透传 gzip 头会让浏览器二次解压失败
  "content-length"
  // 头部重写后长度必变，交给 Node 自算
]);
var EMBED_STRIP_REQ_HEADERS = /* @__PURE__ */ new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "origin",
  "referer",
  "cookie"
  // 三者按目标源重建，见下方
]);
function embedRewriteSetCookie(sc) {
  return sc.split(";").filter((part) => {
    const k = part.split("=")[0].trim().toLowerCase();
    return k !== "domain" && k !== "secure" && k !== "samesite";
  }).join(";") + "; SameSite=Lax";
}
function injectNavNotifyScript(html, targetOrigin) {
  const originJson = JSON.stringify(targetOrigin);
  const script = "<script>(function(){var O=" + originJson + ';function r(){try{var p=location.pathname+location.search+location.hash;parent.postMessage({__wt_nav:true,url:O+p},"*")}catch(e){}}window.addEventListener("load",r);window.addEventListener("popstate",r);window.addEventListener("hashchange",r);try{var a=history.pushState,b=history.replaceState;history.pushState=function(){var x=a.apply(this,arguments);r();return x};history.replaceState=function(){var x=b.apply(this,arguments);r();return x}}catch(e){}function navTo(href){try{var u=new URL(href,location.href);if(u.protocol!=="http:"&&u.protocol!=="https:")return;if(u.origin===location.origin){if(u.href!==location.href)location.href=u.href;return;}parent.postMessage({__wt_nav:true,url:u.href,kind:"nav"},"*")}catch(e){}}try{document.addEventListener("click",function(ev){var el=ev.target&&ev.target.closest?ev.target.closest("a[href]"):null;if(!el)return;var t=(el.getAttribute("target")||"").toLowerCase();if(t!=="_blank"&&t!=="_new")return;ev.preventDefault();navTo(el.getAttribute("href"))},true)}catch(e){}try{var _o=window.open;window.open=function(u){try{if(u)navTo(u)}catch(e){}return null}}catch(e){}r()})()</script>';
  const i = html.toLowerCase().indexOf("</head>");
  return i >= 0 ? html.slice(0, i) + script + html.slice(i) : script + html;
}
var embedProxies = /* @__PURE__ */ new Map();
var EMBED_PROXY_MAX = 8;
var EMBED_PROXY_IDLE_MS = 60 * 60 * 1e3;
async function embedForward(clientReq, clientRes, targetOrigin) {
  const u = new URL(clientReq.url ?? "/", targetOrigin);
  const inHeaders = {};
  for (const [k, v] of Object.entries(clientReq.headers)) {
    if (EMBED_STRIP_REQ_HEADERS.has(k.toLowerCase())) continue;
    if (v !== void 0) inHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  inHeaders.referer = targetOrigin + "/";
  const cookieHeader = clientReq.headers.cookie;
  if (typeof cookieHeader === "string" && cookieHeader) inHeaders.cookie = cookieHeader;
  const init = { method: clientReq.method, headers: inHeaders, redirect: "manual", signal: AbortSignal.timeout(3e4) };
  if (clientReq.method !== "GET" && clientReq.method !== "HEAD") {
    const chunks = [];
    for await (const c of clientReq) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    if (chunks.length) init.body = Buffer.concat(chunks);
  }
  let upstream = null;
  try {
    upstream = await fetch(u.href, init);
  } catch (err) {
    try {
      init.signal = AbortSignal.timeout(3e4);
      upstream = await fetch(u.href, init);
    } catch (err2) {
      const cause = err2?.cause?.code ?? err2?.cause?.message ?? String(err2);
      if (!clientRes.headersSent) clientRes.writeHead(502, { "content-type": "text/plain; charset=utf-8", "retry-after": "2" });
      clientRes.end("[worktable embed] upstream fetch failed: " + cause + "\uFF08\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21\uFF1B\u76EE\u6807\u53EF\u80FD\u77AC\u65F6\u4E0D\u53EF\u8FBE\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\uFF09");
      return;
    }
  }
  const outHeaders = {};
  let setCookies;
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === "set-cookie") return;
    if (EMBED_STRIP_RES_HEADERS.has(lk)) return;
    outHeaders[k] = v;
  });
  if (typeof upstream.headers.getSetCookie === "function") {
    setCookies = upstream.headers.getSetCookie().map(embedRewriteSetCookie);
  }
  const loc = upstream.headers.get("location");
  if (loc && upstream.status >= 300 && upstream.status < 400) {
    try {
      outHeaders.location = new URL(loc, u.href).href.replace(targetOrigin, `http://127.0.0.1:${clientReq.__embedPort}`);
    } catch {
    }
  }
  if (setCookies) outHeaders["set-cookie"] = setCookies;
  clientRes.writeHead(upstream.status, outHeaders);
  if (upstream.body) {
    const contentType = String(outHeaders["content-type"] ?? "");
    const isHtml = contentType.toLowerCase().includes("text/html");
    const reader = upstream.body.getReader();
    try {
      if (isHtml) {
        const chunks = [];
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const html = Buffer.concat(chunks).toString("utf8");
        const out = injectNavNotifyScript(html, targetOrigin);
        if (!clientRes.write(out, "utf8")) await new Promise((r) => clientRes.once("drain", r));
      } else {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!clientRes.write(value)) await new Promise((r) => clientRes.once("drain", r));
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
      }
    }
  }
  clientRes.end();
}
function ensureEmbedProxy(ctx, targetOrigin) {
  const key = targetOrigin.replace(/\/+$/, "");
  const existing = embedProxies.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return Promise.resolve(`http://127.0.0.1:${existing.port}`);
  }
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const ep = embedProxies.get(key);
      if (ep) {
        ep.lastUsed = Date.now();
        req.__embedPort = ep.port;
      }
      embedForward(req, res, key).catch(() => {
        try {
          res.end();
        } catch {
        }
      });
    });
    server.on("error", (err) => {
      embedProxies.delete(key);
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      if (!port) {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const entry = {
        target: key,
        server,
        port,
        lastUsed: Date.now(),
        dispose: () => {
          try {
            server.close();
          } catch {
          }
        }
      };
      embedProxies.set(key, entry);
      ctx.effect(() => entry.dispose, "dsh-worktable: embed proxy server");
      sweepEmbedProxies();
      resolvePromise(`http://127.0.0.1:${port}`);
    });
  });
}
function sweepEmbedProxies() {
  const now = Date.now();
  for (const [k, p] of embedProxies) {
    if (now - p.lastUsed > EMBED_PROXY_IDLE_MS) {
      p.dispose();
      embedProxies.delete(k);
    }
  }
  while (embedProxies.size > EMBED_PROXY_MAX) {
    let oldest = null;
    let oldestT = Infinity;
    for (const [k2, p2] of embedProxies) if (p2.lastUsed < oldestT) {
      oldest = k2;
      oldestT = p2.lastUsed;
    }
    if (!oldest) break;
    const victim = embedProxies.get(oldest);
    victim?.dispose();
    embedProxies.delete(oldest);
  }
}
function originOf(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
var TEMPLATE_PREFIX = "/api/worktable/template";
function loadPkg(pkg) {
  const starts = /* @__PURE__ */ new Set();
  try {
    starts.add(dirname(fileURLToPath(import.meta.url)));
  } catch {
  }
  try {
    starts.add(realpathSync(dirname(fileURLToPath(import.meta.url))));
  } catch {
  }
  for (const start of starts) {
    let dir = start;
    while (dir && dir !== pathResolve(dir, "..")) {
      try {
        const req = createRequire(pathToFileURL(pathResolve(dir, "__wt_probe__.js")).href);
        return req(pkg);
      } catch {
      }
      dir = pathResolve(dir, "..");
    }
  }
  try {
    const profilesDir = pathResolve(homedir(), ".dsh", "profiles");
    for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!profile.isDirectory() && !profile.isSymbolicLink()) continue;
      const nm = pathResolve(profilesDir, profile.name, "node_modules");
      try {
        const req = createRequire(pathToFileURL(pathResolve(nm, "__wt_probe__.js")).href);
        return req(pkg);
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function serverCwd(ctx, sessionId, clientCwd) {
  if (sessionId) {
    try {
      const headerCwd = ctx.sessions?.get?.(sessionId)?.header?.cwd;
      if (typeof headerCwd === "string" && headerCwd) return headerCwd;
    } catch {
    }
  }
  if (typeof clientCwd === "string" && clientCwd) return clientCwd;
  return process.cwd();
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
async function listDirectory(path) {
  const abs = pathResolve(path);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries = dirents.map((d) => ({ name: d.name, path: abs + sep + d.name, isDir: d.isDirectory(), hidden: d.name.startsWith(".") })).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
  });
  const truncated = entries.length > MAX_ENTRIES;
  return { path: abs, entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated };
}
function gitExec(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout);
    });
  });
}
async function gitStatus(cwd) {
  try {
    const branchRaw = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const porcelain = await gitExec(["status", "--porcelain=v1", "-z"], cwd);
    const entries = porcelain.split("\0").filter((s) => s.length > 2).map((s) => ({ xy: s.slice(0, 2), path: s.slice(3) }));
    return { isRepo: true, branch: branchRaw.trim() || "HEAD", entries };
  } catch {
    return { isRepo: false, branch: void 0, entries: [] };
  }
}
function setupTerminal(webServer, ctx) {
  if (typeof webServer.registerUpgrade !== "function") return;
  const wsMod = loadPkg("ws");
  const ptyMod = loadPkg("node-pty");
  ctx.logger?.info?.("[dsh-worktable] term deps: ws=" + (wsMod ? "ok" : "MISSING") + " node-pty=" + (ptyMod ? "ok" : "MISSING"));
  if (!wsMod || !ptyMod) {
    ctx.logger?.warn("[dsh-worktable] \u7EC8\u7AEF\u8DEF\u7531\u672A\u6CE8\u518C\uFF1Aws/node-pty \u4E0D\u53EF\u7528");
    return;
  }
  const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default?.WebSocketServer;
  if (!WebSocketServer) return;
  const pty = ptyMod.default ?? ptyMod;
  const wss = new WebSocketServer({ noServer: true });
  const spawnShell = () => process.platform === "win32" ? { cmd: "powershell.exe", args: ["-NoLogo", "-NoProfile"] } : { cmd: process.env.SHELL || "/bin/bash", args: [] };
  const clampDim = (v, fallback) => Math.min(1024, Math.max(2, Number.isFinite(v) ? v : fallback));
  ctx.effect(() => webServer.registerUpgrade({
    path: "/api/worktable/term",
    handler: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const u = new URL(req.url ?? "/", "http://dsh.internal");
        const cwd = serverCwd(ctx, u.searchParams.get("sessionId") || void 0, u.searchParams.get("cwd") || void 0);
        const cols = clampDim(Number(u.searchParams.get("cols")), 80);
        const rows = clampDim(Number(u.searchParams.get("rows")), 24);
        let term = null;
        try {
          const shell = spawnShell();
          term = pty.spawn(shell.cmd, shell.args, { name: "xterm-256color", cols, rows, cwd, env: process.env });
        } catch (err) {
          try {
            ws.send("\r\n[worktable] \u7EC8\u7AEF\u542F\u52A8\u5931\u8D25\uFF1A" + String(err));
          } catch {
          }
          try {
            ws.close();
          } catch {
          }
          return;
        }
        term.onData((d) => {
          try {
            ws.send(d);
          } catch {
          }
        });
        term.onExit(() => {
          try {
            ws.close();
          } catch {
          }
        });
        ws.on("message", (raw) => {
          const text = String(raw);
          try {
            const msg = JSON.parse(text);
            if (msg && msg.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
              term.resize(clampDim(msg.cols, cols), clampDim(msg.rows, rows));
              return;
            }
          } catch {
          }
          try {
            term.write(text);
          } catch {
          }
        });
        ws.on("close", () => {
          try {
            term.kill();
          } catch {
          }
        });
      });
    }
  }), "dsh-worktable: terminal upgrade");
}
function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer) {
    ctx.logger?.warn("[dsh-worktable] ctx.webServer \u4E0D\u53EF\u7528\uFF08headless profile\uFF1F\uFF09\uFF0C\u8DF3\u8FC7\u670D\u52A1\u7AEF\u8DEF\u7531");
    return;
  }
  webServer.register({
    kind: "exact",
    path: HEALTH_PATH,
    handler: (_req, res) => {
      json(res, 200, { plugin: "dsh-worktable", version: PLUGIN_VERSION, ok: true });
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/file",
    handler: async (req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://dsh.internal");
        const p = u.searchParams.get("path") || "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        const abs = pathResolve(p);
        const stat = await import("node:fs/promises").then((m) => m.stat(abs));
        if (stat.size > 20 * 1024 * 1024) {
          json(res, 413, { error: "file too large" });
          return;
        }
        const data = await readFile(abs);
        const ext = (abs.split(".").pop() || "").toLowerCase();
        const types = {
          html: "text/html; charset=utf-8",
          htm: "text/html; charset=utf-8",
          css: "text/css; charset=utf-8",
          js: "text/javascript; charset=utf-8",
          mjs: "text/javascript; charset=utf-8",
          json: "application/json; charset=utf-8",
          md: "text/markdown; charset=utf-8",
          markdown: "text/markdown; charset=utf-8",
          txt: "text/plain; charset=utf-8",
          log: "text/plain; charset=utf-8",
          pdf: "application/pdf",
          svg: "image/svg+xml",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
          ico: "image/x-icon"
        };
        res.writeHead(200, { "content-type": FILE_TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(data);
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "prefix",
    path: TEMPLATE_PREFIX,
    handler: (req, res) => {
      try {
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
        const rel = pathname.slice(TEMPLATE_PREFIX.length);
        if (rel === "/dshell.css") {
          res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
          res.end(dshell_default);
        } else {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(dshell_default2);
        }
      } catch (err) {
        res.writeHead(404);
        res.end(String(err));
      }
    }
  });
  webServer.register({
    kind: "prefix",
    path: SITE_PREFIX,
    handler: async (req, res) => {
      try {
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
        const segs = pathname.slice(SITE_PREFIX.length).split("/").filter(Boolean);
        const rootToken = decodeURIComponent(segs.shift() ?? "");
        const rel = segs.map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        }).join("/");
        if (!rootToken) {
          json(res, 400, { error: "missing root" });
          return;
        }
        const root = pathResolve(rootToken);
        let abs = pathResolve(root, rel);
        if (abs !== root && !abs.startsWith(root + sep)) {
          json(res, 403, { error: "outside root" });
          return;
        }
        const statMod = await import("node:fs/promises");
        let info = await statMod.stat(abs).catch(() => null);
        if (info && info.isDirectory()) {
          abs = pathResolve(abs, "index.html");
          info = await statMod.stat(abs).catch(() => null);
        }
        if (!info || !info.isFile()) {
          json(res, 404, { error: "not found" });
          return;
        }
        if (info.size > 40 * 1024 * 1024) {
          json(res, 413, { error: "file too large" });
          return;
        }
        const data = await readFile(abs);
        const ext = (abs.split(".").pop() || "").toLowerCase();
        res.writeHead(200, { "content-type": FILE_TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(data);
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: EMBED_PREFIX,
    handler: async (req, res) => {
      const started = Date.now();
      try {
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const u = new URL(req.url ?? "/", "http://dsh.internal");
        const target = u.searchParams.get("u") || "";
        const origin = originOf(target);
        if (!origin) {
          json(res, 400, { ok: false, error: "bad url", fallback: target });
          return;
        }
        const parsed = new URL(target);
        const hostHeader = String(req.headers?.host ?? "");
        const isSelf = (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1") && origin === (hostHeader.includes(":") ? "http://" + hostHeader : "http://" + hostHeader + ":80");
        if (isSelf) {
          json(res, 200, { ok: true, src: target, proxied: false });
          return;
        }
        const proxyRoot = await ensureEmbedProxy(ctx, origin);
        json(res, 200, { ok: true, src: proxyRoot + parsed.pathname + parsed.search, proxied: true, ms: Date.now() - started });
      } catch (err) {
        json(res, 200, { ok: false, error: String(err), fallback: new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("u") || "" });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/fs",
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const path = typeof body.path === "string" && body.path ? body.path : serverCwd(ctx, body.sessionId, body.cwd);
        json(res, 200, await listDirectory(path));
      } catch (err) {
        json(res, 500, { path: "", entries: [], truncated: false, error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/workspaces",
    handler: async (_req, res) => {
      try {
        const file = pathResolve(homedir(), ".dsh", "storages", "workspace.json");
        const raw = await readFile(file, "utf8");
        json(res, 200, JSON.parse(raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw));
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/write",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = await readJsonBody(req);
        const p = typeof body.path === "string" ? body.path : "";
        const content = typeof body.content === "string" ? body.content : "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        if (content.length > 20 * 1024 * 1024) {
          json(res, 413, { error: "content too large" });
          return;
        }
        const abs = pathResolve(p);
        await import("node:fs/promises").then((m) => m.writeFile(abs, content, "utf8"));
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/mkdir",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = await readJsonBody(req);
        const p = typeof body.path === "string" ? body.path.trim() : "";
        if (!p) {
          json(res, 400, { error: "missing path" });
          return;
        }
        const abs = pathResolve(p);
        const fsx = await import("node:fs/promises");
        const parent = dirname(abs);
        try {
          await fsx.access(parent);
        } catch {
          json(res, 400, { error: "parent not found" });
          return;
        }
        await fsx.mkdir(abs);
        json(res, 200, { ok: true, path: abs });
      } catch (err) {
        json(res, err?.code === "EEXIST" ? 200 : 500, err?.code === "EEXIST" ? { ok: true, exists: true } : { error: String(err) });
      }
    }
  });
  webServer.register({
    kind: "exact",
    path: "/api/worktable/git",
    handler: async (req, res) => {
      const body = await readJsonBody(req);
      const cwd = serverCwd(ctx, body.sessionId, body.cwd);
      json(res, 200, await gitStatus(cwd));
    }
  });
  setupTerminal(webServer, ctx);
}
export {
  HEALTH_PATH,
  apply,
  inject,
  name
};
