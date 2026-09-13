/**
 * 预置资源管理面板（窗口选择器「📌 预置」进入）：
 * 列表展示名称/链接/路径、备注、默认打开方式；新增/编辑/删除；
 * 【打开】按条目 openMode 执行：url → 分栏浏览器窗（staged 自动填充）/ window.open 外部；
 * dir → 分栏资源管理器（rootPath 定位）/ 后端 open-path 唤起系统资源管理器。
 * 视觉复用 custom 系列控件（dsh-wt_customRow/Label/PathInput/ModeBtn），克制不加新轮子。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { splitStore, T, postJson, type PaneRow, type BarActions } from './split'
import { isAbs, parentPathOf } from './pathutil'
import {
  loadPresets, savePreset, removePreset, newPresetId, autoName, originOfPreset,
  protectSecret, revealSecret, maskSecret, stagePresetFill,
  type PresetEntry, type PresetKind, type PresetOpenMode,
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

export function PresetsPane(props: { row: PaneRow; index: number; tabId: string; barActions?: BarActions }) {
  const [list, setList] = useState<PresetEntry[]>(() => loadPresets())
  const [editing, setEditing] = useState<PresetEntry | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<string>('')
  const [toast, setToast] = useState('')

  // 返回窗格首页（选择器）：关闭预置标签（与工具行 ✕ 等价，仅图标语义不同）
  const backToPicker = () => splitStore.closeTab(props.row, props.index, props.tabId)

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((m) => (m === msg ? '' : m)), 3500)
  }

  const openEntry = (e: PresetEntry) => {
    if (e.kind === 'url') {
      const ok = normalizePresetUrl(e.url)
      if (!ok) { flash(T('preset.errUrl')); return }
      if (e.openMode === 'external') {
        window.open(ok, '_blank', 'noopener')
        return
      }
      const origin = originOfPreset(ok)
      if (origin && (e.account || e.secret)) {
        stagePresetFill(origin, e.account, revealSecret(e.secret))
        flash(T('preset.fillHint'))
      }
      splitStore.openTab(props.row, props.index, { kind: 'builtin', type: 'browser', url: ok })
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
      flash(T('preset.copied') + '：' + tag)
    } catch { flash('✕ ' + tag) }
  }

  if (editing) {
    return (
      <PresetForm
        initial={editing === 'new' ? null : editing}
        onDone={(next) => { setList(next); setEditing(null) }}
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
        <button type="button" className="dsh-wt_presetAdd" onClick={() => setEditing('new')}>{T('preset.add')}</button>
      </div>
      <div className="dsh-wt_presetList">
        {list.length === 0 && !toast && <p className="dsh-wt_presetHint">{T('preset.empty')}</p>}
        {list.map((e) => (
          <div key={e.id} className="dsh-wt_presetCard">
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
            {e.kind === 'url' && (e.account || e.secret) && (
              <div className="dsh-wt_presetRow1">
                <span className="dsh-wt_presetSecret">{e.account ? e.account + ' / ' + maskSecret(e.secret) : maskSecret(e.secret)}</span>
                <button type="button" className="dsh-wt_presetCopy" disabled={!e.account} title={T('preset.copyAccount')} onClick={() => copyText(e.account, T('preset.copyAccount'))}>{T('preset.copyAccount')}</button>
                <button type="button" className="dsh-wt_presetCopy" disabled={!e.secret} title={T('preset.copyPassword')} onClick={() => copyText(revealSecret(e.secret), T('preset.copyPassword'))}>{T('preset.copyPassword')}</button>
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
                  onClick={() => { setList(removePreset(e.id)); setConfirmDel('') }}
                >{T('preset.del')}?</button>
              ) : (
                <button type="button" className="dsh-wt_presetBtn" onClick={() => { setConfirmDel(e.id); window.setTimeout(() => setConfirmDel((c) => (c === e.id ? '' : c)), 3000) }}>{T('preset.del')}</button>
              )}
            </div>
          </div>
        ))}
        {toast && <p className="dsh-wt_presetToast">{toast}</p>}
      </div>
    </div>
  )
}

/** 新增/编辑表单：类型二选一 + 基础信息 + 打开方式；URL/路径前端校验，目录路径异步查存在性 */
function PresetForm(props: { initial: PresetEntry | null; onDone: (list: PresetEntry[]) => void; onCancel: () => void; onBack?: () => void }) {
  const init = props.initial
  const [kind, setKind] = useState<PresetKind>(init?.kind ?? 'url')
  const [name, setName] = useState(init?.name ?? '')
  const [url, setUrl] = useState(init?.url ?? '')
  const [account, setAccount] = useState(init?.account ?? '')
  const [pass, setPass] = useState(revealSecret(init?.secret ?? ''))
  const [dirPath, setDirPath] = useState(init?.dirPath ?? '')
  const [note, setNote] = useState(init?.note ?? '')
  const [openMode, setOpenMode] = useState<PresetOpenMode>(init?.openMode ?? 'split')
  const [err, setErr] = useState('')
  const [warn, setWarn] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

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
        account: account.trim(),
        secret: protectSecret(pass),
        note: note.trim(),
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
      account: '',
      secret: '',
      note: note.trim(),
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
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('preset.account')}</span>
            <input
              className="dsh-wt_customPathInput"
              placeholder={T('preset.accountPh')}
              autoComplete="off"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </div>
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('preset.password')}</span>
            <input
              className="dsh-wt_customPathInput"
              type="password"
              placeholder={T('preset.passwordPh')}
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
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
