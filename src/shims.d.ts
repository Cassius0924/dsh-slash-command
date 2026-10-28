// 宿主提供的运行时模块；这里只声明本插件用到的最小面（构建时 external）。
declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: {
    content: { type: 'text'; text: string }[]
    source: { kind: 'user' }
  }): unknown
}
