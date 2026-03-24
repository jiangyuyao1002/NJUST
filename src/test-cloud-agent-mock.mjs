/**
 * Mock Cloud Agent MCP Server — 模拟云端 Agent，用于验证插件侧的 Cloud Agent 模式。
 *
 * 用法：
 *   1. node test-cloud-agent-mock.mjs
 *   2. 在 .vscode/settings.json 中设置: "njust-ai-cj.cloudAgent.serverUrl": "http://localhost:4000"
 *   3. 按 F5 启动插件调试，选择 Cloud Agent 模式，输入任意消息
 *
 * 此 mock server 会：
 *   - 发送 reasoning 通知（模拟思考过程）
 *   - 发送 text 通知（模拟文本输出）
 *   - 回调插件执行 list_files（列出工作区根目录）
 *   - 回调插件执行 read_file（读取 package.json 前 5 行）
 *   - 回调插件执行 write_to_file（创建测试文件）
 *   - 回调插件执行 execute_command（运行 echo）
 *   - 发送 done 通知
 */

import http from "http"
import { randomUUID } from "crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

const PORT = 4000
const transports = new Map()

function log(tag, msg) {
	const ts = new Date().toISOString().slice(11, 23)
	console.log(`[${ts}] [${tag}] ${msg}`)
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

const ToolResultSchema = z.object({
	content: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
	isError: z.boolean().optional(),
})

function createMockServer() {
	const server = new McpServer(
		{ name: "mock-cloud-agent", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	)

	server.tool(
		"submit_task",
		"Submit a coding task. The cloud agent plans and executes it by calling tools on the plugin.",
		{
			sessionId: z.string(),
			message: z.string(),
			workspacePath: z.string().optional(),
		},
		async (params, extra) => {
			log("TASK", `Received task: "${params.message}"`)
			log("TASK", `Session: ${params.sessionId}, Workspace: ${params.workspacePath ?? "N/A"}`)

			// Step 1: Send reasoning notification
			log("SEND", "→ reasoning notification")
			await extra.sendNotification({
				method: "notifications/cloudagent/reasoning",
				params: { content: "让我分析一下这个任务。首先我需要了解项目结构..." },
			})
			await sleep(500)

			// Step 2: Send text notification
			log("SEND", "→ text notification")
			await extra.sendNotification({
				method: "notifications/cloudagent/text",
				params: { content: "好的，我来帮你完成这个任务。让我先看看项目结构。" },
			})
			await sleep(300)

			// Step 3: Call list_files on the plugin
			log("SEND", "→ request: cloudagent/executeTool (list_files)")
			let result
			try {
				result = await extra.sendRequest(
					{
						method: "cloudagent/executeTool",
						params: { name: "list_files", arguments: { path: ".", recursive: false } },
					},
					ToolResultSchema,
				)
				const text = result?.content?.[0]?.text ?? "(empty)"
				log("RECV", `← list_files result (${text.length} chars): ${text.slice(0, 200)}...`)
			} catch (e) {
				log("RECV", `← list_files error: ${e.message}`)
			}
			await sleep(300)

			// Step 4: Send more reasoning
			await extra.sendNotification({
				method: "notifications/cloudagent/reasoning",
				params: { content: "项目结构已了解。现在让我读取 package.json 看看项目配置..." },
			})
			await sleep(300)

			// Step 5: Call read_file on the plugin
			log("SEND", "→ request: cloudagent/executeTool (read_file)")
			try {
				result = await extra.sendRequest(
					{
						method: "cloudagent/executeTool",
						params: { name: "read_file", arguments: { path: "package.json", start_line: 1, end_line: 5 } },
					},
					ToolResultSchema,
				)
				const text = result?.content?.[0]?.text ?? "(empty)"
				log("RECV", `← read_file result: ${text.slice(0, 200)}`)
			} catch (e) {
				log("RECV", `← read_file error: ${e.message}`)
			}
			await sleep(300)

			// Step 6: Send text update
			await extra.sendNotification({
				method: "notifications/cloudagent/text",
				params: { content: "了解了项目配置。现在我来创建一个测试文件。" },
			})
			await sleep(300)

			// Step 7: Call write_to_file on the plugin
			log("SEND", "→ request: cloudagent/executeTool (write_to_file)")
			try {
				result = await extra.sendRequest(
					{
						method: "cloudagent/executeTool",
						params: {
							name: "write_to_file",
							arguments: {
								path: ".cloud-agent-test.md",
								content: "# Cloud Agent Test\n\nThis file was created by the mock cloud agent.\n\nTimestamp: " + new Date().toISOString() + "\n",
							},
						},
					},
					ToolResultSchema,
				)
				const text = result?.content?.[0]?.text ?? "(empty)"
				log("RECV", `← write_to_file result: ${text}`)
			} catch (e) {
				log("RECV", `← write_to_file error: ${e.message}`)
			}
			await sleep(300)

			// Step 8: Call execute_command on the plugin
			log("SEND", "→ request: cloudagent/executeTool (execute_command)")
			try {
				result = await extra.sendRequest(
					{
						method: "cloudagent/executeTool",
						params: {
							name: "execute_command",
							arguments: { command: "echo Cloud Agent says hello!", timeout: 5 },
						},
					},
					ToolResultSchema,
				)
				const text = result?.content?.[0]?.text ?? "(empty)"
				log("RECV", `← execute_command result: ${text.slice(0, 200)}`)
			} catch (e) {
				log("RECV", `← execute_command error: ${e.message}`)
			}
			await sleep(300)

			// Step 9: Send done notification
			log("SEND", "→ done notification")
			await extra.sendNotification({
				method: "notifications/cloudagent/done",
				params: { summary: "任务完成！我已经：\n1. 查看了项目结构\n2. 读取了 package.json\n3. 创建了测试文件 .cloud-agent-test.md\n4. 执行了 echo 命令" },
			})

			log("TASK", "Task completed successfully")
			return {
				content: [{ type: "text", text: "Mock cloud agent task completed successfully." }],
			}
		},
	)

	return server
}

const httpServer = http.createServer(async (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization")
	res.setHeader("Access-Control-Expose-Headers", "mcp-session-id")

	if (req.method === "OPTIONS") {
		res.writeHead(204)
		res.end()
		return
	}

	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
	if (url.pathname !== "/mcp") {
		res.writeHead(404, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ error: "Not found. Use /mcp" }))
		return
	}

	try {
		if (req.method === "POST") {
			const body = await parseBody(req)
			const sessionId = req.headers["mcp-session-id"]

			if (sessionId && transports.has(sessionId)) {
				const transport = transports.get(sessionId)
				await transport.handleRequest(req, res, body)
				return
			}

			if (!sessionId && isInitializeRequest(body)) {
				log("SESSION", "New session initializing...")
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (sid) => {
						transports.set(sid, transport)
						log("SESSION", `Session created: ${sid}`)
					},
				})

				transport.onclose = () => {
					const sid = transport.sessionId
					if (sid) {
						transports.delete(sid)
						log("SESSION", `Session closed: ${sid}`)
					}
				}

				const mcpServer = createMockServer()
				await mcpServer.connect(transport)
				await transport.handleRequest(req, res, body)
				return
			}

			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Bad request: missing session or not initialize" }))
		} else if (req.method === "GET" || req.method === "DELETE") {
			const sessionId = req.headers["mcp-session-id"]
			if (sessionId && transports.has(sessionId)) {
				const transport = transports.get(sessionId)
				await transport.handleRequest(req, res)
			} else {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Invalid session" }))
			}
		} else {
			res.writeHead(405).end()
		}
	} catch (error) {
		if (!res.headersSent) {
			res.writeHead(500, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: String(error) }))
		}
	}
})

function parseBody(req) {
	return new Promise((resolve, reject) => {
		let data = ""
		req.on("data", (chunk) => (data += chunk))
		req.on("end", () => {
			try {
				resolve(data ? JSON.parse(data) : undefined)
			} catch {
				reject(new Error("Invalid JSON"))
			}
		})
		req.on("error", reject)
	})
}

httpServer.listen(PORT, "127.0.0.1", () => {
	console.log("")
	console.log("=".repeat(60))
	console.log("  Mock Cloud Agent MCP Server")
	console.log("=".repeat(60))
	console.log(`  Endpoint:  http://127.0.0.1:${PORT}/mcp`)
	console.log(`  Protocol:  MCP Streamable HTTP`)
	console.log("")
	console.log("  Waiting for plugin to connect...")
	console.log("  (Make sure cloudAgent.serverUrl = http://localhost:4000)")
	console.log("=".repeat(60))
	console.log("")
})
