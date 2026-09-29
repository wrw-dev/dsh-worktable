/**
 * 预置资源管理面板（窗口选择器「📌 预置」进入）：
 * 列表展示名称/链接/路径、备注、默认打开方式；新增/编辑/删除；
 * 【打开】按条目 openMode 执行：url → 分栏浏览器窗（staged 自动填充）/ window.open 外部；
 * dir → 分栏资源管理器（rootPath 定位）/ 后端 open-path 唤起系统资源管理器。
 * 多账号（v1.1）：每条 url 预置可存多组账号密码；分栏打开前 ≥2 组先弹「选择登录账号」，
 * 复制账号/密码 ≥2 组同样先选是哪一组（单组直接用，不弹选）；外部打开不弹选。
 * 分组文件夹（v1.4）：进入式层级浏览——根目录平铺，点文件夹进入下一级，顶部面包屑返回；
 * 「＋ 文件夹」在当前层新建（可任意嵌套）；✎ 重命名；🗑 两步确认连带删除（提示含多少项）。
 * 条目卡片可拖拽（HTML5 原生 DnD）放到文件夹行/面包屑节点上即移动归属；
 * 新增/编辑表单带「所属文件夹」下拉（新增默认当前所在层），不用拖拽也能改归属。
 * 视觉复用 custom 系列控件（dsh-wt_customRow/Label/PathInput/ModeBtn），克制不加新轮子。
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { splitStore, T, postJson, type PaneRow, type BarActions } from './split'
import { isAbs, parentPathOf } from './pathutil'
import {
  loadPresets, savePreset, removePreset, movePreset, addFolder, renameFolder, removeFolderDeep,
  folderSubtreeIds, newPresetId, newAccountId, autoName, originOfPreset,
  protectSecret, revealSecret, maskSecret, stagePresetFill,
  type PresetEntry, type PresetAccount, type PresetKind, type PresetOpenMode,
  type PresetFolder, type PresetStore,
} from './presets'

/** URL 校验/归一：缺协议补 https://；必须能解析为 http(s) URL，非法返回 null */
function normalizePresetUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t || /\s/.test(t)) return null
  const candidate = /^https?:\/\//i.test(t) ? t : 'https://' + t
  try {
    const u = new URL(candidate)
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null
  } catch { return null }
}

/** 账号选择意图：分栏打开选登录账号 / 复制前选是哪一组（field=user 账号、pass 密码） */
type AccountPick =
  | { mode: 'open'; entry: PresetEntry }
  | { mode: 'copy'; entry: PresetEntry; field: 'user' | 'pass'; onLabel?: (a: PresetAccount) => string }

