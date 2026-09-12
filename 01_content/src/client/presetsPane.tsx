/**
 * 预置资源管理面板（窗口选择器「📌 预置」进入）：
 * 列表展示名称/链接/路径、备注、默认打开方式；新增/编辑/删除；
 * 【打开】按条目 openMode 执行：url → 分栏浏览器窗（staged 自动填充）/ window.open 外部；
 * dir → 分栏资源管理器（rootPath 定位）/ 后端 open-path 唤起系统资源管理器。
 * 视觉复用 custom 系列控件（dsh-wt_customRow/Label/PathInput/ModeBtn），克制不加新轮子。
 */
import { useEffect, useState } from 'react'
import { splitStore, T, postJson, type PaneRow, type BarActions } from './split'
import { isAbs } from './pathutil'
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
        <div className="dsh-wt_customRow">
          <span className="dsh-wt_customLabel">{T('preset.dir')}</span>
          <input
            className="dsh-wt_customPathInput"
            placeholder={T('preset.dirPh')}
            spellCheck={false}
            value={dirPath}
            onChange={(e) => setDirPath(e.target.value)}
          />
        </div>
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
