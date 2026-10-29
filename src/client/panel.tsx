/** 设置页「自定义命令」分区：命令卡片列表 + 单卡行内编辑；每次保存/删除都整表写回服务端。 */
import { useEffect, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { LocaleKey } from './locales.ts'

type T = (key: LocaleKey, params?: Record<string, unknown>) => string

interface Draft {
  name: string
  aliases: string
  description: string
  type: 'prompt' | 'exec' | 'alias'
  prompt: string
  target: string
  command: string
  cwd: string
  timeoutMs: string
  passEnv: string
}

interface ApiError { index?: number; field?: string; code: string; message: string }

const blank = (): Draft => ({ name: '', aliases: '', description: '', type: 'prompt', prompt: '', target: '', command: '', cwd: '', timeoutMs: '', passEnv: '' })

const toDraft = (c: Record<string, unknown>): Draft => ({
  name: String(c.name ?? ''),
  aliases: Array.isArray(c.aliases) ? c.aliases.join(', ') : '',
  description: String(c.description ?? ''),
  type: c.type === 'exec' || c.type === 'alias' ? c.type : 'prompt',
  prompt: String(c.prompt ?? ''),
  target: String(c.target ?? ''),
  command: String(c.command ?? ''),
  cwd: c.cwd === undefined || c.cwd === 'workspace' ? '' : String(c.cwd),
  timeoutMs: c.timeoutMs === undefined || c.timeoutMs === 30000 ? '' : String(c.timeoutMs),
  passEnv: Array.isArray(c.passEnv) ? c.passEnv.join(', ') : '',
})

/** 空字符串省略，交给服务端补默认值；timeoutMs 非数字原样发出，由服务端报 range。 */
function toWire(d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: d.name.trim(),
    aliases: d.aliases.split(',').map(s => s.trim()).filter(s => s !== ''),
    description: d.description,
    type: d.type,
  }
  if (d.type === 'prompt') out.prompt = d.prompt
  else if (d.type === 'alias') out.target = d.target.trim()
  else {
    out.command = d.command
    if (d.cwd.trim() !== '') out.cwd = d.cwd.trim()
    if (d.timeoutMs.trim() !== '') out.timeoutMs = Number(d.timeoutMs)
    const passEnv = d.passEnv.split(',').map(s => s.trim()).filter(s => s !== '')
    if (passEnv.length > 0) out.passEnv = passEnv
  }
  return out
}

const aliasList = (d: Draft): string[] => d.aliases.split(',').map(s => s.trim()).filter(s => s !== '')

type SaveResult = { ok: true } | { ok: false; errors: ApiError[]; text?: string }

async function saveAll(commands: Draft[], t: T): Promise<SaveResult> {
  try {
    const res = await fetch('/api/dsh-slash-command/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands: commands.map(toWire) }),
    })
    const body = await res.json() as { ok: boolean; errors?: ApiError[] }
    if (res.ok && body.ok) return { ok: true }
    if (res.status === 400) return { ok: false, errors: body.errors ?? [] }
    return { ok: false, errors: [], text: t('saveFailed', { detail: `HTTP ${res.status}` }) }
  } catch (e) {
    return { ok: false, errors: [], text: t('saveFailed', { detail: e instanceof Error ? e.message : String(e) }) }
  }
}

const TYPES = ['prompt', 'exec', 'alias'] as const

/** 打开中的编辑卡：`index` 为 undefined 表示新增。 */
interface Editing { index: number | undefined; draft: Draft }

