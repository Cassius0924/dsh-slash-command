# dsh-slash-command

[![npm](https://img.shields.io/npm/v/dsh-slash-command?color=cb3837&logo=npm)](https://www.npmjs.com/package/dsh-slash-command)
[![license](https://img.shields.io/npm/l/dsh-slash-command?color=blue)](./LICENSE)

给 [DSH](https://github.com/deepseek-ai)（DeepSeek Harness）加自定义斜杠命令，对标 Hermes 的 `quick_commands`：

- **Prompt 型**：`/review 只看 src` → 把预设 prompt 发给模型，`$ARGUMENTS` 替换为命令后的参数。
- **Shell 型**：`/log 5` → 在本机直接执行，像 Hermes 一样在会话里显示为「你的命令气泡 + 输出回复」（无输出时提示「命令没有返回任何输出」），**不经过模型、不消耗 token**。
- **转发型（alias）**：`/c` → 转发到另一条斜杠命令（如 `/compact`），可带固定参数。
- 支持别名，在「设置 → 自定义命令」里增删改，保存即生效，无需重启。

## 安装

```sh
dsh plugin --profile web add dsh-slash-command
```

已验证宿主版本：`0.2.1-rc.3`。

## 配置

配置存放在 `$DSH_HOME/slash-commands.json`（默认 `~/.dsh/slash-commands.json`），设置页和手改文件都可以：

```json
{"commands":[
  {"name":"review","aliases":["rv"],"description":"审查当前改动","type":"prompt",
   "prompt":"审查 `git diff` 的全部改动。$ARGUMENTS"},
  {"name":"branch","description":"当前分支","type":"exec",
   "command":"git rev-parse --abbrev-ref HEAD","cwd":"workspace","timeoutMs":30000},
  {"name":"log","description":"最近提交","type":"exec","command":"git log --oneline -n \"${1:-10}\""},
  {"name":"c","description":"压缩上下文","type":"alias","target":"/compact"}
]}
```

`name`/别名需匹配 `^[a-z][a-z0-9_-]*$`；`cwd` 为 `workspace`（当前会话目录）或绝对路径；`timeoutMs` 默认 30000，上限 600000；`passEnv` 见下方「安全」。

参数（命令名后面的文字）：

- Prompt / 转发型：`$ARGUMENTS` 原位替换；没写时 Prompt 型以空行接在末尾，转发型以空格接在目标命令后。
- Shell 型：`$ARGUMENTS` 为完整参数，`$1 $2 …` / `"$@"` 为按空白拆分的参数。参数只以变量传入，不会拼进脚本，`/log 5; rm -rf ~` 里的 `; rm -rf ~` 只是普通字符串。输出合计截断到 16KB。

## 安全

Shell 命令以 dsh 进程权限运行，**没有审批确认**。能写配置文件或能登录 Web UI 的人就等于拥有这个权限，请只在可信环境使用。

对标 Hermes，Shell 命令额外做两层防误泄露：

- **环境变量过滤**：名字含 `KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `CREDENTIAL` / `AUTH` 等片段的变量（如 `DEEPSEEK_API_KEY`）不传给命令。确实需要的，在该命令的 `passEnv` 里列出，例如 `"passEnv":["GH_TOKEN"]`。
- **输出遮蔽**：结果会写进会话记录，显示前先把 dsh 环境里的密钥值、常见 key 格式（`sk-…`、`ghp_…`、`AKIA…` 等）、`XXX_KEY=…` 赋值、`Authorization` 头、JWT、私钥块、URL 里的账号密码替换成 `***`。

这两层只降低误泄露概率，**不是安全边界**：命令与 dsh 同一系统用户，仍能直接读取 `~/.dsh` 等文件。

## 开发

```sh
pnpm install && pnpm build && pnpm test
```

发版流程见 [RELEASING.md](./RELEASING.md)。

## License

MIT
