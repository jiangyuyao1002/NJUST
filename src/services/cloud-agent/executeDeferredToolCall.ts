import {
	execReadFile,
	execWriteFile,
	execListFiles,
	execSearchFiles,
	execCommand,
	execApplyDiff,
} from "../mcp-server/tool-executors"
import type { DeferredToolCall, DeferredToolResult } from "./types"

/**
 * Execute a single deferred tool call locally and return an MCP-shaped result.
 * Unknown tools yield an is_error result rather than throwing.
 */
export async function executeDeferredToolCall(
	cwd: string,
	call: DeferredToolCall,
): Promise<DeferredToolResult> {
	try {
		const args = call.arguments
		let content: string

		switch (call.tool) {
			case "read_file":
				content = await execReadFile(cwd, {
					path: args.path as string,
					start_line: args.start_line as number | undefined,
					end_line: args.end_line as number | undefined,
				})
				break

			case "write_file":
				content = await execWriteFile(cwd, {
					path: args.path as string,
					content: args.content as string,
				})
				break

			case "apply_diff":
				content = await execApplyDiff(cwd, {
					path: args.path as string,
					diff: args.diff as string,
				})
				break

			case "list_files":
				content = await execListFiles(cwd, {
					path: (args.path as string) ?? ".",
					recursive: args.recursive as boolean | undefined,
				})
				break

			case "search_files":
				content = await execSearchFiles(cwd, {
					path: (args.path as string) ?? ".",
					regex: args.regex as string,
					file_pattern: args.file_pattern as string | undefined,
				})
				break

			case "execute_command":
				content = await execCommand(cwd, {
					command: args.command as string,
					cwd: args.cwd as string | undefined,
					timeout: args.timeout as number | undefined,
				})
				break

			default:
				return {
					call_id: call.call_id,
					content: `Unknown tool: ${call.tool}`,
					is_error: true,
				}
		}

		return { call_id: call.call_id, content, is_error: false }
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		return { call_id: call.call_id, content: msg, is_error: true }
	}
}
