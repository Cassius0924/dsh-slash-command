import { useEffect, useState, type ReactElement } from 'react'
import type { LocaleKey } from './locales.ts'

type T = (key: LocaleKey, params?: Record<string, unknown>) => string

interface Draft {
  name: string
  aliases: string
  description: string
  type: 'prompt' | 'exec'
  prompt: string
  command: string
  cwd: string
  timeoutMs: string
}

interface ApiError { index?: number; field?: string; code: string; message: string }

const blank = (): Draft => ({ name: '', aliases: '', description: '', type: 'prompt', prompt: '', command: '', cwd: '', timeoutMs: '' })

const toDraft = (c: Record<string, unknown>): Draft => ({
  name: String(c.name ?? ''),
  aliases: Array.isArray(c.aliases) ? c.aliases.join(', ') : '',
  description: String(c.description ?? ''),
  type: c.type === 'exec' ? 'exec' : 'prompt',
  prompt: String(c.prompt ?? ''),
  command: String(c.command ?? ''),
  cwd: c.cwd === undefined || c.cwd === 'workspace' ? '' : String(c.cwd),
  timeoutMs: c.timeoutMs === undefined ? '' : String(c.timeoutMs),
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
  else {
    out.command = d.command
    if (d.cwd.trim() !== '') out.cwd = d.cwd.trim()
    if (d.timeoutMs.trim() !== '') out.timeoutMs = Number(d.timeoutMs)
  }
  return out
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string }

export function SlashCommandPanel({ t, onClose }: { t: T; onClose: () => void }): ReactElement {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [errors, setErrors] = useState<ApiError[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    fetch('/api/dsh-slash-command/read', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json() as { ok: boolean; commands?: Record<string, unknown>[]; errors?: ApiError[] }
        if (!res.ok || !body.ok) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`)
        setDrafts((body.commands ?? []).map(toDraft))
      })
      .catch((e: unknown) => {
        setDrafts([])
        setStatus({ kind: 'error', text: t('loadFailed', { detail: e instanceof Error ? e.message : String(e) }) })
      })
  }, [])

  const patch = (i: number, p: Partial<Draft>): void => {
    setDrafts(ds => ds!.map((d, j) => (j === i ? { ...d, ...p } : d)))
    setStatus({ kind: 'idle' })
  }

  const save = async (): Promise<void> => {
    setStatus({ kind: 'saving' })
    setErrors([])
    try {
      const res = await fetch('/api/dsh-slash-command/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands: drafts!.map(toWire) }),
      })
      const body = await res.json() as { ok: boolean; errors?: ApiError[] }
      if (res.ok && body.ok) {
        setStatus({ kind: 'saved' })
        return
      }
      setErrors(body.errors ?? [])
      setStatus({ kind: 'error', text: t('saveFailed', { detail: res.status === 400 ? `${body.errors?.length ?? 0} ✗` : `HTTP ${res.status}` }) })
    } catch (e) {
      setStatus({ kind: 'error', text: t('saveFailed', { detail: e instanceof Error ? e.message : String(e) }) })
    }
  }

  const errorsFor = (i: number): ApiError[] => errors.filter(e => e.index === i)
  const errorText = (e: ApiError): string => `${e.field ?? ''}${e.field ? ': ' : ''}${t(`err.${e.code}` as LocaleKey)} — ${e.message}`
  const field = (label: LocaleKey, input: ReactElement): ReactElement => (
    <label className="dsc-field"><span>{t(label)}</span>{input}</label>
  )

  return (
    <div className="dsc-panel" role="dialog" aria-label={t('title')}>
      <div className="dsc-head">
        <strong>{t('title')}</strong>
        <button type="button" className="dsc-btn" aria-label={t('close')} onClick={onClose}>✕</button>
      </div>
      <div className="dsc-body">
        {drafts === null && <p className="dsc-muted">{t('loading')}</p>}
        {drafts?.length === 0 && <p className="dsc-muted">{t('empty')}</p>}
        {drafts?.map((d, i) => (
          <div className="dsc-card" key={i}>
            {field('field.name', <input value={d.name} onChange={e => patch(i, { name: e.target.value })} />)}
            {field('field.aliases', <input value={d.aliases} onChange={e => patch(i, { aliases: e.target.value })} />)}
            {field('field.description', <input value={d.description} onChange={e => patch(i, { description: e.target.value })} />)}
            {field('field.type', (
              <select value={d.type} onChange={e => patch(i, { type: e.target.value as Draft['type'] })}>
                <option value="prompt">{t('type.prompt')}</option>
                <option value="exec">{t('type.exec')}</option>
              </select>
            ))}
            {d.type === 'prompt'
              ? field('field.prompt', <textarea rows={4} value={d.prompt} onChange={e => patch(i, { prompt: e.target.value })} />)
              : (
                <>
                  {field('field.command', <textarea rows={2} value={d.command} onChange={e => patch(i, { command: e.target.value })} />)}
                  {field('field.cwd', <input value={d.cwd} placeholder="workspace" onChange={e => patch(i, { cwd: e.target.value })} />)}
                  {field('field.timeoutMs', <input value={d.timeoutMs} placeholder="30000" inputMode="numeric" onChange={e => patch(i, { timeoutMs: e.target.value })} />)}
                  <p className="dsc-muted">{t('execWarn')}</p>
                </>
              )}
            {errorsFor(i).map((e, k) => <p className="dsc-error" key={k}>{errorText(e)}</p>)}
            <button type="button" className="dsc-btn dsc-danger" onClick={() => { setDrafts(ds => ds!.filter((_, j) => j !== i)); setErrors([]) }}>{t('delete')}</button>
          </div>
        ))}
        {errors.filter(e => e.index === undefined).map((e, k) => <p className="dsc-error" key={k}>{errorText(e)}</p>)}
      </div>
      <div className="dsc-foot">
        <button type="button" className="dsc-btn" disabled={drafts === null} onClick={() => setDrafts(ds => [...ds!, blank()])}>{t('add')}</button>
        <span className={status.kind === 'error' ? 'dsc-error' : 'dsc-ok'} role="status">
          {status.kind === 'saved' ? t('saved') : status.kind === 'saving' ? t('saving') : status.kind === 'error' ? status.text : ''}
        </span>
        <button type="button" className="dsc-btn dsc-primary" disabled={drafts === null || status.kind === 'saving'} onClick={() => { void save() }}>{t('save')}</button>
      </div>
    </div>
  )
}
