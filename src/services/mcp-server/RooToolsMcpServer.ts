import * as http from "http"
import { randomUUID } from "crypto"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
	execReadFile,
	execWriteFile,
	execListFiles,
	execSearchFiles,
	execCommand,
	execApplyDiff,
} from "./tool-executors"

interface RooToolsMcpServerOptions {
	workspacePath: string
	port: number
	bindAddress: string
	authToken?: string
	allowedCommands?: string[]
	deniedCommands?: string[]
}

export class RooToolsMcpServer {
	private httpServer: http.Server | null = null
	private transports = new Map<string, StreamableHTTPServerTransport>()
	private options: RooToolsMcpServerOptions

	constructor(options: RooToolsMcpServerOptions) {
		this.options = options
	}

	private createMcpServer(): McpServer {
		const server = new McpServer(
			{ name: "roo-tools", version: "1.0.0" },
			{ capabilities: { tools: {} } },
		)

		const cwd = this.options.workspacePath

		server.tool(
			"read_file",
			"Read the contents of a file within the workspace. Returns numbered lines.",
			{
				path: z.string().describe("Relative path to the file within the workspace"),
				start_line: z.number().optional().describe("Starting line number (1-based)"),
				end_line: z.number().optional().describe("Ending line number (1-based, inclusive)"),
			},
			async (params) => {
				try {
					const result = await execReadFile(cwd, params)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		server.tool(
			"write_to_file",
			"Write content to a file within the workspace. Creates parent directories if needed.",
			{
				path: z.string().describe("Relative path to the file within the workspace"),
				content: z.string().describe("The full content to write to the file"),
			},
			async (params) => {
				try {
					const result = await execWriteFile(cwd, params)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		server.tool(
			"list_files",
			"List files and directories within a directory in the workspace.",
			{
				path: z.string().describe("Relative path to the directory within the workspace"),
				recursive: z.boolean().optional().describe("Whether to list files recursively (default: false)"),
			},
			async (params) => {
				try {
					const result = await execListFiles(cwd, params)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		server.tool(
			"search_files",
			"Search for a regex pattern across files in a directory within the workspace.",
			{
				path: z.string().describe("Relative path to the directory to search in"),
				regex: z.string().describe("Regular expression pattern to search for (Rust regex syntax)"),
				file_pattern: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts')"),
			},
			async (params) => {
				try {
					const result = await execSearchFiles(cwd, params)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		server.tool(
			"execute_command",
			"Execute a shell command in the workspace.",
			{
				command: z.string().describe("The shell command to execute"),
				cwd: z.string().optional().describe("Working directory for the command (relative to workspace)"),
				timeout: z.number().optional().describe("Timeout in seconds (default: 30)"),
			},
			async (params) => {
				try {
					const result = await execCommand(
						cwd,
						params,
						this.options.allowedCommands,
						this.options.deniedCommands,
					)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		server.tool(
			"apply_diff",
			"Apply a search/replace diff to a file. Uses <<<<<<< SEARCH / ======= / >>>>>>> REPLACE format.",
			{
				path: z.string().describe("Relative path to the file to modify"),
				diff: z.string().describe("The diff content using SEARCH/REPLACE block format"),
			},
			async (params) => {
				try {
					const result = await execApplyDiff(cwd, params)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: any) {
					return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true }
				}
			},
		)

		return server
	}

	private isLocalOnly(): boolean {
		const addr = this.options.bindAddress
		return addr === "127.0.0.1" || addr === "localhost" || addr === "::1"
	}

	async start(): Promise<void> {
		const { port, bindAddress, authToken } = this.options

		if (!this.isLocalOnly() && !authToken) {
			throw new Error(
				"Security: authToken is required when binding to a non-localhost address. " +
					"Set njust-ai-cj.mcpServer.authToken in your settings before exposing the MCP server to the network.",
			)
		}

		this.httpServer = http.createServer(async (req, res) => {
			const allowedOrigin = this.isLocalOnly() ? "*" : (req.headers.origin ?? "*")
			res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization")
			res.setHeader("Access-Control-Expose-Headers", "mcp-session-id")

			if (req.method === "OPTIONS") {
				res.writeHead(204)
				res.end()
				return
			}

			if (authToken && !this.verifyAuth(req, authToken)) {
				res.writeHead(401, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Unauthorized" }))
				return
			}

			const url = new URL(req.url ?? "/", `http://${bindAddress}:${port}`)
			if (url.pathname !== "/mcp") {
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Not found" }))
				return
			}

			try {
				if (req.method === "POST") {
					await this.handlePost(req, res)
				} else if (req.method === "GET") {
					await this.handleGet(req, res)
				} else if (req.method === "DELETE") {
					await this.handleDelete(req, res)
				} else {
					res.writeHead(405, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Method not allowed" }))
				}
			} catch (error: any) {
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32603, message: "Internal server error" },
							id: null,
						}),
					)
				}
			}
		})

		return new Promise<void>((resolve, reject) => {
			this.httpServer!.listen(port, bindAddress, () => {
				resolve()
			})
			this.httpServer!.on("error", reject)
		})
	}

	async stop(): Promise<void> {
		for (const [sessionId, transport] of this.transports) {
			try {
				await transport.close()
			} catch {
				// best-effort cleanup
			}
		}
		this.transports.clear()

		if (this.httpServer) {
			return new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve())
			})
		}
	}

	private verifyAuth(req: http.IncomingMessage, token: string): boolean {
		const authHeader = req.headers["authorization"]
		return authHeader === `Bearer ${token}`
	}

	private async parseBody(req: http.IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			let data = ""
			req.on("data", (chunk) => (data += chunk))
			req.on("end", () => {
				try {
					resolve(data ? JSON.parse(data) : undefined)
				} catch (e) {
					reject(new Error("Invalid JSON body"))
				}
			})
			req.on("error", reject)
		})
	}

	private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this.parseBody(req)
		const sessionId = req.headers["mcp-session-id"] as string | undefined

		if (sessionId && this.transports.has(sessionId)) {
			const transport = this.transports.get(sessionId)!
			await transport.handleRequest(req, res, body)
			return
		}

		if (!sessionId && isInitializeRequest(body)) {
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (sid) => {
					this.transports.set(sid, transport)
				},
			})

			transport.onclose = () => {
				const sid = transport.sessionId
				if (sid) {
					this.transports.delete(sid)
				}
			}

			const mcpServer = this.createMcpServer()
			await mcpServer.connect(transport)
			await transport.handleRequest(req, res, body)
			return
		}

		res.writeHead(400, { "Content-Type": "application/json" })
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Bad Request: No valid session ID provided" },
				id: null,
			}),
		)
	}

	private async handleGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined
		if (!sessionId || !this.transports.has(sessionId)) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Invalid or missing session ID" }))
			return
		}

		const transport = this.transports.get(sessionId)!
		await transport.handleRequest(req, res)
	}

	private async handleDelete(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined
		if (!sessionId || !this.transports.has(sessionId)) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Invalid or missing session ID" }))
			return
		}

		const transport = this.transports.get(sessionId)!
		await transport.handleRequest(req, res)
	}
}