export function PresetsPane(props: { row: PaneRow; index: number; tabId: string; barActions?: BarActions }) {
  const [store, setStore] = useState<PresetStore>(() => loadPresets())
  const [cwd, setCwd] = useState('') // 当前所在文件夹 id（空串=根层）
  const [editing, setEditing] = useState<PresetEntry | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<string>('')
  const [confirmDelFolder, setConfirmDelFolder] = useState<string>('')
  const [folderModal, setFolderModal] = useState<'new' | PresetFolder | null>(null)
  const [dragId, setDragId] = useState('')
  const [dragOver, setDragOver] = useState('')
  const [toast, setToast] = useState('')
  const [pick, setPick] = useState<AccountPick | null>(null)

  // 返回窗格首页（选择器）：关闭预置标签（与工具行 ✕ 等价，仅图标语义不同）
  const backToPicker = () => splitStore.closeTab(props.row, props.index, props.tabId)

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((m) => (m === msg ? '' : m)), 3500)
  }

  /** 有凭据的账号组（user/secret 至少一项非空） */
  const withCred = (e: PresetEntry) => e.accounts.filter((a) => a.user || a.secret)

  // —— 分组文件夹（v1.4）：面包屑链 + 当前层子文件夹/条目 ——
  const folderMap = new Map(store.folders.map((f) => [f.id, f]))
  const crumbs: PresetFolder[] = []
  {
    let cur = cwd ? folderMap.get(cwd) : undefined
    let guard = 0
    while (cur && guard++ < 64) { crumbs.unshift(cur); cur = cur.parentId ? folderMap.get(cur.parentId) : undefined }
  }
  const subFolders = store.folders.filter((f) => f.parentId === cwd)
  const curEntries = store.entries.filter((e) => (e.folderId || '') === cwd)

  /** 文件夹内后代总数（子文件夹 + 全部条目，含嵌套）——计数徽标与删除确认文案用 */
  const deepItemCount = (id: string) => {
    const ids = folderSubtreeIds(store.folders, id)
    return store.folders.filter((f) => ids.has(f.id) && f.id !== id).length
      + store.entries.filter((e) => ids.has(e.folderId || '')).length
  }

  /** 条目拖放：落到文件夹（空串=根层，面包屑节点）即移动归属并提示 */
  const dropEntryTo = (folderId: string) => {
    const id = dragId
    setDragId('')
    setDragOver('')
    if (!id) return
    const target = folderId ? folderMap.get(folderId) : null
    setStore(movePreset(id, folderId))
    flash(T('preset.movedTo', { name: target ? target.name : T('preset.folderRoot') }))
  }

  /** 根层的放置高亮键（'' 与「无悬停」哨兵冲突，用 §root 代指根层） */
  const ROOT_KEY = '§root'
  const dropKeyOf = (folderId: string) => (folderId || ROOT_KEY)

  /** 拖拽放置通用片段（文件夹行 / 面包屑节点共用）：悬停高亮 + 松手移动 */
  const dropProps = (folderId: string) => {
    const key = dropKeyOf(folderId)
    return {
      onDragOver: (ev: DragEvent) => {
        if (!dragId) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'move'
        if (dragOver !== key) setDragOver(key)
      },
      onDragLeave: () => setDragOver((o) => (o === key ? '' : o)),
      onDrop: (ev: DragEvent) => { ev.preventDefault(); dropEntryTo(folderId) },
    }
  }

  /** 分栏打开（已定账号）：staged 自动填充 + 挂浏览器标签。
   *  走 reopenTab：同链接已有标签时强制重挂载 iframe——再点【打开】= 全新登录页（staged 凭据重新注入），
   *  而不是激活旧标签后什么都不发生（v1.3 前用户看到的「打开后没反应/不填充」）。 */
  const doOpenWithAccount = (url: string, acc: PresetAccount | null) => {
    const origin = originOfPreset(url)
    if (origin && acc && (acc.user || acc.secret)) {
      stagePresetFill(origin, acc.user, revealSecret(acc.secret))
      flash(T('preset.fillHint'))
    }
    splitStore.reopenTab(props.row, props.index, { kind: 'builtin', type: 'browser', url })
  }

  const openEntry = (e: PresetEntry) => {
    if (e.kind === 'url') {
      const ok = normalizePresetUrl(e.url)
      if (!ok) { flash(T('preset.errUrl')); return }
      if (e.openMode === 'external') {
        window.open(ok, '_blank', 'noopener')
        return
      }
      const accs = withCred(e)
      if (accs.length >= 2) { setPick({ mode: 'open', entry: e }); return } // 多账号：先选是哪个账号登录
      doOpenWithAccount(ok, accs[0] ?? null)
    } else {
      const p = e.dirPath.trim()
      if (!isAbs(p)) { flash(T('preset.errDir')); return }
      if (e.openMode === 'external') {
        postJson('/api/worktable/open-path', { path: p }).catch(() => {})
        return
      }
      // 工作台分栏：先探测路径类型——文件 → 文件预览标签（MD/PDF/图片/文本），目录 → 资源管理器
      postJson('/api/worktable/fs', { path: p })
        .then((d) => {
          if (d && d.file) {
            splitStore.openTab(props.row, props.index, { kind: 'file', path: p })
            return
          }
          splitStore.openTab(props.row, props.index, { kind: 'builtin', type: 'explorer', rootPath: (d && d.path) || p })
        })
        .catch(() => {
          // 探测失败（路径不存在等）→ 仍挂资源管理器，让窗内显示具体错误
          splitStore.openTab(props.row, props.index, { kind: 'builtin', type: 'explorer', rootPath: p })
        })
    }
  }

  const copyText = async (text: string, tag: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      flash(T('preset.copied') + '：' + (tag || '').trim())
    } catch { flash('✕ ' + tag) }
  }

  /** 复制账号/密码入口：≥2 组先弹选择（选是哪一组），单组直接复制。
   *  toast 标签 = 已选账号名（区分两组同名账号；只存了密码的组显示组序号）。 */
  const startCopy = (e: PresetEntry, field: 'user' | 'pass') => {
    const accs = withCred(e).filter((a) => (field === 'user' ? a.user : a.secret))
    if (accs.length === 0) return
    const labelOf = (a: PresetAccount) => a.user || '#' + (withCred(e).indexOf(a) + 1)
    if (accs.length >= 2) {
      setPick({
        mode: 'copy', entry: e, field,
        onLabel: labelOf,
      })
      return
    }
    void copyText(field === 'user' ? accs[0].user : revealSecret(accs[0].secret), labelOf(accs[0]))
  }

  if (editing) {
    return (
      <PresetForm
        initial={editing === 'new' ? null : editing}
        folderId={cwd}
        onDone={(next) => { setStore(next); setEditing(null) }}
        onCancel={() => setEditing(null)}
        onBack={backToPicker}
      />
    )
  }

  return (
    <div className="dsh-wt_presetWrap">
      <div className="dsh-wt_presetHead">
        <button
          type="button"
          className="dsh-wt_presetBack"
          title={T('preset.back')}
          aria-label={T('preset.back')}
          onClick={backToPicker}
        >⌂</button>
        <span className="dsh-wt_barTitle">📌 {T('pane.presets')}</span>
        <div className="dsh-wt_presetHeadBtns">
          <button type="button" className="dsh-wt_presetBtn" onClick={() => setFolderModal('new')}>{T('preset.folderAdd')}</button>
          <button type="button" className="dsh-wt_presetAdd" onClick={() => setEditing('new')}>{T('preset.add')}</button>
        </div>
      </div>
      <div className="dsh-wt_presetCrumbs">
        <button
          type="button"
          className={'dsh-wt_presetCrumb' + (cwd === '' ? ' on' : '') + (dragOver === ROOT_KEY ? ' dsh-wt_presetCrumbDrop' : '')}
          onClick={() => setCwd('')}
          {...dropProps('')}
        >{T('preset.folderRoot')}</button>
        {crumbs.map((c) => (
          <button
            key={c.id}
            type="button"
            className={'dsh-wt_presetCrumb' + (cwd === c.id ? ' on' : '') + (dragOver === dropKeyOf(c.id) ? ' dsh-wt_presetCrumbDrop' : '')}
            title={c.name}
            onClick={() => setCwd(c.id)}
            {...dropProps(c.id)}
          >› {c.name}</button>
        ))}
      </div>
      <div className="dsh-wt_presetList">
        {subFolders.length === 0 && curEntries.length === 0 && !toast && (
          <p className="dsh-wt_presetHint">{cwd === '' ? T('preset.empty') : T('preset.folderEmpty')}</p>
        )}
        {subFolders.map((f) => (
          <div
            key={f.id}
            className={'dsh-wt_presetFolder' + (dragOver === dropKeyOf(f.id) ? ' dsh-wt_presetFolderDrop' : '')}
            onClick={() => setCwd(f.id)}
            {...dropProps(f.id)}
          >
            <span className="dsh-wt_presetIcon" aria-hidden>📁</span>
            <span className="dsh-wt_presetName" title={f.name}>{f.name}</span>
            <span className="dsh-wt_presetCount" title={T('preset.folderCount', { n: String(deepItemCount(f.id)) })}>{deepItemCount(f.id)}</span>
            <button
              type="button"
              className="dsh-wt_presetCopy"
              title={T('preset.folderRename')}
              onClick={(ev) => { ev.stopPropagation(); setFolderModal(f) }}
            >✎</button>
            {confirmDelFolder === f.id ? (
              <button
                type="button"
                className="dsh-wt_presetCopy dsh-wt_presetDelDanger"
                title={T('preset.folderDel')}
                onClick={(ev) => { ev.stopPropagation(); setStore(removeFolderDeep(f.id)); setConfirmDelFolder('') }}
              >{T('preset.folderDelConfirm', { n: String(deepItemCount(f.id)) })}</button>
            ) : (
              <button
                type="button"
                className="dsh-wt_presetCopy"
                title={T('preset.folderDel')}
                onClick={(ev) => {
                  ev.stopPropagation()
                  setConfirmDelFolder(f.id)
                  window.setTimeout(() => setConfirmDelFolder((c) => (c === f.id ? '' : c)), 3000)
                }}
              >🗑</button>
            )}
          </div>
        ))}
        {curEntries.map((e) => {
          const accs = withCred(e)
          const single = accs.length === 1 ? accs[0] : null
          return (
            <div
              key={e.id}
              className={'dsh-wt_presetCard' + (dragId === e.id ? ' dsh-wt_presetCardDrag' : '')}
              draggable
              onDragStart={(ev) => {
                setDragId(e.id)
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', e.id)
              }}
              onDragEnd={() => { setDragId(''); setDragOver('') }}
            >
              <div className="dsh-wt_presetRow1">
                <span className="dsh-wt_presetIcon" aria-hidden>{e.kind === 'url' ? '🌐' : '📁'}</span>
                <span className="dsh-wt_presetName" title={e.name}>{e.name || autoName(e.kind, e.url, e.dirPath)}</span>
                <span
                  className={'dsh-wt_presetBadge' + (e.openMode === 'external' ? ' dsh-wt_presetBadgeExt' : '')}
                  title={e.openMode === 'split' ? T('preset.modeSplit') : T('preset.modeExternal')}
                >{e.openMode === 'split' ? T('preset.modeSplit') : T('preset.modeExternal')}</span>
              </div>
              <div className="dsh-wt_presetTarget" title={e.kind === 'url' ? e.url : e.dirPath}>
                {e.kind === 'url' ? e.url : e.dirPath}
              </div>
              {accs.length > 0 && (
                <div className="dsh-wt_presetRow1">
                  <span
                    className="dsh-wt_presetSecret"
                    title={single ? (single.user || '—') + ' / ' + (single.secret ? maskSecret(single.secret) : '—') : accs.map((a) => a.user || '—').join('、')}
                  >{single
                    ? (single.user ? single.user + ' / ' + maskSecret(single.secret) : maskSecret(single.secret))
                    : T('preset.multiAccounts', { n: String(accs.length) })}</span>
                  <button type="button" className="dsh-wt_presetCopy" disabled={!accs.some((a) => a.user)} title={T('preset.copyAccount')} onClick={() => startCopy(e, 'user')}>{T('preset.copyAccount')}</button>
                  <button type="button" className="dsh-wt_presetCopy" disabled={!accs.some((a) => a.secret)} title={T('preset.copyPassword')} onClick={() => startCopy(e, 'pass')}>{T('preset.copyPassword')}</button>
                </div>
              )}
              {e.note && <div className="dsh-wt_presetNote" title={e.note}>{e.note}</div>}
              <div className="dsh-wt_presetActs">
                <button type="button" className="dsh-wt_presetBtnPrimary" onClick={() => openEntry(e)}>{T('preset.open')}</button>
                <button type="button" className="dsh-wt_presetBtn" onClick={() => setEditing(e)}>{T('preset.edit')}</button>
                {confirmDel === e.id ? (
                  <button
                    type="button"
                    className="dsh-wt_presetBtn dsh-wt_presetBtnDanger"
                    onClick={() => { setStore(removePreset(e.id)); setConfirmDel('') }}
                  >{T('preset.del')}?</button>
                ) : (
                  <button type="button" className="dsh-wt_presetBtn" onClick={() => { setConfirmDel(e.id); window.setTimeout(() => setConfirmDel((c) => (c === e.id ? '' : c)), 3000) }}>{T('preset.del')}</button>
                )}
              </div>
            </div>
          )
        })}
        {toast && <p className="dsh-wt_presetToast">{toast}</p>}
      </div>
      {folderModal && (
        <FolderNameModal
          title={folderModal === 'new' ? T('preset.folderNewTitle') : T('preset.folderRenameTitle')}
          initial={folderModal === 'new' ? '' : folderModal.name}
          onSubmit={(name) => {
            const cur = folderModal
            setFolderModal(null)
            const trimmed = name.trim()
            if (!trimmed) return
            setStore(cur === 'new' ? addFolder(trimmed, cwd) : renameFolder(cur.id, trimmed))
          }}
          onClose={() => setFolderModal(null)}
        />
      )}
      {pick && (pick.mode === 'open' ? (
        <AccountPickerModal
          accounts={withCred(pick.entry)}
          title={T('preset.pickAccountTitle')}
          onPick={(a) => {
            const entry = pick.entry
            setPick(null)
            const ok = normalizePresetUrl(entry.url)
            if (!ok) { flash(T('preset.errUrl')); return }
            doOpenWithAccount(ok, a)
          }}
          onClose={() => setPick(null)}
        />
      ) : (
        <AccountPickerModal
          accounts={withCred(pick.entry).filter((a) => (pick.field === 'user' ? a.user : a.secret))}
          title={T('preset.pickAccountTitle')}
          hint={T('preset.pickAccountCopyHint')}
          onPick={(a) => {
            const field = pick.field
            const onLabel = pick.onLabel
            setPick(null)
            const tag = onLabel ? onLabel(a) : (a.user || '')
            void copyText(field === 'user' ? a.user : revealSecret(a.secret), tag)
          }}
          onClose={() => setPick(null)}
        />
      ))}
    </div>
  )
}

