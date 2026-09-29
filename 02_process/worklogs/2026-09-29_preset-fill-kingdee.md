# 预置资源·金蝶AI套件自动填充与登录态修复（2026-09-29）

## 用户报障

工作台窗口预置资源的浏览器链接打开金蝶 AI 套件（贝可曼环境测试）：
1. 打开后登录账号和密码没有填充进去（用户确认：从来没填过）；
2. 登录后没有进入首页，还在登录页面刷新（用户确认：登录后被弹回登录页）。

用户期望：只自动填充，登录动作手动点（维持「只填不提交」设计）。

## 第二轮实测补充（重启后，2026-09-29）

用户重启 dsh web 后实测：登录动作通了，但**点登录后仍停在登录页，需再点一次【打开】才进首页**。
反推根因：会话 Cookie 已种上（重开能进首页证明镜像链路工作）；卡点在**登录成功后的 JS 绝对地址
跳转**——站点用 `location.href = 上游真实地址（另一端口）` 跳转，JS 赋值无法拦截，iframe 直接跳去
上游源。该页（a）没有注入脚本、不发导航上报；（b）浏览器对上游真实源没有会话 Cookie（会话种在
代理源 127.0.0.1 上）→ 停在登录页。手动重开 = iframe 回到代理 src 重载 → 站点见 Cookie →
302 改写 + 镜像 → 首页。

**修复（客户端 BrowserPane，F5 即生效）**：逃逸检测自动接回——代理嵌入（proxied）的 iframe 每次
load 后起 1.5s 观察窗；期间收到任何 `__wt_nav` / `__wt_preset_fill` 上报 = 页面在代理内，放行；
零上报 = 已逃逸到上游直连 → 自动 bump iframe key 重挂回当前代理地址（等价于用户手动重开，但无感；
站点见到会话 Cookie 自动落首页）。代际计数防快速连续加载误杀；上限 3 次防异常页面循环；
仅 proxied 页面检测（直连嵌入不受影响）。

## 根因（代码走读 + 离线复现）

### Bug A：填充从未生效 — `injectNavNotifyScript` 注入脚本三处硬伤
- 可见性判断 `el.offsetParent === null`：金蝶登录页常用 `position:fixed` 全屏容器，
  fixed 元素 `offsetParent` 恒为 null → 所有输入框被判「不可见」→ 一个不填；
- 用户名框只在「DOM 顺序先于密码框」时被识别（`!pw` 守卫），顺序相反即丢失；
- 只尝试填充一次，框架迟渲染/重渲染清空值后不再补填；`readonly` 输入框直接跳过
  （原生 setter 其实可写）。

### Bug B：登录后被弹回登录页 — 浏览器源隔离 × 整源代理
- 登录 Cookie 存在浏览器「源」（scheme+host+port）下；整源代理每个目标源各占一个
  127.0.0.1 端口。金蝶登录成功常 302 跳同主机另一端口的入口页 →
  落地的代理源没有登录 Cookie → 上游判定未登录 → 弹回登录页；
- 且 302 的绝对 Location 指向上游真实地址，iframe 直接跳出代理包络，链路断裂；
- 附带：staged 填充凭据也按 origin 键控，跨源后的第二个登录页同样不填充。

## 修复

### 服务端 `01_content/src/index.ts`
1. **填充脚本重写**：
   - 可见性 = getBoundingClientRect + 计算样式 + 祖先链零尺寸检查（fixed 按可见）；
   - 用户名配对：同表单 guess 命中优先 → 全页最后一个可见文本框兜底；中文词
     （账号/用户/手机/邮箱等）加入识别；
   - 写入策略 `put()`：首填无条件；补填只救「被框架清空的空值」且不碰焦点字段
     （尊重用户手工修改）；
   - 500ms × 60 次（30 秒）补填循环；readonly 放行（原生 setter + input/change/keyup 事件）。
2. **跨源会话桥（Cookie 主机名镜像，仅本机内存不落盘）**：
   - `mirrorCapture`：各源响应 Set-Cookie 捕获进 hostname 桶；
   - `mirrorMerge`：转发前按主机名补齐缺失 Cookie（同名以浏览器当前源自带值为准）；
   - 同主机跨端口 302 Location 改写为「目标端口源的代理根」（登录跳转不出包络）；
   - 不同主机的站点互不共享（行为与直连一致）。
3. **staged 凭据 90 秒内同主机名跨端口兜底**（精确 origin 命中优先），
   `/preset-fill/done` 上报时同主机名条目一并删除（用后即弃语义不破）。
4. `__testHooks` 白盒出口（运行时无消费者，探针 re-export 用）。

### 客户端 `01_content/src/client/split.tsx` + `presetsPane.tsx`
1. `splitStore.reopenTab()`：同内容标签已存在时 bump `reopenTick`（iframe key 变化 =
   重挂载）；预置资源【打开】改走 reopenTab——再点【打开】= 全新登录页 + staged 凭据
   重新注入，而不是「激活旧标签、什么都不发生」；
2. BrowserPane reloadN = 标签 ↻（reloadKey）+ reopenTick 叠加；
3. 复制账号/密码 toast 标签修复：原来恒显示按钮文案（两组账号分不清），改为已选账号名
   （只存密码的组显示组序号）。

## 验证（全绿）

| 探针 | 内容 | 结果 |
|---|---|---|
| `04_test/probe-preset-accounts.cjs` | 多账号 UI 回归（jsdom 真渲染 + reopenTab 断言） | 31/31 PASS，EXIT=0 |
| `04_test/probe-preset-fill-server.cjs` | 注入器/Cookie 镜像/Set-Cookie 清洗白盒 | 18/18 PASS |
| `04_test/probe-embed-e2e.cjs` | **真产物 apply()** + 模拟金蝶双端口上游：注入→填充 payload→Set-Cookie 清洗→登录 302 改写代理根→镜像会话进首页→上报删凭据→无 staged 不注入 | 13/13 PASS，EXIT=0 |

## 生效方式与贝可曼验收

- 客户端（填充脚本 UI 行为）：构建产物实时下发，**F5 刷新 GUI 即生效**；
- 服务端（Cookie 桥/302 改写/staged 兜底）：**需重启 dsh web 一次**（bundle 启动时组合）。
- 贝可曼环境人工验收路径：预置资源 → 打开「贝可曼AI套件」→ 登录页应自动填好账号密码
  （只填不提交）→ 手动点登录 → 应落在首页不再弹回登录页。

## 边界说明

- 需要扫码/SSO 的站点依旧用地址栏 ⇱（系统浏览器打开）逃生口——代理源下这类会话本就无效；
- Cookie 镜像只按「同主机名（含端口差异）」互通；若贝可曼登录跳转是**跨主机名**
  （如 sso.xxx.com → portal.xxx.com），此版不共享 Cookie（与直连行为一致），需再反馈。
