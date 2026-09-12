/**
 * 预置资源管理（store 层）：两类条目——预置浏览器链接 / 预置本地资源目录，
 * 每条独立选择打开方式（工作台分栏 / 外部打开）。
 * 领域约定：所有状态只存 localStorage，不读写工作区文件。
 * 密码：浏览器本地存储无法真加密，采用 XOR + Base64 混淆存储（防明文直读/肩窥）；
 * 列表掩码展示、编辑时可见。分栏打开时凭据仅 staged 90 秒供代理注入自动填充，用后即弃。
 */

export type PresetKind = 'url' | 'dir'
export type PresetOpenMode = 'split' | 'external'

export type PresetEntry = {
  id: string
  kind: PresetKind
  /** 可空：显示时自动取域名 / 目录名 */
  name: string
  /** kind='url'：完整链接（http/https） */
  url: string
  /** kind='dir'：本地目录绝对路径 */
  dirPath: string
  /** 仅 url：登录账号（选填） */
  account: string
  /** 仅 url：混淆存储后的密码（列表掩码、编辑时 revealSecret 还原） */
  secret: string
  note: string
  openMode: PresetOpenMode
}

const KEY = 'dsh.worktable.presets.v1'
const SECRET_MARK = 'enc.v1:'
const SECRET_XOR_KEY = 'dsh-worktable-preset'

/** 明文 → 混淆存储串（XOR + Base64；不是加密，仅防 localStorage 明文直读/肩窥） */
export function protectSecret(plain: string): string {
  if (!plain) return ''
  try {
    const raw = new TextEncoder().encode(plain)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ SECRET_XOR_KEY.charCodeAt(i % SECRET_XOR_KEY.length)
    let bin = ''
    for (const b of out) bin += String.fromCharCode(b)
    return SECRET_MARK + btoa(bin)
  } catch { return '' }
}

/** 混淆存储串 → 明文（带标记才解；未标记按旧明文原样返回） */
export function revealSecret(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(SECRET_MARK)) return stored
  try {
    const bin = atob(stored.slice(SECRET_MARK.length))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ SECRET_XOR_KEY.charCodeAt(i % SECRET_XOR_KEY.length)
    return new TextDecoder().decode(bytes)
  } catch { return '' }
}

/** 列表掩码：有条目值即显示圆点串，不暴露长度 */
export function maskSecret(stored: string): string {
  return stored ? '••••••' : ''
}

export function loadPresets(): PresetEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((e: any) => e && typeof e.id === 'string' && (e.kind === 'url' || e.kind === 'dir')) as PresetEntry[]
  } catch { return [] }
}

function persist(list: PresetEntry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
}

/** 新增或更新（按 id upsert），返回新列表 */
export function savePreset(entry: PresetEntry): PresetEntry[] {
  const list = loadPresets()
  const i = list.findIndex((e) => e.id === entry.id)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  persist(list)
  return list
}

export function removePreset(id: string): PresetEntry[] {
  const list = loadPresets().filter((e) => e.id !== id)
  persist(list)
  return list
}

export function newPresetId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 名称留空时的自动取名：url → 域名；dir → 目录名（路径最后一段） */
export function autoName(kind: PresetKind, url: string, dirPath: string): string {
  if (kind === 'url') {
    try { return new URL(url).hostname } catch { return url }
  }
  const parts = String(dirPath).replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dirPath
}

/** 预置 url 的合法 origin（http/https），非法返回 null */
export function originOfPreset(url: string): string | null {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : null
  } catch { return null }
}

// —— 分栏打开的凭据 staging：点击【打开】后 90 秒内、仅对该站点代理生效，用后即弃 ——

const FILL_TTL_MS = 90_000
let fillStage: { origin: string; exp: number } | null = null

/** 暂存凭据到服务端（该源代理返回 HTML 时注入只填不提交的填充脚本） */
export function stagePresetFill(origin: string, user: string, pass: string): void {
  fillStage = { origin, exp: Date.now() + FILL_TTL_MS }
  fetch('/api/worktable/preset-fill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin, user, pass }),
  }).catch(() => {})
}

/** 填充完成上报（页面脚本 postMessage）→ 清本地 stage 并让服务端删除凭据 */
export function consumePresetFill(): void {
  if (!fillStage) return
  const origin = fillStage.origin
  fillStage = null
  fetch('/api/worktable/preset-fill/done', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin }),
  }).catch(() => {})
}

/** 填充脚本完成上报监听（模块级一次注册；页面任何一次填充尝试结束都会上报 → 用后即弃） */
export function listenPresetFill(onFill: () => void): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as any
    if (d && d.__wt_preset_fill === true) onFill()
  })
}
