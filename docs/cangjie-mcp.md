# 接入仓颉（Cangjie）相关 MCP 工具

NJUST_AI_CJ 已内置 **Model Context Protocol (MCP)** 客户端。只要仓颉生态提供符合 MCP 规范的服务（stdio / SSE / streamable-http），即可像其他语言一样**外接**到本扩展，让模型在对话中调用 `cjpm`、`cjc`、文档检索等工具。

## 1. 前置条件

1. **当前模式需包含 MCP 工具组**  
   在设置或自定义模式中，确保 `groups` 包含 `mcp`（例如 Code 模式默认包含 `read, edit, command, mcp`）。否则系统提示里不会暴露 MCP 工具。

2. **MCP 服务本身**  
   你需要有可运行的仓颉 MCP 进程，例如：
   - 官方或社区发布的 `stdio` 可执行文件 / `node` 脚本；
   - 或远程 **SSE / HTTP** 端点。

   > 具体命令、包名以仓颉 SDK / 文档为准；下面仅为配置格式示例。

## 2. 配置方式（二选一或同时使用）

### A. 项目级（推荐仓颉工程）

在工作区根目录创建：

```
<工作区>/.roo/mcp.json
```

扩展会自动监视该文件，修改后重连 MCP。

### B. 全局级

在扩展的全局设置目录下的 `mcp_settings.json` 中配置（与设置 UI 中「MCP」页编辑的是同一文件）。

路径一般为：`%USERPROFILE%\.roo-code\mcp_settings.json`（以本机实际为准，也可在扩展侧栏 MCP 设置中打开）。

## 3. 配置格式

根对象必须为：

```json
{
  "mcpServers": {
    "服务显示名称": { ... }
  }
}
```

### stdio（本地进程）

适用于 `npx`、`node`、`python` 或仓颉自带的 MCP 可执行文件：

```json
{
  "mcpServers": {
    "cangjie-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/path/to/cangjie-mcp/dist/index.js"],
      "env": {
        "CANGJIE_HOME": "D:/cangjie",
        "PATH": "D:/cangjie/bin;${env:PATH}"
      }
    }
  }
}
```

- `command` / `args`：按你的 MCP 启动方式填写。  
- `env`：建议传入 `CANGJIE_HOME`，以便子进程找到 `cjpm` / `cjc` / 语言服务相关资源。  
- Windows 下路径建议用正斜杠或转义反斜杠。

### SSE / streamable-http（远程服务）

若仓颉团队提供 HTTP 端点：

```json
{
  "mcpServers": {
    "cangjie-cloud-mcp": {
      "type": "sse",
      "url": "https://example.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

## 4. 与「内置 MCP Tools Server」的区别

| 功能 | 说明 |
|------|------|
| **`.roo/mcp.json` / `mcp_settings.json`** | 扩展作为 **MCP 客户端**，连接**外部**仓颉 MCP 服务，工具出现在对话里（`mcp_*`）。 |
| **设置项 `njust-ai-cj.mcpServer.*`** | 扩展作为 **MCP 服务端**，向**其他**客户端暴露本机工具；**不是**用来接仓颉 MCP 的。 |

要提升仓颉编程能力，应使用上表第一行：**配置外部仓颉 MCP**。

## 5. 验证是否生效

1. 保存 `mcp.json` 后，打开扩展侧栏 **MCP**，查看对应服务是否显示为已连接（绿色）。  
2. 新开对话，模型应能选用以 `mcp_` 为前缀的工具（名称取决于 MCP 服务声明的 tool 名）。  
3. 若连接失败，查看 **输出** 面板中选择扩展日志或 MCP 相关通道中的错误信息。

## 6. 参考示例文件

仓库内提供可复制模板：

- `docs/examples/cangjie-mcp.example.json`

复制内容到 `.roo/mcp.json` 后，按你的实际路径与启动命令修改即可。

## 7. 仍觉得能力不够时

- 在 **仓颉模式**下使用项目内 `.roo/skills/` 与系统提示中的工程上下文（`cjpm.toml`、包结构等）。  
- 开启 **代码索引（Codebase Index）**，用语义搜索补全跨文件信息。  
- 将常用 `cjpm` / 脚本封装成 MCP 工具，由外接服务统一暴露给模型。

以上与 MCP 外接**互补**，不冲突。
