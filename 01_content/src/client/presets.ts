/**
 * 预置资源管理（store 层）：两类条目——预置浏览器链接 / 预置本地资源目录，
 * 每条独立选择打开方式（工作台分栏 / 外部打开）。
 * 领域约定：所有状态只存 localStorage，不读写工作区文件。
 * 密码：浏览器本地存储无法真加密，采用 XOR + Base64 混淆存储（防明文直读/肩窥）；
 * 列表掩码展示、编辑时可见。分栏打开时凭据仅 staged 90 秒供代理注入自动填充，用后即弃。
 * 多账号（v1.1）：每条 url 预置可存多组账号密码（accounts 数组）；
 * 旧单账号字段（account/secret）加载时自动迁入数组首组，不丢数据。
 * 分组文件夹（v1.4）：存档升级为 { entries, folders } 对象——条目 folderId 指向所属文件夹
 * （空串=根层），文件夹 parentId 指向父文件夹（空串=根层），可任意嵌套；
 * 条目可在面板内拖拽移动到其他文件夹。旧版扁平数组存档加载时自动迁移为根层条目，不丢数据。
 */

export type PresetKind = 'url' | 'dir'
export type PresetOpenMode = 'split' | 'external'

/** 一组登录凭据：账号明文 + 混淆存储后的密码（可为空 = 只填了另一项） */
export type PresetAccount = { id: string; user: string; secret: string }

export type PresetEntry = {
  id: string
  kind: PresetKind
  /** 可空：显示时自动取域名 / 目录名 */
  name: string
  /** kind='url'：完整链接（http/https） */
  url: string
  /** kind='dir'：本地目录绝对路径 */
  dirPath: string
  /** 仅 url：登录账号列表（多账号，可空；旧单账号数据加载时自动迁入首组） */
  accounts: PresetAccount[]
  note: string
  /** 所属分组文件夹 id（空串=根层；v1.4 分组管理） */
  folderId: string
  openMode: PresetOpenMode
}

/** 分组文件夹（可嵌套：parentId=父文件夹 id，空串=根层） */
export type PresetFolder = { id: string; name: string; parentId: string }

/** 预置存档（v1.4）：条目 + 文件夹同键存放；旧版扁平数组存档加载时自动迁移 */
export type PresetStore = { entries: PresetEntry[]; folders: PresetFolder[] }

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

/** 旧存档条目 → 当前结构：accounts 必为数组；旧单账号字段（account/secret）自动迁为首组；
 *  显式重建字段（旧存档里的 account/secret 键不带入新对象，保存后自然清除） */
function normalizeEntry(e: any): PresetEntry | null {
  if (!e || typeof e.id !== 'string' || (e.kind !== 'url' && e.kind !== 'dir')) return null
  let accounts: PresetAccount[] = Array.isArray(e.accounts)
    ? e.accounts
        .filter((a: any) => a && typeof a === 'object')
        .map((a: any, i: number) => ({
          id: typeof a.id === 'string' && a.id ? a.id : 'a' + i,
          user: typeof a.user === 'string' ? a.user : '',
          secret: typeof a.secret === 'string' ? a.secret : '',
        }))
    : []
  if (accounts.length === 0 && (e.account || e.secret)) {
    accounts = [{ id: 'a0', user: typeof e.account === 'string' ? e.account : '', secret: typeof e.secret === 'string' ? e.secret : '' }]
  }
  return {
    id: e.id,
    kind: e.kind,
    name: typeof e.name === 'string' ? e.name : '',
    url: typeof e.url === 'string' ? e.url : '',
    dirPath: typeof e.dirPath === 'string' ? e.dirPath : '',
    accounts,
    note: typeof e.note === 'string' ? e.note : '',
    folderId: typeof e.folderId === 'string' ? e.folderId : '',
    openMode: e.openMode === 'external' ? 'external' : 'split',
  }
}

/** 存档行 → PresetFolder：id 非空 + name 为字符串才收（其余字段重建，脏键自然清除） */
function normalizeFolder(f: any): PresetFolder | null {
  if (!f || typeof f.id !== 'string' || !f.id || typeof f.name !== 'string') return null
  return { id: f.id, name: f.name, parentId: typeof f.parentId === 'string' ? f.parentId : '' }
}

export function loadPresets(): PresetStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { entries: [], folders: [] }
    const v = JSON.parse(raw)
    if (Array.isArray(v)) {
      // 旧版扁平数组存档：条目全部迁入根层（folderId 空），不丢数据
      return { entries: v.map(normalizeEntry).filter((e): e is PresetEntry => !!e), folders: [] }
    }
    if (!v || typeof v !== 'object') return { entries: [], folders: [] }
    return {
      entries: Array.isArray(v.entries) ? v.entries.map(normalizeEntry).filter((e): e is PresetEntry => !!e) : [],
      folders: Array.isArray(v.folders) ? v.folders.map(normalizeFolder).filter((f): f is PresetFolder => !!f) : [],
    }
  } catch { return { entries: [], folders: [] } }
}

function persist(store: PresetStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch {}
}

/** 新增或更新（按 id upsert），返回新存档 */
export function savePreset(entry: PresetEntry): PresetStore {
  const store = loadPresets()
  const i = store.entries.findIndex((e) => e.id === entry.id)
  if (i >= 0) store.entries[i] = entry
  else store.entries.push(entry)
  persist(store)
  return store
}

export function removePreset(id: string): PresetStore {
  const store = loadPresets()
  store.entries = store.entries.filter((e) => e.id !== id)
  persist(store)
  return store
}

/** 移动条目到目标文件夹（folderId 空串=移回根层；目标不存在则原地不动） */
export function movePreset(id: string, folderId: string): PresetStore {
  const store = loadPresets()
  if (folderId && !store.folders.some((f) => f.id === folderId)) return store
  store.entries = store.entries.map((e) => (e.id === id ? { ...e, folderId } : e))
  persist(store)
  return store
}

export function newFolderId(): string {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 新建分组文件夹（挂在 parentId 下），返回新存档 */
export function addFolder(name: string, parentId: string): PresetStore {
  const store = loadPresets()
  store.folders.push({ id: newFolderId(), name: name.trim(), parentId })
  persist(store)
  return store
}

export function renameFolder(id: string, name: string): PresetStore {
  const store = loadPresets()
  store.folders = store.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f))
  persist(store)
  return store
}

/** 收集文件夹及其全部子孙文件夹 id（迭代到不再增长，防御存档脏数据成环） */
export function folderSubtreeIds(folders: PresetFolder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (!ids.has(f.id) && ids.has(f.parentId)) { ids.add(f.id); grew = true }
    }
  }
  return ids
}

/** 删除文件夹（连带：子孙文件夹与其下全部条目一并删除），返回新存档 */
export function removeFolderDeep(id: string): PresetStore {
  const store = loadPresets()
  const doomed = folderSubtreeIds(store.folders, id)
  store.folders = store.folders.filter((f) => !doomed.has(f.id))
  store.entries = store.entries.filter((e) => !doomed.has(e.folderId))
  persist(store)
  return store
}

export function newPresetId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function newAccountId(): string {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
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
