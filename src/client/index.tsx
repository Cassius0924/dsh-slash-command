/** dsh-slash-command client 半边：shell.overlay 里的浮动按钮 + 命令管理面板。 */
import { useState, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { en, NS, zh, type LocaleKey } from './locales.ts'
import { SlashCommandPanel } from './panel.tsx'

export const name = 'dsh-slash-command'
export const inject = ['slots', 'locale']

type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

interface ClientContext extends Context {
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: { name: string; id: string; order: number; locale: string; label: () => string }, component: unknown): () => void
  }
  locale: {
    register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): Translate
  }
}

const css = `
.dsc-root{position:fixed;left:16px;bottom:16px;z-index:2147482000;font:13px/1.45 var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1f2328)}
.dsc-fab{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-overlay,#fff);color:inherit;border-radius:999px;height:32px;padding:0 12px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.dsc-panel{position:absolute;left:0;bottom:40px;width:min(440px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 80px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.dsc-head,.dsc-foot{display:flex;align-items:center;gap:8px;padding:10px 12px}
.dsc-head{justify-content:space-between;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12))}
.dsc-foot{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12))}
.dsc-foot span{flex:1;min-width:0}
.dsc-body{overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.dsc-card{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:8px}
.dsc-field{display:flex;flex-direction:column;gap:2px}
.dsc-field span{font-size:12px;color:var(--dsw-alias-label-secondary,#59636e)}
.dsc-field input,.dsc-field select,.dsc-field textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.2));border-radius:6px;padding:4px 8px;resize:vertical}
.dsc-btn{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.2));border-radius:6px;padding:3px 10px;cursor:pointer}
.dsc-btn:disabled{opacity:.5;cursor:default}
.dsc-primary{background:var(--dsw-alias-state-business-primary,#0969da);border-color:transparent;color:#fff}
.dsc-danger{align-self:flex-start;color:var(--dsw-alias-state-error-primary,#cf222e)}
.dsc-muted{margin:0;color:var(--dsw-alias-label-secondary,#59636e)}
.dsc-error{margin:0;color:var(--dsw-alias-state-error-primary,#cf222e)}
.dsc-ok{color:var(--dsw-alias-state-success-primary,#1a7f37)}
`

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-slash-command: dictionaries')
  const t = ctx.locale.bind(NS)
  if (typeof document !== 'undefined') {
    document.querySelectorAll('style[data-plugin="dsh-slash-command"]').forEach(node => node.remove())
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-slash-command'
    tag.textContent = css
    document.head.appendChild(tag)
  }

  const Overlay = ({ t: slotT }: { t: Translate }): ReactElement => {
    const [open, setOpen] = useState(false)
    return (
      <div className="dsc-root">
        {open && <SlashCommandPanel t={slotT} onClose={() => setOpen(false)} />}
        <button type="button" className="dsc-fab" title={slotT('open')} aria-label={slotT('open')} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          / {slotT('title')}
        </button>
      </div>
    )
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'slash-commands', order: 1001, locale: NS, label: () => t('title') },
    Overlay,
  ))
}
