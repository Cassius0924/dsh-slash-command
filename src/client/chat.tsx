/**
 * 会话里的 Hermes 式呈现：自定义命令先显示成一条用户气泡（`/name args`），结果作为回复显示在下方。
 *
 * - 气泡：额外注册一个 Conversation Definition，把本插件命令的 `command/run` 映射成原生 `user` 节点。
 *   非 command 节点会让聊天视图进入 active，所以在「新会话」页执行也能切到对话，不再静默跑掉。
 * - 回复：在 `conversation.chat.commandview` 按命令名接管原本的单行命令卡；prompt 型由 steer 出的
 *   用户消息承担展示，这里不画东西。
 */
import { memo, type ReactElement } from 'react'
import type { LocaleKey } from './locales.ts'

type T = (key: LocaleKey, params?: Record<string, unknown>) => string

export type CommandType = 'prompt' | 'exec' | 'alias'

interface CommandNode {
  commandId: string
  seq: number
  time: number
  name: string | null
  args: string | null
  outcome: null | { kind: 'success' | 'error'; text?: string }
}

interface RunEvent { type: string; seq: number; time: number; data: { commandId: unknown; name?: unknown; args?: unknown } }
interface Match { event: RunEvent; location: unknown }
interface NodeContext { key: string; id: string; state?: Echo; start?: Match; matches: readonly Match[] }
interface Echo { name: string; args: string; seq: number; time: number; commandId: string }

/** 斜杠命令按回车后的原样文本。 */
const lineOf = (name: string, args: string | null): string => `/${name}${args ?? ''}`.trimEnd()

/**
 * 用户气泡的 Definition。`types` 在调用时读取，名单变化后重新注册即可让历史重新匹配。
 * @param types - 当前配置里的命令名/别名 → 类型。
 */
export function echoDefinition(types: ReadonlyMap<string, CommandType>) {
  return {
    kind: 'dsh-slash-command.echo',
    target: 'chat',
    match: (event: RunEvent) => {
      if (event.type !== 'command/run' || typeof event.data.name !== 'string') return null
      const type = types.get(event.data.name)
      return type === 'exec' || type === 'alias' ? { id: String(event.data.commandId), role: 'start' as const } : null
    },
    start: (_context: NodeContext, match: Match): Echo => ({
      name: String(match.event.data.name),
      args: typeof match.event.data.args === 'string' ? match.event.data.args : '',
      seq: match.event.seq,
      time: match.event.time,
      commandId: String(match.event.data.commandId),
    }),
    update: (context: NodeContext & { state: Echo }) => context.state,
    buildViewNode: (context: NodeContext) => {
      const s = context.state
      if (s === undefined) return null
      return {
        key: context.key,
        kind: 'user',
        id: context.id,
        target: 'chat',
        // 紧贴在同一事件的命令节点之前
        anchorSeq: s.seq - 0.5,
        location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        groupTree: undefined,
        data: {
          kind: 'user',
          messageId: `dsh-slash-command:${s.commandId}`,
          seq: s.seq,
          time: s.time,
          content: [{ type: 'text', text: lineOf(s.name, s.args) }],
          source: { kind: 'user' },
        },
      }
    },
  }
}

/**
 * exec/alias 的回复：失败显示为错误色。成功但无输出时，exec 同 Hermes 显示「命令没有返回任何输出」，
 * alias 转发的目标命令本就可能不回文字，不显示。
 */
export function makeReply(t: T, noteEmpty: boolean) {
  return memo(function SlashCommandReply({ node }: { node: CommandNode }): ReactElement | null {
    const outcome = node.outcome
    if (outcome === null) return <p className="dsc-reply dsc-reply-muted" role="status">{t('running')}</p>
    const text = outcome.text ?? ''
    if (text === '') return noteEmpty ? <p className="dsc-reply dsc-reply-muted">{t('noOutput')}</p> : null
    const error = outcome.kind === 'error'
    return text.includes('\n')
      ? <pre className="dsc-reply dsc-reply-block" data-error={error || undefined}>{text}</pre>
      : <p className="dsc-reply" data-error={error || undefined}>{text}</p>
  })
}

/** prompt 型：steer 出的用户消息就是展示，原单行卡片不再显示。 */
export const Hidden = (): null => null