/** 账号选择弹窗（portal + z-index 6000，复用 pathPicker 弹层骨架）：
 *  分栏打开 ≥2 组账号时选是哪个账号登录；复制账号/密码 ≥2 组时选是哪一组。 */
function AccountPickerModal(props: {
  accounts: PresetAccount[]
  title: string
  hint?: string
  onPick: (a: PresetAccount) => void
  onClose: () => void
}) {
  return createPortal(
    <>
      <div className="dsh-wt_pathPickerBackdrop" onClick={props.onClose} />
      <div className="dsh-wt_pathPicker dsh-wt_accPick" role="dialog" aria-label={props.title}>
        <div className="dsh-wt_pathPickerHead">
          <span className="dsh-wt_pathPickerTitle">{props.title}</span>
          <button type="button" className="dsh-wt_presetBack" title={T('preset.cancel')} aria-label={T('preset.cancel')} onClick={props.onClose}>✕</button>
        </div>
        {props.hint && <p className="dsh-wt_presetHint dsh-wt_accPickHint">{props.hint}</p>}
        <div className="dsh-wt_pathPickerList">
          {props.accounts.map((a, i) => (
            <button key={a.id} type="button" className="dsh-wt_subRow dsh-wt_accPickRow" onClick={() => props.onPick(a)}>
              <span className="dsh-wt_subIcon" aria-hidden>👤</span>
              <span className="dsh-wt_subName">{a.user || T('preset.accountNoUser') + ' #' + (i + 1)}</span>
              <span className="dsh-wt_accPickMask">{a.secret ? maskSecret(a.secret) : '—'}</span>
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}

/** 文件夹新建/重命名弹窗（portal + pathPicker 弹层骨架）：单个名称输入，Enter=保存 */
function FolderNameModal(props: { title: string; initial: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(props.initial)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  return createPortal(
    <>
      <div className="dsh-wt_pathPickerBackdrop" onClick={props.onClose} />
      <div className="dsh-wt_pathPicker dsh-wt_folderModal" role="dialog" aria-label={props.title}>
        <div className="dsh-wt_pathPickerHead">
          <span className="dsh-wt_pathPickerTitle">{props.title}</span>
          <button type="button" className="dsh-wt_presetBack" title={T('preset.cancel')} aria-label={T('preset.cancel')} onClick={props.onClose}>✕</button>
        </div>
        <div className="dsh-wt_folderModalBody">
          <input
            ref={inputRef}
            className="dsh-wt_customPathInput"
            placeholder={T('preset.folderNamePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') props.onSubmit(name) }}
          />
          <div className="dsh-wt_pathPickerBtns">
            <button type="button" className="dsh-wt_presetBtn" onClick={props.onClose}>{T('preset.cancel')}</button>
            <button type="button" className="dsh-wt_presetBtnPrimary" onClick={() => props.onSubmit(name)}>{T('preset.save')}</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

/** 新增/编辑表单：类型二选一 + 基础信息 + 打开方式；URL/路径前端校验，目录路径异步查存在性；
 *  多账号：账号/密码以行为组编辑（＋添加账号 / ✕ 删行），全空行不保存。
 *  所属文件夹（v1.4）：下拉选归属（新增默认当前所在层），不用拖拽也能改。 */
function PresetForm(props: { initial: PresetEntry | null; folderId: string; onDone: (store: PresetStore) => void; onCancel: () => void; onBack?: () => void }) {
  const init = props.initial
  const [kind, setKind] = useState<PresetKind>(init?.kind ?? 'url')
  const [name, setName] = useState(init?.name ?? '')
  const [url, setUrl] = useState(init?.url ?? '')
  const [accounts, setAccounts] = useState<PresetAccount[]>(() => {
    const rows = (init?.accounts ?? []).filter((a) => a.user || a.secret)
    return rows.length > 0 ? rows : [{ id: newAccountId(), user: '', secret: '' }]
  })
  const [dirPath, setDirPath] = useState(init?.dirPath ?? '')
  const [note, setNote] = useState(init?.note ?? '')
  const [openMode, setOpenMode] = useState<PresetOpenMode>(init?.openMode ?? 'split')
  const [folderId, setFolderId] = useState(init ? (init.folderId || '') : (props.folderId || ''))
  const [err, setErr] = useState('')

  // 所属文件夹选项：根层 + 全部文件夹（按层级全角空格缩进；列表小，直接渲染时计算，depth 上限防脏数据成环）
  const folderRows = (() => {
    const folders = loadPresets().folders
    const byId = new Map(folders.map((f) => [f.id, f]))
    return folders.map((f) => {
      let cur = f
      let depth = 0
      while (cur.parentId && byId.has(cur.parentId) && depth < 64) { cur = byId.get(cur.parentId)!; depth++ }
      return { id: f.id, name: f.name, depth }
    })
  })()
  const [warn, setWarn] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const updateAcc = (id: string, patch: Partial<PresetAccount>) =>
    setAccounts((rows) => rows.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const removeAcc = (id: string) => setAccounts((rows) => rows.filter((a) => a.id !== id))
  const addAcc = () => setAccounts((rows) => [...rows, { id: newAccountId(), user: '', secret: '' }])

  // 目录存在性软校验（400ms 防抖）：不存在仅警告，不阻止保存
  useEffect(() => {
    if (kind !== 'dir' || !dirPath.trim() || !isAbs(dirPath.trim())) { setWarn(''); return }
    let alive = true
    const t = window.setTimeout(() => {
      postJson('/api/worktable/fs', { path: dirPath.trim() })
        .then((d) => { if (alive) setWarn(d && !d.error && d.path ? '' : T('preset.warnDirMissing')) })
        .catch(() => { if (alive) setWarn(T('preset.warnDirMissing')) })
    }, 400)
    return () => { alive = false; window.clearTimeout(t) }
  }, [dirPath, kind])

  const submit = () => {
    setErr('')
    if (kind === 'url') {
      const ok = normalizePresetUrl(url)
      if (!ok) { setErr(T('preset.errUrl')); return }
      const entry: PresetEntry = {
        id: init?.id ?? newPresetId(),
        kind,
        name: name.trim(),
        url: ok,
        accounts: accounts
          .map((a) => ({ id: a.id, user: a.user.trim(), secret: a.secret }))
          .filter((a) => a.user || a.secret),
        note: note.trim(),
        folderId,
        openMode,
      }
      props.onDone(savePreset(entry))
      return
    }
    const p = dirPath.trim()
    if (!isAbs(p)) { setErr(T('preset.errDir')); return }
    const entry: PresetEntry = {
      id: init?.id ?? newPresetId(),
      kind,
      name: name.trim(),
      url: '',
      dirPath: p,
      accounts: [],
      note: note.trim(),
      folderId,
      openMode,
    }
    props.onDone(savePreset(entry))
  }

  const modeBtn = (m: PresetOpenMode, label: string) => (
    <button
      type="button"
      className={'dsh-wt_customModeBtn' + (openMode === m ? ' dsh-wt_customModeBtnOn' : '')}
      onClick={() => setOpenMode(m)}
    >{label}</button>
  )

  return (
    <div className="dsh-wt_presetForm">
      <div className="dsh-wt_presetHead">
        {props.onBack && (
          <button
            type="button"
            className="dsh-wt_presetBack"
            title={T('preset.back')}
            aria-label={T('preset.back')}
            onClick={props.onBack}
          >⌂</button>
        )}
        <span className="dsh-wt_barTitle">📌 {init ? T('preset.edit') : T('preset.add')}</span>
      </div>
      <div className="dsh-wt_customRow">
        <span className="dsh-wt_customLabel">{T('preset.type')}</span>
        <div className="dsh-wt_customModes" style={{ flex: 1 }}>
          <button
            type="button"
            className={'dsh-wt_customModeBtn' + (kind === 'url' ? ' dsh-wt_customModeBtnOn' : '')}
            onClick={() => setKind('url')}
          >{T('preset.typeUrl')}</button>
          <button
            type="button"
            className={'dsh-wt_customModeBtn' + (kind === 'dir' ? ' dsh-wt_customModeBtnOn' : '')}
            onClick={() => setKind('dir')}
          >{T('preset.typeDir')}</button>
        </div>
      </div>
      <div className="dsh-wt_customRow">
        <span className="dsh-wt_customLabel">{T('preset.name')}</span>
        <input
          className="dsh-wt_customPathInput"
          placeholder={kind === 'url' ? T('preset.namePhUrl') : T('preset.namePhDir')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="dsh-wt_customRow">
        <span className="dsh-wt_customLabel">{T('preset.folderOf')}</span>
        <select
          className="dsh-wt_customPathInput"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">{T('preset.folderRoot')}</option>
          {folderRows.map((f) => (
            <option key={f.id} value={f.id}>{'　'.repeat(f.depth) + f.name}</option>
          ))}
        </select>
      </div>
      {kind === 'url' ? (
        <>
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('preset.url')}</span>
            <input
              className="dsh-wt_customPathInput"
              placeholder={T('preset.urlPh')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="dsh-wt_customRow" style={{ alignItems: 'flex-start' }}>
            <span className="dsh-wt_customLabel" style={{ paddingTop: 6 }}>{T('preset.account')}</span>
            <div className="dsh-wt_accRows" style={{ flex: 1 }}>
              {accounts.map((a) => (
                <div key={a.id} className="dsh-wt_accRow">
                  <input
                    className="dsh-wt_customPathInput"
                    placeholder={T('preset.accountPh')}
                    autoComplete="off"
                    value={a.user}
                    onChange={(e) => updateAcc(a.id, { user: e.target.value })}
                  />
                  <input
                    className="dsh-wt_customPathInput"
                    type="password"
                    placeholder={T('preset.passwordPh')}
                    autoComplete="new-password"
                    value={revealSecret(a.secret)}
                    onChange={(e) => updateAcc(a.id, { secret: protectSecret(e.target.value) })}
                  />
                  {accounts.length > 1 && (
                    <button
                      type="button"
                      className="dsh-wt_accDel"
                      title={T('preset.removeAccount')}
                      aria-label={T('preset.removeAccount')}
                      onClick={() => removeAcc(a.id)}
                    >✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="dsh-wt_accAdd" onClick={addAcc}>{T('preset.addAccount')}</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('preset.dir')}</span>
            <input
              className="dsh-wt_customPathInput"
              placeholder={T('preset.dirPh')}
              spellCheck={false}
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
            />
            <button
              type="button"
              className="dsh-wt_presetBrowse"
              title={T('preset.browse')}
              aria-label={T('preset.browse')}
              onClick={() => setPickerOpen(true)}
            >📂</button>
          </div>
          {pickerOpen && (
            <PathPickerModal
              initial={dirPath.trim()}
              onPick={(p) => { setDirPath(p); setPickerOpen(false) }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
      <div className="dsh-wt_customRow">
        <span className="dsh-wt_customLabel">{T('preset.openMode')}</span>
        <div className="dsh-wt_customModes" style={{ flex: 1 }}>
          {modeBtn('split', T('preset.modeSplit'))}
          {modeBtn('external', T('preset.modeExternal'))}
        </div>
      </div>
      {kind === 'url' && openMode === 'external' && <p className="dsh-wt_presetHint">{T('preset.externalHint')}</p>}
      {kind === 'url' && openMode === 'split' && <p className="dsh-wt_presetHint">{T('preset.hintFillLimit')}</p>}
      <div className="dsh-wt_customRow">
        <span className="dsh-wt_customLabel">{T('preset.note')}</span>
        <input
          className="dsh-wt_customPathInput"
          placeholder={T('preset.notePh')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {warn && <p className="dsh-wt_presetWarn">{warn}</p>}
      {err && <p className="dsh-wt_presetErr">{err}</p>}
      <div className="dsh-wt_customRow">
        <button type="button" className="dsh-wt_presetBtnPrimary" onClick={submit}>{T('preset.save')}</button>
        <button type="button" className="dsh-wt_presetBtn" onClick={props.onCancel}>{T('preset.cancel')}</button>
      </div>
    </div>
  )
}

/** 本地资源路径选择弹窗（fixed 居中模态）：面包屑导航 + 文件/目录列表；
 *  数据走既有 /api/worktable/fs（文件目录混合，isDir 标注）；目录行点击=进入，
 *  文件行点击=直接选定；「选择当前目录」把当前目录整条路径回填表单。
 *  initial 语义：合法已填路径 → 文件取父目录、目录取自身作为起始目录；其余回退服务端默认（会话 cwd）。 */
function PathPickerModal(props: { initial: string; onPick: (p: string) => void; onClose: () => void }) {
  // 初始目录推导（纯客户端，不发请求）：非空且绝对 → 交给服务端探测（文件自动落父目录）；
  // 否则不带 path，让服务端用会话 cwd 兜底
  const startPath = (() => {
    const p = props.initial
    if (!p || !isAbs(p)) return ''
    return p
  })()

  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string; isDir: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [drives, setDrives] = useState<string[]>([])
  const seqRef = useRef(0)

  const load = (p: string) => {
    const seq = ++seqRef.current
    setLoading(true)
    setLoadErr('')
    postJson('/api/worktable/fs', p ? { path: p } : {})
      .then((d) => {
        if (seq !== seqRef.current) return // 过期响应（已被后续导航取代）
        if (d && d.file && typeof d.path === 'string' && d.path) {
          // 初始是文件：/fs 回 { file:true, entries:[] }——自动落到父目录浏览
          load(parentPathOf(d.path))
          return
        }
        setLoading(false)
        if (!d || d.error || !Array.isArray(d.entries)) {
          // /fs 对不存在路径回 500 { error }：展示错误但保留面包屑可回上级
          setLoadErr((d && d.error) ? String(d.error) : T('preset.pickErr'))
          return
        }
        setCwd(d.path || p)
        setEntries(d.entries)
        setTruncated(!!d.truncated)
      })
      .catch(() => { if (seq === seqRef.current) { setLoading(false); setLoadErr(T('preset.pickErr')) } })
  }

  useEffect(() => {
    load(startPath)
    // 盘符列表（服务端枚举；失败静默——盘符条只是快捷入口，坏了不影响手填与导航）
    postJson('/api/worktable/drives', {}).then((d) => { if (d && Array.isArray(d.drives)) setDrives(d.drives) }).catch(() => {})
  }, [])

  // 面包屑：从盘符/UNC 根到当前目录的祖先链（parentPathOf 逐级上溯；根处停）
  const crumbs = (() => {
    if (!cwd) return [] as { name: string; path: string }[]
    const chain: { name: string; path: string }[] = []
    let cur = cwd
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      chain.unshift({ name: cur.endsWith('\\') || cur.endsWith('/') ? cur : cur.split(/[\\/]/).filter(Boolean).pop() || cur, path: cur })
      const parent = parentPathOf(cur)
      if (parent === cur) break
      cur = parent
    }
    return chain
  })()

  return createPortal(
    <>
      <div className="dsh-wt_pathPickerBackdrop" onClick={props.onClose} />
      <div className="dsh-wt_pathPicker" role="dialog" aria-label={T('preset.pickTitle')}>
        <div className="dsh-wt_pathPickerHead">
          <span className="dsh-wt_pathPickerTitle">{T('preset.pickTitle')}</span>
          <button type="button" className="dsh-wt_presetBack" title={T('preset.cancel')} aria-label={T('preset.cancel')} onClick={props.onClose}>✕</button>
        </div>
        {drives.length > 0 && (
          <div className="dsh-wt_pathPickerDrives">
            {drives.map((d) => (
              <button
                key={d}
                type="button"
                className={'dsh-wt_pathPickerDrive' + (cwd && (cwd.toUpperCase().startsWith(d + ':') || cwd === d) ? ' on' : '')}
                title={d + ':\\'}
                onClick={() => load(d + ':\\')}
              >{d}</button>
            ))}
          </div>
        )}
        <div className="dsh-wt_pathPickerCrumbs">
          <button type="button" className="dsh-wt_pathPickerCrumb" onClick={() => load('')}>{T('preset.pickRoot')}</button>
          {crumbs.map((c) => (
            <button key={c.path} type="button" className="dsh-wt_pathPickerCrumb" title={c.path} onClick={() => load(c.path)}>{c.name}</button>
          ))}
        </div>
        <div className="dsh-wt_pathPickerList">
          {loading && <p className="dsh-wt_subEmpty">{T('preset.pickLoading')}</p>}
          {!loading && loadErr && (
            <>
              <p className="dsh-wt_presetErr">{loadErr}</p>
              {cwd && (
                <button type="button" className="dsh-wt_subRow" onClick={() => load(parentPathOf(cwd))}>
                  <span className="dsh-wt_subIcon" aria-hidden>⬆</span>
                  <span className="dsh-wt_subName">{T('preset.pickUp')}</span>
                </button>
              )}
            </>
          )}
          {!loading && !loadErr && entries.length === 0 && <p className="dsh-wt_subEmpty">{T('preset.pickEmpty')}</p>}
          {!loading && !loadErr && entries.map((e) => (
            <button
              key={e.path}
              type="button"
              className="dsh-wt_subRow"
              title={e.path}
              onClick={() => { if (e.isDir) load(e.path); else props.onPick(e.path) }}
            >
              <span className="dsh-wt_subIcon" aria-hidden>{e.isDir ? '📁' : '📄'}</span>
              <span className="dsh-wt_subName">{e.name}</span>
              {e.isDir && <span className="dsh-wt_subTag">{T('preset.pickDirTag')}</span>}
            </button>
          ))}
          {!loading && !loadErr && truncated && <p className="dsh-wt_pathPickerTrunc">{T('preset.pickTruncated')}</p>}
        </div>
        <div className="dsh-wt_pathPickerFoot">
          <span className="dsh-wt_pathPickerCwd" title={cwd}>{cwd || '—'}</span>
          <div className="dsh-wt_pathPickerBtns">
            <button
              type="button"
              className="dsh-wt_pathPickerUp"
              disabled={!cwd}
              title={T('preset.pickUp')}
              onClick={() => { if (cwd) load(parentPathOf(cwd)) }}
            >⬆ {T('preset.pickUp')}</button>
            <button
              type="button"
              className="dsh-wt_presetBtnPrimary"
              disabled={!cwd}
              onClick={() => { if (cwd) props.onPick(cwd) }}
            >{T('preset.pickSelectDir')}</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
