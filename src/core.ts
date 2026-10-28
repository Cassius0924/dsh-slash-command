/** 配置解析/校验与文本拼装：纯函数，无 host 依赖，测试直接引用。 */

export const NAME_RE = /^[a-z][a-z0-9_-]*$/
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 600_000
export const OUTPUT_LIMIT = 16 * 1024

export interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  type: 'prompt' | 'exec' | 'alias'
  prompt?: string
  command?: string
  /** alias 型：另一条斜杠命令，如 `/compact` 或 `/review 只看 src`。 */
  target?: string
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

/** alias 目标：`/name` 后可跟固定参数；开头的 `/` 可省略。 */
const TARGET_RE = /^\/?([a-z][a-z0-9_-]*)(?:\s[\s\S]*)?$/

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
    if (item.type !== 'prompt' && item.type !== 'exec' && item.type !== 'alias') fail('type', 'enum', 'type must be "prompt", "exec" or "alias"')
    else if (item.type === 'prompt' && !nonEmpty(item.prompt)) fail('prompt', 'required', 'prompt is required for prompt commands')
    else if (item.type === 'exec' && !nonEmpty(item.command)) fail('command', 'required', 'command is required for exec commands')
    else if (item.type === 'alias') {
      const m = typeof item.target === 'string' ? TARGET_RE.exec(item.target.trim()) : null
      if (!nonEmpty(item.target)) fail('target', 'required', 'target is required for alias commands')
      else if (m === null) fail('target', 'pattern', `target "${String(item.target)}" must be a slash command like /compact`)
      else if (own.includes(m[1]!)) fail('target', 'duplicate', `alias /${m[1]} cannot target itself`)
    }
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
    else if (cmd.type === 'alias') cmd.target = normalizeTarget(item.target as string)
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

/** 统一成 `/name args` 形式。 */
export const normalizeTarget = (target: string): string => {
  const t = target.trim()
  return t.startsWith('/') ? t : `/${t}`
}

/** alias 展开：`$ARGUMENTS` 原位替换；否则参数以空格接在目标命令后。 */
export function composeAlias(target: string, rawInput: string): string {
  const args = rawInput.trim()
  if (target.includes('$ARGUMENTS')) return target.replaceAll('$ARGUMENTS', () => args).trim()
  return args === '' ? target : `${target} ${args}`
}

/**
 * exec 参数以变量形式传入而非拼进脚本（不会被当成代码执行）：
 * `$ARGUMENTS` = 完整参数，`$1 $2 …` / `"$@"` = 按空白拆分的参数。
 */
export function execArgs(rawInput: string): { env: Record<string, string>; argv: string[] } {
  const args = rawInput.trim()
  return { env: { ARGUMENTS: args }, argv: args === '' ? [] : args.split(/\s+/) }
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

/**
 * exec 结果直接回显在命令卡片里（不进模型）：stdout + stderr 合计截断到 16KB；
 * 非零退出/超时在末尾附 `exit=N`，无输出时只给 exit。
 */
export function formatExecResult(o: ExecOutcome): string {
  const output = clip(`${o.stdout}${o.stderr}`.replace(/\s+$/, ''), OUTPUT_LIMIT)
  if (o.exit === '0') return output === '' ? 'exit=0' : output
  return output === '' ? `exit=${o.exit}` : `${output}\nexit=${o.exit}`
}