export function SlashCommandSection({ t }: { t: T }): ReactElement {
  const [commands, setCommands] = useState<Draft[] | null>(null)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [editing, setEditing] = useState<Editing | undefined>()
  const [deleting, setDeleting] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<ApiError[]>([])
  const [failure, setFailure] = useState<string | undefined>()
  const [announce, setAnnounce] = useState('')

  const load = (): void => {
    setLoadError(undefined)
    fetch('/api/dsh-slash-command/read', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json() as { ok: boolean; commands?: Record<string, unknown>[]; errors?: ApiError[] }
        if (!res.ok || !body.ok) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`)
        setCommands((body.commands ?? []).map(toDraft))
      })
      .catch((e: unknown) => { setLoadError(t('loadFailed', { detail: e instanceof Error ? e.message : String(e) })) })
  }
  useEffect(load, [])

  const reset = (): void => { setErrors([]); setFailure(undefined); setAnnounce('') }
  const openEditor = (next: Editing | undefined): void => { reset(); setDeleting(undefined); setEditing(next) }

  const commit = async (next: Draft[], target: number): Promise<boolean> => {
    setBusy(true)
    reset()
    const result = await saveAll(next, t)
    setBusy(false)
    if (result.ok) {
      setCommands(next)
      setAnnounce(t('saved'))
      return true
    }
    // 只有当前卡片的字段错误能就地显示；其余（理论上不会出现）并入卡片顶部的失败行。
    setErrors(result.errors.filter(e => e.index === target && e.field !== undefined))
    const stray = result.errors.filter(e => e.index !== target || e.field === undefined)
    setFailure(result.text ?? (stray.length > 0 ? t('saveFailed', { detail: stray.map(e => e.message).join('; ') }) : undefined))
    return false
  }

  const saveEditing = async (): Promise<void> => {
    if (commands === null || editing === undefined) return
    const index = editing.index ?? commands.length
    const next = editing.index === undefined
      ? [...commands, editing.draft]
      : commands.map((c, i) => (i === editing.index ? editing.draft : c))
    if (await commit(next, index)) setEditing(undefined)
  }

  const confirmDelete = async (index: number): Promise<void> => {
    if (commands === null) return
    if (await commit(commands.filter((_, i) => i !== index), -1)) setDeleting(undefined)
  }

  const editor = (key: string): ReactNode => editing && (
    <Editor
      key={key}
      t={t}
      draft={editing.draft}
      errors={errors}
      failure={failure}
      busy={busy}
      onChange={p => { setEditing({ ...editing, draft: { ...editing.draft, ...p } }); setErrors(es => es.filter(e => !(e.field! in p))) }}
      onCancel={() => openEditor(undefined)}
      onSave={() => { void saveEditing() }}
    />
  )

  return (
    <div className="dsc-section">
      <h2 className="dsc-title">{t('title')}</h2>
      <span className="dsc-sr" role="status">{announce}</span>
      {loadError !== undefined && (
        <div className="dsc-notice" role="alert">
          <span>{loadError}</span>
          <button type="button" className="dsc-btn dsc-secondary dsc-compact" onClick={load}>{t('retry')}</button>
        </div>
      )}
      {commands !== null && (
        <div className="dsc-body">
          {commands.length > 0 && (
            <ul className="dsc-rows">
              {commands.map((c, i) => {
                const open = editing?.index === i
                return (
                  <li key={i} className="dsc-card">
                    <div className="dsc-head">
                      <span className="dsc-identity">
                        <code className="dsc-name">/{c.name}</code>
                        {aliasList(c).map(a => <code key={a} className="dsc-tag">/{a}</code>)}
                        {c.type === 'exec' && <span className="dsc-tag">{t('type.exec')}</span>}
                        {c.type === 'alias' && <code className="dsc-tag">→ {c.target.startsWith('/') ? c.target : `/${c.target}`}</code>}
                      </span>
                      {!open && deleting !== i && (
                        <span className="dsc-actions">
                          <button type="button" className="dsc-btn dsc-secondary dsc-compact" aria-label={t('editOf', { name: c.name })}
                            disabled={busy} onClick={() => openEditor({ index: i, draft: c })}>{t('edit')}</button>
                          <button type="button" className="dsc-btn dsc-danger dsc-compact" aria-label={t('deleteOf', { name: c.name })}
                            disabled={busy} onClick={() => { openEditor(undefined); setDeleting(i) }}>{t('delete')}</button>
                        </span>
                      )}
                    </div>
                    {!open && <p className="dsc-desc">{c.description}</p>}
                    {deleting === i && (
                      <div className="dsc-confirm" role="alertdialog" aria-label={t('deleteOf', { name: c.name })}>
                        <span>{t('deleteConfirm', { name: c.name })}</span>
                        {failure !== undefined && <span className="dsc-error" role="alert">{failure}</span>}
                        <span className="dsc-actions">
                          <button type="button" className="dsc-btn dsc-secondary dsc-compact" disabled={busy} autoFocus
                            onClick={() => { setDeleting(undefined); reset() }}>{t('cancel')}</button>
                          <button type="button" className="dsc-btn dsc-danger-fill dsc-compact" disabled={busy}
                            onClick={() => { void confirmDelete(i) }}>{busy ? t('saving') : t('delete')}</button>
                        </span>
                      </div>
                    )}
                    {open && editor(`edit-${i}`)}
                  </li>
                )
              })}
            </ul>
          )}
          {editing?.index === undefined && editing !== undefined
            ? editor('add')
            : (
              <button type="button" className="dsc-btn dsc-add" disabled={busy} onClick={() => openEditor({ index: undefined, draft: blank() })}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                {t('add')}
              </button>
            )}
        </div>
      )}
    </div>
  )
}

interface EditorProps {
  t: T
  draft: Draft
  errors: ApiError[]
  failure: string | undefined
  busy: boolean
  onChange: (p: Partial<Draft>) => void
  onCancel: () => void
  onSave: () => void
}

function Editor({ t, draft, errors, failure, busy, onChange, onCancel, onSave }: EditorProps): ReactElement {
  const base = useId()
  const errorOf = (field: keyof Draft): ApiError | undefined => errors.find(e => e.field === field)
  const field = (key: keyof Draft, control: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode, tip?: LocaleKey): ReactElement => {
    const id = `${base}-${key}`
    const err = errorOf(key)
    const label = t(`field.${key}` as LocaleKey)
    return (
      <div className="dsc-field">
        <span className="dsc-label">
          <label htmlFor={id}>{label}</label>
          {tip && <Help label={t('help', { field: label })} text={t(tip)} />}
        </span>
        {control({ id, ...err ? { 'aria-invalid': true, 'aria-describedby': `${id}-err` } : {} })}
        {err && <span id={`${id}-err`} className="dsc-error">{t(key === 'passEnv' && err.code === 'pattern' ? 'err.envName' : `err.${err.code}` as LocaleKey)}</span>}
      </div>
    )
  }
  const text = (key: keyof Draft, extra: { placeholder?: string; inputMode?: 'numeric'; mono?: boolean } = {}) =>
    (p: { id: string }): ReactNode => (
      <input {...p} className={`dsc-input${extra.mono ? ' dsc-mono' : ''}`} value={draft[key]} placeholder={extra.placeholder}
        inputMode={extra.inputMode} spellCheck={false} autoComplete="off" onChange={e => onChange({ [key]: e.target.value })} />
    )
  const area = (key: 'prompt' | 'command', rows: number) => (p: { id: string }): ReactNode => (
    <textarea {...p} className={`dsc-input dsc-area${key === 'command' ? ' dsc-mono' : ''}`} rows={rows} value={draft[key]}
      spellCheck={false} onChange={e => onChange({ [key]: e.target.value })} />
  )

  return (
    <form className="dsc-editor" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <div className="dsc-segmented" role="group" aria-label={t('field.type')} style={{ '--dsc-index': TYPES.indexOf(draft.type), '--dsc-count': TYPES.length } as CSSProperties}>
        <span className="dsc-indicator" aria-hidden="true" />
        {TYPES.map(v => (
          <button key={v} type="button" aria-pressed={draft.type === v} className="dsc-segment" onClick={() => onChange({ type: v })}>
            {t(`type.${v}`)}
          </button>
        ))}
      </div>
      <div className="dsc-grid">
        {field('name', p => (
          <span className="dsc-affix">
            <span aria-hidden="true">/</span>
            <input {...p} className="dsc-bare dsc-mono" value={draft.name} spellCheck={false} autoComplete="off" autoFocus
              onChange={e => onChange({ name: e.target.value })} />
          </span>
        ))}
        {field('aliases', text('aliases', { placeholder: 'rv, r', mono: true }))}
      </div>
      {field('description', text('description'))}
      {draft.type === 'prompt' && field('prompt', area('prompt', 5), 'tip.prompt')}
      {draft.type === 'alias' && field('target', text('target', { placeholder: '/compact', mono: true }), 'tip.target')}
      {draft.type === 'exec' && (
          <>
            {field('command', area('command', 3), 'tip.command')}
            <div className="dsc-grid">
              {field('cwd', text('cwd', { placeholder: 'workspace', mono: true }), 'tip.cwd')}
              {field('timeoutMs', text('timeoutMs', { placeholder: '30000', inputMode: 'numeric' }))}
            </div>
            {field('passEnv', text('passEnv', { placeholder: 'GH_TOKEN', mono: true }), 'tip.passEnv')}
            <p className="dsc-warn">{t('execWarn')}</p>
          </>
      )}
      {failure !== undefined && <p className="dsc-error" role="alert">{failure}</p>}
      <div className="dsc-editor-actions">
        <button type="button" className="dsc-btn dsc-secondary" disabled={busy} onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className="dsc-btn dsc-primary" disabled={busy || draft.name.trim() === ''}>{busy ? t('saving') : t('save')}</button>
      </div>
    </form>
  )
}

/** 原生设置页同款「?」说明钮：悬停或键盘聚焦时显示气泡，读屏经 aria-describedby 读出。 */
function Help({ label, text }: { label: string; text: string }): ReactElement {
  const id = useId()
  return (
    <span className="dsc-help">
      <button type="button" className="dsc-help-btn" aria-label={label} aria-describedby={id}>?</button>
      <span id={id} role="tooltip" className="dsc-tip">{text}</span>
    </span>
  )
}
