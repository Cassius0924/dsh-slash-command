/** dsh-slash-command client 半边：设置弹窗里的「自定义命令」分区（settings.section）。 */
import type { Context } from '@deepseek-ai/cordis'
import { en, NS, zh, type LocaleKey } from './locales.ts'
import { SlashCommandSection } from './panel.tsx'

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

// 只用原生 --dsw-* token，取值对齐 ui-settings-models / ui-primitives 的设置页样式。
const css = `
.dsc-section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dsc-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dsc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dsc-body{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.dsc-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.dsc-body>.dsc-editor{margin-top:0}
.dsc-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
.dsc-head{display:flex;align-items:center;gap:10px;min-height:28px}
.dsc-identity{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.dsc-name{font-family:var(--ds-font-family-code);font-size:14px;line-height:22px;font-weight:500}
.dsc-tag{flex:none;padding:1px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
code.dsc-tag{font-family:var(--ds-font-family-code)}
.dsc-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsc-actions{display:inline-flex;align-items:center;gap:4px;margin-left:auto}
.dsc-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsc-btn:disabled{opacity:.4;cursor:default}
.dsc-btn:focus-visible,.dsc-help-btn:focus-visible,.dsc-segment:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dsc-compact{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}
.dsc-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsc-secondary{border:.5px solid var(--dsw-alias-border-l3)}
.dsc-danger{color:var(--dsw-alias-state-error-primary)}
.dsc-danger-fill{background:var(--dsw-alias-state-error-primary);color:#fff}
.dsc-add{width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg)}
@media (hover:hover){
.dsc-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsc-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsc-add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsc-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsc-danger-fill:hover:not(:disabled){filter:brightness(.92)}
.dsc-segment:hover{color:var(--dsw-alias-label-primary)}
.dsc-help:hover .dsc-tip{display:block}
.dsc-help-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
}
.dsc-confirm{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:4px;padding:10px 12px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);font-size:13px;line-height:20px}
.dsc-editor{display:flex;flex-direction:column;gap:14px;margin-top:6px;padding:14px 16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform)}
.dsc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.dsc-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsc-label{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsc-input,.dsc-affix{box-sizing:border-box;width:100%;min-height:32px;padding:4px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;outline:none}
.dsc-input:focus,.dsc-affix:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.dsc-input[aria-invalid],.dsc-affix:has([aria-invalid]){border-color:var(--dsw-alias-state-error-primary)}
.dsc-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsc-area{resize:vertical;min-height:72px}
.dsc-mono{font-family:var(--ds-font-family-code);font-size:13px}
.dsc-affix{display:flex;align-items:center;gap:2px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-tertiary)}
.dsc-bare{flex:1;min-width:0;padding:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsc-segmented{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;align-self:flex-start;padding:4px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover)}
.dsc-indicator{position:absolute;top:4px;left:4px;width:calc((100% - 8px - 2px * (var(--dsc-count) - 1)) / var(--dsc-count));height:calc(100% - 8px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--dsc-index) * (100% + 2px)));transition:transform 160ms ease;pointer-events:none}
.dsc-segment{position:relative;z-index:1;box-sizing:border-box;height:28px;padding:0 16px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer}
.dsc-segment[aria-pressed=true]{color:var(--dsw-alias-label-primary)}
.dsc-help{position:relative;display:inline-flex}
.dsc-help-btn{box-sizing:border-box;width:16px;height:16px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:15px;text-align:center;cursor:help}
.dsc-tip{display:none;position:absolute;z-index:10;left:-4px;top:calc(100% + 6px);width:max-content;max-width:280px;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00,#fff);font-size:13px;line-height:20px;font-weight:400;pointer-events:none}
.dsc-help-btn:focus-visible+.dsc-tip{display:block}
.dsc-warn{margin:-4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}
.dsc-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dsc-notice{display:flex;align-items:center;gap:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.dsc-editor-actions{display:flex;justify-content:flex-end;gap:8px}
@media (prefers-reduced-motion:reduce){.dsc-indicator{transition:none}}
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

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'slash-commands', order: 25, locale: NS, label: () => t('title') },
    SlashCommandSection,
  ))
}
