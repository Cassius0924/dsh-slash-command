# dsh-slash-command

[![npm](https://img.shields.io/npm/v/dsh-slash-command?color=cb3837&logo=npm)](https://www.npmjs.com/package/dsh-slash-command)
[![license](https://img.shields.io/npm/l/dsh-slash-command?color=blue)](./LICENSE)

给 [DSH](https://github.com/deepseek-ai)（DeepSeek Harness）加自定义斜杠命令，对标 Hermes 的 `quick_commands`：

- **Prompt 型**：`/review 只看 src` → 把预设 prompt 发给模型，`$ARGUMENTS` 替换为命令后的参数。
- **Shell 型**：`/branch` → 在本机直接执行，输出回显在命令卡片里，**不经过模型、不消耗 token**。
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
   "command":"git rev-parse --abbrev-ref HEAD","cwd":"workspace","timeoutMs":30000}
]}
```

`name`/别名需匹配 `^[a-z][a-z0-9_-]*$`；`cwd` 为 `workspace`（当前会话目录）或绝对路径；`timeoutMs` 默认 30000，上限 600000。Shell 型输出合计截断到 16KB，命令后的参数会被忽略。

## 安全

Shell 命令以 dsh 进程权限运行，**没有审批确认**。能写配置文件或能登录 Web UI 的人就等于拥有这个权限，请只在可信环境使用。

## 开发

```sh
pnpm install && pnpm build && pnpm test
```

发版流程见 [RELEASING.md](./RELEASING.md)。

## License

MIT
