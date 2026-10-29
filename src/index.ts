/**
 * dsh-slash-command host 半边：读 `$DSH_HOME/slash-commands.json`，为每个 name/alias 注册斜杠命令，
 * 监听文件热重载，并通过 `connection.fetch` 暴露 UI 用的 read/save 接口（沿用宿主认证栅栏，仅 owner 可达）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  composeAlias, composePrompt, execArgs, expandNames, formatExecResult, redactSecrets, scrubEnv, secretValues, validateConfig,
  type ExecOutcome, type SlashCommand,
} from './core.ts'

export const name = 'dsh-slash-command'
export const inject = ['commands', 'connection']

const READ_PATH = '/api/dsh-slash-command/read'
const SAVE_PATH = '/api/dsh-slash-command/save'
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_BODY = 1024 * 1024
/** alias 链最大深度，防 a → b → a 这类循环。 */
const MAX_ALIAS_DEPTH = 8
const ALIAS_DEPTH = Symbol('dsh-slash-command.aliasDepth')

// 宿主命令 / agent / connection 的最小结构面，避免依赖额外类型包。
type Result = { kind: 'success'; text?: string; sourceEventSeq?: number } | { kind: 'error'; text: string }
interface AgentFace { steer(message: unknown): void; ctx?: unknown }
interface Invocation { agent: AgentFace; rawInput: string; signal: AbortSignal; [ALIAS_DEPTH]?: number }
interface CommandDef {
  name: string
  description: string
  input: { hint: string }
  handler: (inv: Invocation) => Result | Promise<Result>
}
interface CommandsFace {
  register(def: CommandDef): () => void
  find(agent: AgentFace, name: string): CommandDef | undefined
}
interface ConnectionFace {
  fetch: {
    register(route: {
      path: string
      methods: ('GET' | 'POST')[]
      requestBody: 'buffered'
      fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}
interface WorkingDirectoryFace { ensure(agent: unknown, signal?: AbortSignal): Promise<string> }

const configPath = (): string => join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'slash-commands.json')

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function steerText(agent: AgentFace, text: string): void {
  agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** 会话工作区；取不到回落 process.cwd()。 */
async function workspaceOf(ctx: Context, agent: AgentFace, signal: AbortSignal): Promise<string> {
  try {
    const wd = Reflect.get(ctx, 'workingDirectory') as WorkingDirectoryFace | undefined
    if (wd !== undefined) return await wd.ensure(agent, signal)
  } catch { /* 回落 */ }
  return process.cwd()
}

function runExec(cmd: SlashCommand, rawInput: string, cwd: string, signal: AbortSignal): Promise<ExecOutcome> {
  const { env, argv } = execArgs(rawInput)
  const command = cmd.command!
  const timeout = cmd.timeoutMs!
  return new Promise((resolve) => {
    // bash -c script name args…：argv 成为 $1…，脚本文本里不拼任何用户输入
    execFile('/bin/bash', ['-lc', command, 'dsh-slash-command', ...argv], {
      // 对标 Hermes：dsh 进程环境里有各家 API key，子进程默认拿不到
      cwd, timeout, maxBuffer: MAX_BUFFER, signal, env: { ...scrubEnv(process.env, cmd.passEnv), ...env },
    }, (err, stdout, stderr) => {
      if (err === null) return resolve({ exit: '0', stdout, stderr })
      const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
      if (typeof e.code === 'number') return resolve({ exit: String(e.code), stdout, stderr })
      // 超时/信号/spawn 失败：没有数字退出码
      const exit = e.killed === true ? `timeout(${e.signal ?? 'killed'})` : String(e.code ?? e.signal ?? 'error')
      resolve({ exit, stdout, stderr: stderr + (stderr === '' || stderr.endsWith('\n') ? '' : '\n') + e.message })
    })
  })
}

function makeHandler(ctx: Context, commands: CommandsFace, cmd: SlashCommand): (inv: Invocation) => Promise<Result> {
  if (cmd.type === 'alias') {
    // 直接调用目标命令的 handler：结果落在本条命令卡片里，不再多出一张卡
    return async (inv) => {
      const depth = (inv[ALIAS_DEPTH] ?? 0) + 1
      if (depth > MAX_ALIAS_DEPTH) return { kind: 'error', text: `/${cmd.name}: alias chain too deep` }
      const line = composeAlias(cmd.target!, inv.rawInput)
      const m = /^\/([a-z][a-z0-9_-]*)/.exec(line)
      const target = m === null ? undefined : commands.find(inv.agent, m[1]!)
      if (target === undefined) return { kind: 'error', text: `${line.split(/\s/)[0]}: unknown command` }
      return target.handler({ ...inv, rawInput: line.slice(m![0].length), [ALIAS_DEPTH]: depth })
    }
  }
  if (cmd.type === 'prompt') {
    return (inv) => {
      steerText(inv.agent, composePrompt(cmd.prompt!, inv.rawInput))
      return Promise.resolve({ kind: 'success', text: '已发送' })
    }
  }
  return async (inv) => {
    const cwd = cmd.cwd === undefined || cmd.cwd === 'workspace' ? await workspaceOf(ctx, inv.agent, inv.signal) : cmd.cwd
    // 对标 Hermes quick_commands：只在本机执行并回显，不 steer、不触发模型回合。
    const outcome = await runExec(cmd, inv.rawInput, cwd, inv.signal)
    // 结果会写进会话记录，先遮蔽再显示
    const known = secretValues(process.env)
    const text = formatExecResult({ ...outcome, stdout: redactSecrets(outcome.stdout, known), stderr: redactSecrets(outcome.stderr, known) })
    return outcome.exit === '0' ? { kind: 'success', text } : { kind: 'error', text }
  }
}

export function apply(ctx: Context): void {
  const commands = Reflect.get(ctx, 'commands') as CommandsFace
  const connection = Reflect.get(ctx, 'connection') as ConnectionFace
  const file = configPath()
  let disposers: (() => void)[] = []
  /** 上一份已生效的原始文本；相同则不重复重注册。 */
  let applied: string | undefined

  const unregisterAll = (): void => {
    for (const d of disposers) d()
    disposers = []
  }

  /** 全量反注册再重注册。解析失败时保留上一份。 */
  async function reload(): Promise<void> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        ctx.logger.warn(`dsh-slash-command: cannot read ${file}: ${String(e)}`)
        return
      }
      text = '{"commands":[]}'
    }
    if (text === applied) return
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (e) {
      ctx.logger.warn(`dsh-slash-command: ${file} is not valid JSON, keeping previous config: ${String(e)}`)
      return
    }
    const { commands: valid, errors } = validateConfig(raw)
    for (const err of errors) {
      ctx.logger.warn(`dsh-slash-command: skipped commands[${err.index ?? '?'}]${err.field ? `.${err.field}` : ''}: ${err.message}`)
    }
    unregisterAll()
    applied = text
    for (const cmd of valid) {
      const handler = makeHandler(ctx, commands, cmd)
      for (const n of expandNames(cmd)) {
        try {
          disposers.push(commands.register({ name: n, description: cmd.description, input: { hint: '[args]' }, handler }))
        } catch (e) {
          ctx.logger.warn(`dsh-slash-command: cannot register /${n}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  // watch 目录而非文件：编辑器/原子 rename 会替换 inode。
  ctx.effect(() => {
    let timer: NodeJS.Timeout | undefined
    const trigger = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => { void reload() }, 300)
    }
    let watcher: ReturnType<typeof watch> | undefined
    void mkdir(dirname(file), { recursive: true }).then(() => {
      watcher = watch(dirname(file), (_event, filename) => { if (filename === basename(file)) trigger() })
      watcher.on('error', e => ctx.logger.warn(`dsh-slash-command: watcher error: ${String(e)}`))
    }).catch(e => ctx.logger.warn(`dsh-slash-command: cannot watch ${file}: ${String(e)}`))
    void reload()
    return () => {
      clearTimeout(timer)
      watcher?.close()
      unregisterAll()
    }
  }, 'dsh-slash-command: config watcher')

  connection.fetch.register({
    path: READ_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
        const commands = (raw as { commands?: unknown }).commands
        return json(200, { ok: true, commands: Array.isArray(commands) ? commands : [] })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return json(200, { ok: true, commands: [] })
        return json(500, { ok: false, errors: [{ code: 'type', message: `cannot read config: ${String(e)}` }] })
      }
    },
  })

  connection.fetch.register({
    path: SAVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      // 保存会写入可执行命令：拒绝跨站与非 JSON 请求（非简单 content-type 会强制 CORS 预检，宿主不会放行）。
      if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        return json(415, { ok: false, errors: [{ code: 'type', message: 'content-type must be application/json' }] })
      }
      const origin = request.headers.get('origin')
      if (origin !== null && origin !== new URL(request.url).origin) {
        return json(403, { ok: false, errors: [{ code: 'type', message: 'cross-origin request rejected' }] })
      }
      const body = await request.text()
      if (body.length > MAX_BODY) return json(413, { ok: false, errors: [{ code: 'range', message: 'body too large' }] })
      let raw: unknown
      try { raw = JSON.parse(body) } catch { return json(400, { ok: false, errors: [{ code: 'type', message: 'body is not valid JSON' }] }) }
      const { commands: valid, errors } = validateConfig(raw)
      if (errors.length > 0) return json(400, { ok: false, errors })
      const text = `${JSON.stringify({ commands: valid }, null, 2)}\n`
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, text)
      await rename(tmp, file)
      await reload() // 立即生效，不等 watcher 的 debounce
      return json(200, { ok: true, commands: valid })
    },
  })
}
