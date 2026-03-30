# Cloud Agent 服务端对接规范

本文档面向 **云端 Agent / 网关服务** 开发人员，说明 NJUST AI CJ 扩展在 **Cloud Agent 模式**下如何调用你们的 HTTP API，以及如何返回可选的结构化工作区操作 `workspace_ops`。

扩展侧实现参考：

- [`src/services/cloud-agent/CloudAgentClient.ts`](../src/services/cloud-agent/CloudAgentClient.ts)
- [`src/services/cloud-agent/types.ts`](../src/services/cloud-agent/types.ts)
- [`src/services/cloud-agent/parseWorkspaceOps.ts`](../src/services/cloud-agent/parseWorkspaceOps.ts)

---

## 1. 协议概览

| 项目 | 说明 |
|------|------|
| 角色 | 扩展作为 **HTTP 客户端**，你们的部署作为 **HTTP 服务端** |
| 调用顺序（deferred，默认） | `GET /health` → `POST /v1/deferred/start` → 本地执行 tool_calls → `POST /v1/deferred/resume` → 循环至 `status == "done"` → （可选）`POST /v1/compile` 编译反馈 |
| 调用顺序（legacy） | `GET /health` → `POST /v1/run` → （可选）`POST /v1/compile` 编译反馈 |
| Base URL | 用户设置项 `njust-ai-cj.cloudAgent.serverUrl`；扩展会去掉末尾 `/` |
| 协议切换 | `njust-ai-cj.cloudAgent.deferredProtocol`（默认 **true**）；设为 false 回退到 legacy `/v1/run` |
| 与 MCP | 插件 REST 路径不调用 `POST /mcp`。MCP 仅供其他客户端联调 |

---

## 2. 请求鉴权头

以下头在 **`GET /health`** 与 **`POST /v1/run`** 中均会携带（由扩展自动添加）：

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | POST 时 | 固定为 `application/json` |
| `X-Device-Token` | 是 | 扩展首次激活生成的设备令牌；可用于区分设备或会话 |
| `X-API-Key` | 否 | 仅当用户配置了 `njust-ai-cj.cloudAgent.apiKey` 时发送 |

---

## 3. `GET /health`

- **成功**：返回 HTTP **200**；响应 body 可为空（扩展只检查 `resp.ok`）。
- **失败**：非 2xx 时扩展会报错并中止本次 Cloud Agent 任务。

---

## 4. `POST /v1/run`

### 4.1 请求体（JSON）

```json
{
  "goal": "<用户输入的任务描述>",
  "session_id": "<扩展内任务 ID，字符串>",
  "workspace_path": "<当前工作区根路径，可能为空字符串>",
  "images": ["<可选，有附图时出现>"]
}
```

| 字段 | 说明 |
|------|------|
| `goal` | 用户本次发送的文本目标 |
| `session_id` | 扩展内部任务标识，便于日志与幂等 |
| `workspace_path` | 用户打开的工作区根目录；供你们做上下文提示或策略，**实际写盘由扩展在本地执行** |
| `images` | **仅在有附图时**存在；无图时该字段省略 |

### 4.2 响应体（JSON）

响应 **必须是合法 JSON**；否则扩展会抛出错误并视为任务失败。

建议字段与扩展类型 `CloudRunResponse` 对齐：

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 业务是否成功；影响完成提示文案 |
| `user_goal` | string | 建议回显请求中的目标 |
| `memory_summary` | string | 摘要文本；扩展会作为一条消息展示 |
| `logs` | `string[]` | 日志列表；扩展会逐条展示 |
| `tokens_in` | number，可选 | 输入 token 用量 |
| `tokens_out` | number，可选 | 输出 token 用量 |
| `cost` | number，可选 | 费用（含义由你们定义） |
| `workspace_ops` | 对象，可选 | 见第 5 节；**校验失败时整段被忽略**，不影响 `logs` / `memory_summary` 展示 |

**扩展处理顺序**：解析并校验 `workspace_ops` → 依次展示 `logs` → 展示 `memory_summary` → 触发完成回调。`workspace_ops` 非法时仅控制台警告，**不**导致 HTTP 层失败。

### 4.3 HTTP 错误

- `POST /v1/run` 返回 **非 2xx**：扩展向用户报错。
- 响应 body **非 JSON**：扩展报错。

---

## 4a. Deferred 执行协议（推荐，默认开启）

当 `njust-ai-cj.cloudAgent.deferredProtocol` 为 **true**（默认）时，扩展使用 deferred 协议代替单次 `/v1/run`。

### 4a.1 `POST /v1/deferred/start`

#### 请求体

```json
{
  "goal": "<用户输入>",
  "session_id": "<扩展任务 ID>",
  "workspace_path": "<工作区根路径>",
  "images": ["可选"]
}
```

