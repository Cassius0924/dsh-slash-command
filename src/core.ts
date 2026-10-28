/** 配置解析/校验与文本拼装：纯函数，无 host 依赖，测试直接引用。 */

export const NAME_RE = /^[a-z][a-z0-9_-]*$/
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 600_000
export const OUTPUT_LIMIT = 16 * 1024

export interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  type: 'prompt' | 'exec'
  prompt?: string
  command?: string
  cwd?: string
  timeoutMs?: number
}

/** `index` 指向 commands 数组下标；缺省表示顶层错误。 */
export interface FieldError {
  index?: number
  field?: string
  code: 'type' | 'required' | 'pattern' | 'duplicate' | 'enum' | 'range'
  message: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * 校验并规范化配置。非法条目不会出现在 `commands` 里（整条丢弃），原因写入 `errors`。
 * 名字与别名共用同一命名空间，先出现者胜，后者报 duplicate。
 */
export function validateConfig(raw: unknown): { commands: SlashCommand[]; errors: FieldError[] } {
  const commands: SlashCommand[] = []
  const errors: FieldError[] = []
  if (!isObj(raw) || !Array.isArray(raw.commands)) {
    return { commands, errors: [{ code: 'type', field: 'commands', message: 'commands must be an array' }] }
  }
  const seen = new Set<string>()
  raw.commands.forEach((item: unknown, index) => {
    const bad: FieldError[] = []
    const fail = (field: string, code: FieldError['code'], message: string): void => {
      bad.push({ index, field, code, message })
    }
    if (!isObj(item)) {
      errors.push({ index, code: 'type', message: 'command must be an object' })
      return
    }
    const names: string[] = []
    if (typeof item.name !== 'string' || item.name === '') fail('name', 'required', 'name is required')
    else if (!NAME_RE.test(item.name)) fail('name', 'pattern', `name "${item.name}" must match ${String(NAME_RE)}`)
    else names.push(item.name)
    const aliases: string[] = []
    if (item.aliases !== undefined) {
      if (!Array.isArray(item.aliases)) fail('aliases', 'type', 'aliases must be an array of strings')
      else {
        for (const a of item.aliases as unknown[]) {
          if (typeof a !== 'string' || !NAME_RE.test(a)) fail('aliases', 'pattern', `alias "${String(a)}" must match ${String(NAME_RE)}`)
          else aliases.push(a)
        }
      }
    }
    const own = [...names, ...aliases]
    own.forEach((n, i) => {
      if (seen.has(n) || own.indexOf(n) !== i) fail(n === item.name ? 'name' : 'aliases', 'duplicate', `"${n}" is already used`)
    })
    if (!nonEmpty(item.description)) fail('description', 'required', 'description is required')
    if (item.type !== 'prompt' && item.type !== 'exec') fail('type', 'enum', 'type must be "prompt" or "exec"')
    else if (item.type === 'prompt' && !nonEmpty(item.prompt)) fail('prompt', 'required', 'prompt is required for prompt commands')
    else if (item.type === 'exec' && !nonEmpty(item.command)) fail('command', 'required', 'command is required for exec commands')
    if (item.cwd !== undefined && !(typeof item.cwd === 'string' && (item.cwd === 'workspace' || item.cwd.startsWith('/')))) {
      fail('cwd', 'enum', 'cwd must be "workspace" or an absolute path')
    }
    if (item.timeoutMs !== undefined
      && !(typeof item.timeoutMs === 'number' && Number.isInteger(item.timeoutMs) && item.timeoutMs >= 1 && item.timeoutMs <= MAX_TIMEOUT_MS)) {
      fail('timeoutMs', 'range', `timeoutMs must be an integer in 1..${MAX_TIMEOUT_MS}`)
    }
    if (bad.length > 0) {
      errors.push(...bad)
      return
    }
    for (const n of own) seen.add(n)
    const cmd: SlashCommand = {
      name: item.name as string,
      aliases,
      description: (item.description as string).trim(),
      type: item.type as 'prompt' | 'exec',
    }
    if (cmd.type === 'prompt') cmd.prompt = item.prompt as string
    else {
      cmd.command = item.command as string
      cmd.cwd = (item.cwd as string | undefined) ?? 'workspace'
      cmd.timeoutMs = (item.timeoutMs as number | undefined) ?? DEFAULT_TIMEOUT_MS
    }
    commands.push(cmd)
  })
  return { commands, errors }
}

/** 名字 + 别名展开成要注册的全部入口名。 */
export const expandNames = (cmd: SlashCommand): string[] => [cmd.name, ...cmd.aliases]

/** `$ARGUMENTS` 原位替换；没有占位符且有参数时以空行拼到末尾。 */
export function composePrompt(prompt: string, rawInput: string): string {
  const args = rawInput.trim()
  if (prompt.includes('$ARGUMENTS')) return prompt.replaceAll('$ARGUMENTS', () => args)
  return args === '' ? prompt : `${prompt}\n\n${args}`
}

/** 按 UTF-8 字节截断（不拆字符）。 */
function clip(text: string, limit: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= limit) return text
  return `${buf.subarray(0, limit).toString('utf8').replace(/�$/, '')}\n…[truncated]`
}

export interface ExecOutcome {
  exit: string
  stdout: string
  stderr: string
}

/** 给模型看的 steer 文本：exit + stdout + stderr 合计截断到 16KB。 */
export function formatExecForModel(command: string, o: ExecOutcome): string {
  const head = `$ ${command}\nexit=${o.exit}`
  let budget = Math.max(OUTPUT_LIMIT - Buffer.byteLength(head), 0)
  const parts = [head]
  for (const [label, body] of [['stdout', o.stdout], ['stderr', o.stderr]] as const) {
    if (body === '' || budget <= 0) continue
    const piece = clip(body, budget)
    budget -= Buffer.byteLength(piece)
    parts.push(`--- ${label} ---\n${piece}`)
  }
  return parts.join('\n')
}

/** UI 结果文本：输出前 3 行 + exit=N。 */
export function formatExecForUi(o: ExecOutcome): string {
  const lines = (o.stdout + o.stderr).split('\n').filter(l => l !== '').slice(0, 3)
  return [...lines, `exit=${o.exit}`].join('\n')
}
