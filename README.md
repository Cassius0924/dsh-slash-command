# dsh-slash-command

DeepSeek Harness（dsh）自定义斜杠命令：**别名 + prompt 型 + exec 型 + Web UI 配置**，对标 Hermes 的 quick_commands。

已验证宿主版本：`0.2.1-rc.3`。

## 安装

```sh
pnpm install && pnpm build
cd /opt/deepseek-harness
export PATH="/opt/deepseek-harness/node_modules/.bin:$PATH"
pnpm dsh plugin --profile web add link:/path/to/dsh-slash-command
systemctl restart dsh   # 仅首次安装需要；之后改配置热生效
```

## 配置

`$DSH_HOME/slash-commands.json`（默认 `~/.dsh/slash-commands.json`），也可在 Web 界面左下角「/ 斜杠命令」面板里编辑。

```json
{"commands":[
  {"name":"review","aliases":["rv"],"description":"审查当前改动","type":"prompt",
   "prompt":"审查 `git diff` 的全部改动。$ARGUMENTS"},
  {"name":"branch","aliases":[],"description":"当前分支","type":"exec",
   "command":"git rev-parse --abbrev-ref HEAD","cwd":"workspace","timeoutMs":30000}
]}
```

| 字段 | 说明 |
|---|---|
| `name` | 必填，`^[a-z][a-z0-9_-]*$`；名字与别名共用命名空间，不得重复 |
| `aliases` | 可选，字符串数组，规则同 name |
| `description` | 必填，显示在 `/` 菜单 |
| `type` | `prompt` \| `exec` |
| `prompt` | prompt 型必填。含 `$ARGUMENTS` 则原位替换为命令后的参数；否则参数非空时以空行拼到末尾 |
| `command` | exec 型必填，经 `/bin/bash -lc` 执行 |
| `cwd` | `workspace`（默认，会话工作区；取不到回落 dsh 进程 cwd）或绝对路径 |
| `timeoutMs` | 默认 30000，上限 600000 |

行为：
- prompt 型把拼好的文本作为 user message steer 给模型，UI 显示「已发送」。
- exec 型把 `exit + stdout + stderr`（合计截断 16KB）steer 给模型；UI 显示前 3 行 + `exit=N`；非零退出/超时返回 error，输出仍会 steer。
- 非法或与内置命令重名的条目会被跳过并写 warn 日志，不影响其它命令。
- 配置文件变更后 300ms 去抖热重载；JSON 解析失败时保留上一份可用配置。
- UI 保存前由服务端校验，非法返回 400 + 字段错误；成功提示「已生效」。接口走 `connection.fetch`（`/api/dsh-slash-command/read|save`），仅登录的 owner 可访问；保存还会拒绝跨站与非 JSON 请求。

## 安全说明

- **exec 以 dsh 进程权限运行，没有审批确认。** 任何能写 `slash-commands.json` 或能登录 Web UI 的人都等价于拥有该权限，请只在可信环境使用。
- `cwd: workspace` 指当前会话的工作目录；指定绝对路径则不随会话变化。
- 不做 system prompt 注入。

## 开发

```sh
pnpm build   # lib/index.js + lib/core.js + lib/client.js + lib/types
pnpm test    # node --test test/*.mjs（校验、$ARGUMENTS、别名展开、输出截断）
```