#### 响应体（`DeferredResponse`）

```json
{
  "run_id": "unique-run-id",
  "status": "pending",
  "tool_calls": [
    {
      "call_id": "tc_001",
      "tool": "read_file",
      "arguments": { "path": "src/main.cj" }
    }
  ],
  "workspace_ops": { "version": 1, "operations": [...] },
  "text": "可选：显示在聊天中的文本",
  "reasoning": "可选：思维链",
  "logs": ["可选日志"],
  "ok": true,
  "memory_summary": "仅 status=done 时有意义",
  "tokens_in": 0,
  "tokens_out": 0,
  "cost": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `run_id` | string | 本次执行唯一标识，resume 时需回传 |
| `status` | `"pending"` \| `"done"` | `pending` = 还需扩展执行 tool_calls 并 resume |
| `tool_calls` | `DeferredToolCall[]` | 需要扩展本地执行的工具调用 |
| `workspace_ops` | 同第 5 节 | 结构化写盘指令（与 tool_calls 可同时存在） |
| `text` / `reasoning` / `logs` | 可选 | 增量展示内容 |

### 4a.2 扩展侧执行流程

1. 解析 `workspace_ops` → 按现有逻辑写盘（受 `applyRemoteWorkspaceOps` / `confirmRemoteWorkspaceOps` 控制）
2. 依次执行 `tool_calls`，每个调用映射到本地 tool-executor：

| 服务端 tool 名 | 本地执行器 | arguments |
|----------------|-----------|-----------|
| `read_file` | `execReadFile` | `{ path, start_line?, end_line? }` |
| `write_file` | `execWriteFile` | `{ path, content }` |
| `apply_diff` | `execApplyDiff` | `{ path, diff }` |
| `list_files` | `execListFiles` | `{ path, recursive? }` |
| `search_files` | `execSearchFiles` | `{ path, regex, file_pattern? }` |
| `execute_command` | `execCommand` | `{ command, cwd?, timeout? }` |

3. 将执行结果整理为 MCP 形字典：

```json
{
  "call_id": "tc_001",
  "content": "工具输出内容",
  "is_error": false
}
```

### 4a.3 `POST /v1/deferred/resume`

#### 请求体

```json
{
  "run_id": "<来自上一个响应的 run_id>",
  "session_id": "<扩展任务 ID>",
  "tool_results": [
    { "call_id": "tc_001", "content": "1 | import ...", "is_error": false }
  ]
}
```

#### 响应体

同 `DeferredResponse`。若 `status == "pending"` → 扩展继续执行并 resume；若 `status == "done"` → 循环结束。

### 4a.4 完整时序

```
扩展                                  服务端
  │                                     │
  │─── GET /health ────────────────────>│
  │<── 200 ─────────────────────────────│
  │                                     │
  │─── POST /v1/deferred/start ────────>│
  │    { goal, session_id, ... }        │
  │<── { run_id, status:"pending",  ────│
  │      tool_calls:[...],              │
  │      workspace_ops:{...} }          │
  │                                     │
  │  [扩展写盘 workspace_ops]           │
  │  [扩展执行 tool_calls]              │
  │                                     │
  │─── POST /v1/deferred/resume ───────>│
  │    { run_id, tool_results:[...] }   │
  │<── { status:"pending", ... } ───────│  ← 可能多次迭代
  │  ...                                │
  │<── { status:"done", ok:true } ──────│
  │                                     │
  │  [聊天显示完成结果]                 │
```

### 4a.5 已知限制

- 会话仅存服务端内存：多副本部署需 Redis 等共享状态 + 粘性会话
- `load_cangjie_skill` 仍在服务端读盘（不经 MCP），后续可改为 defer 或扩展提供技能正文
- 水平扩展 / 进程重启会丢失 `run_id`
- 扩展侧最大迭代上限 50 次

---

## 4b. `POST /v1/compile`（编译反馈闭环）

当 `njust-ai-cj.cloudAgent.compileLoop.enabled` 为 **true**（默认）时，扩展在 `workspace_ops` 写盘完成后，自动调用此端点在服务器上编译。

**触发路径**：
- **legacy（`deferredProtocol: false`）**：`POST /v1/run` 返回并应用 `workspace_ops` 之后触发。
- **deferred（默认，`deferredProtocol: true`）**：整个 deferred 循环（start/resume）结束且 `status == "done"`，并且本轮曾出现被应用的 `workspace_ops` 时触发，在 `completion_result` 之前执行。

两种路径的触发条件相同：`compileLoop.enabled && applyRemoteWorkspaceOps && 曾出现 workspace_ops`。编译失败时的修正仍走 **`POST /v1/run`**；若服务端仅实现了 deferred 而未实现 `/v1/run`，则修正步骤会失败，行为与 legacy 路径相同。

### 4b.1 请求体（JSON）

```json
{
  "session_id": "<与 /v1/run 相同的任务 ID>",
  "workspace_path": "<当前工作区根路径，可选>"
}
```

### 4b.2 响应体（JSON）

```json
{
  "success": true,
  "output": "cjpm build 的完整 stdout + stderr"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 编译是否成功（exit code 0） |
| `output` | string | `cjc` / `cjpm build` 的完整输出（stdout + stderr），供扩展展示和回传 Agent |

### 4b.3 编译反馈循环流程

1. 扩展在 `workspace_ops` 写盘后调用 `POST /v1/compile`
2. 若 `success: true` → 聊天中显示「编译通过」，循环结束
3. 若 `success: false` → 聊天中显示编译错误，然后：
   - 将错误信息作为 `goal` 发送 `POST /v1/run`（要求 Agent 修正代码）
   - Agent 返回新的 `workspace_ops` → 扩展写盘 → 再次调用 `/v1/compile`
4. 循环直到编译通过或达到 `cloudAgent.compileLoop.maxRetries`（默认 3 次）

### 4b.4 相关设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `njust-ai-cj.cloudAgent.compileLoop.enabled` | `true` | 是否开启编译反馈循环 |
| `njust-ai-cj.cloudAgent.compileLoop.maxRetries` | `3` | 最大「编译-修正」迭代次数（1–10） |

---

## 5. 可选：`workspace_ops`（结构化本地写盘意图）

扩展在 **`njust-ai-cj.cloudAgent.applyRemoteWorkspaceOps` 为 true（默认）** 时会在本地执行这些操作；若关闭该项则忽略 `workspace_ops`。路径限制在**当前工作区**内（由 `tool-executors` 校验）。

若同时开启 `njust-ai-cj.cloudAgent.confirmRemoteWorkspaceOps`（**默认 true**），则**每条**操作会先出现与内置工具类似的 **批准/拒绝** UI；关闭该项则**批量顺序执行**（一条失败则 fail-fast）。

### 5.1 信封结构

```json
"workspace_ops": {
  "version": 1,
  "operations": [ /* WorkspaceOp */ ]
}
```

| 字段 | 说明 |
|------|------|
| `version` | 可选；仅支持字面量 `1` |
| `operations` | 必填数组；元素为下面两种之一 |

### 5.2 操作类型 `WorkspaceOp`

**`write_file`** — 创建或覆盖文件（相对工作区的路径，UTF-8 全文）：

```json
{
  "op": "write_file",
  "path": "src/example.ts",
  "content": "export const x = 1;\n"
}
```

**`apply_diff`** — 对**已存在**文件应用 SEARCH/REPLACE 式 diff（与扩展内置 `apply_diff` / `MultiSearchReplaceDiffStrategy` 一致）：

```json
{
  "op": "apply_diff",
  "path": "src/example.ts",
  "diff": "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n"
}
```

### 5.3 校验上限（超出则整段 `workspace_ops` 丢弃）

| 限制 | 值 |
|------|-----|
| `operations.length` | ≤ **50** |
| `path` 长度 | ≤ **4096** 字符 |
| `content` / `diff` 各自长度 | ≤ **1_000_000** 字符 |
| `op` 取值 | 仅 **`write_file`**、**`apply_diff`** |

不满足 schema 时，`operations` 视为空数组；扩展可能在开发者工具控制台输出警告。

### 5.4 服务端需注意

- 能否落盘**完全由用户本地设置决定**；你们只能在响应中表达**意图**。
- 执行顺序为数组**下标顺序**；`.rooignore`、写保护等与本地写文件工具策略一致，可能被跳过或拒绝。
- **不要**依赖 `workspace_path` 在服务端直接写用户磁盘；写盘由扩展完成。

---

## 6. 本地联调

1. 仓库根目录运行：`node src/test-cloud-agent-mock.mjs`
2. 扩展设置：`njust-ai-cj.cloudAgent.serverUrl` = `http://127.0.0.1:4000`（或 mock 实际端口）
3. 使用 **Cloud Agent** 模式发消息  
4. Mock 可选 API Key：环境变量 `CLOUD_AGENT_MOCK_API_KEY`；扩展侧配置 `cloudAgent.apiKey` 与之对齐

更多说明见仓库根目录 [`AGENTS.md`](../AGENTS.md)。

---

## 7. 与「云端调用户本机 MCP」的边界

- **本文档 REST**：仅 `/health` + `/v1/run`。
- 若产品需要云端主动调用用户机器上的工具，需单独方案（如内置 MCP Tools Server、隧道等），**不在**上述 JSON 字段内约定。

---

## 8. 版本与变更

扩展与校验逻辑以仓库内 `parseWorkspaceOps`、 `CloudAgentClient` 为准。新增 `op` 类型或字段前，需同步更新扩展与本文档。
