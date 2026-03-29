import { parseWorkspaceOps } from "./parseWorkspaceOps"
import type {
	CloudAgentCallbacks,
	CloudAgentClientOptions,
	CloudCompileResponse,
	CloudCompileResult,
	CloudRunResponse,
	CloudRunResult,
	DeferredResponse,
	DeferredToolResult,
} from "./types"

/** Undici/Node often surfaces low-level failures as `fetch failed` with details on `error.cause`. */
function enrichFetchError(error: unknown): Error {
	if (!(error instanceof Error)) {
		return new Error(String(error))
	}
	const parts: string[] = [error.message]
	const c = (error as Error & { cause?: unknown }).cause
	if (c instanceof Error && c.message && !error.message.includes(c.message)) {
		parts.push(c.message)
	} else if (typeof c === "object" && c !== null && "code" in c) {
		const code = (c as { code?: unknown }).code
		if (code !== undefined) {
			parts.push(String(code))
		}
	}
		return parts.length > 1 ? new Error(parts.join(": ")) : error
}

function apiKeyHintFor401(status: number, bodySnippet: string): string {
	if (status !== 401 || !/X-API-Key|api_?key/i.test(bodySnippet)) {
		return ""
	}
	return (
		' Hint: set VS Code "njust-ai-cj.cloudAgent.apiKey" (User settings) to match server CLOUD_AGENT_MOCK_API_KEY, ' +
		"or set process env CLOUD_AGENT_MOCK_API_KEY / NJUST_CLOUD_AGENT_API_KEY for the extension host (e.g. Roo-Code/.env). " +
		"Workspace .vscode/settings.json only applies when that folder is the workspace root."
	)
}

export class CloudAgentClient {
	private serverUrl: string
	private deviceToken: string
	private callbacks: CloudAgentCallbacks
	private readonly options: CloudAgentClientOptions | undefined

	constructor(
		serverUrl: string,
		deviceToken: string,
		callbacks: CloudAgentCallbacks,
		options?: CloudAgentClientOptions,
	) {
		this.serverUrl = serverUrl.replace(/\/$/, "")
		this.deviceToken = deviceToken
		this.callbacks = callbacks
		this.options = options
	}

	private mergeAbortAndTimeout(): { signal?: AbortSignal; cleanup: () => void } {
		const baseSignal = this.options?.signal
		const timeoutMs = this.options?.requestTimeoutMs
		const hasTimeout = !!(timeoutMs && timeoutMs > 0)

		if (!hasTimeout && !baseSignal) {
			return { cleanup: () => {} }
		}
		if (!hasTimeout && baseSignal) {
			return { signal: baseSignal, cleanup: () => {} }
		}

		const controller = new AbortController()
		const cleanups: (() => void)[] = []

		if (hasTimeout) {
			const id = setTimeout(() => {
				controller.abort(new DOMException("Cloud Agent request timed out", "AbortError"))
			}, timeoutMs!)
			cleanups.push(() => clearTimeout(id))
		}

		if (baseSignal) {
			if (baseSignal.aborted) {
				controller.abort(baseSignal.reason)
			} else {
				const onAbort = () => controller.abort(baseSignal.reason)
				baseSignal.addEventListener("abort", onAbort, { once: true })
				cleanups.push(() => baseSignal.removeEventListener("abort", onAbort))
			}
		}

		return { signal: controller.signal, cleanup: () => cleanups.forEach((fn) => fn()) }
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Device-Token": this.deviceToken,
		}
		if (this.options?.apiKey) {
			headers["X-API-Key"] = this.options.apiKey
		}
		return headers
	}

	private async parseJsonResponse(resp: Response): Promise<CloudRunResponse> {
		const text = await resp.text()
		try {
			return JSON.parse(text) as CloudRunResponse
		} catch {
			throw new Error(
				`Cloud Agent: response is not valid JSON (HTTP ${resp.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`,
			)
		}
	}

	async connect(): Promise<void> {
		const { signal, cleanup } = this.mergeAbortAndTimeout()
		try {
			let resp: Response
			try {
				resp = await fetch(`${this.serverUrl}/health`, {
					method: "GET",
					...(signal ? { signal } : {}),
					headers: this.buildHeaders(),
				})
			} catch (e) {
				throw enrichFetchError(e)
			}
			if (!resp.ok) {
				const errText = await resp.text()
				const slice = errText.slice(0, 300)
				throw new Error(
					`Cloud Agent health check failed: HTTP ${resp.status}: ${slice}${apiKeyHintFor401(resp.status, slice)}`,
				)
			}
		} finally {
			cleanup()
		}
	}

	async submitTask(
		sessionId: string,
		message: string,
		workspacePath?: string,
		images?: string[],
	): Promise<CloudRunResult> {
		const body: Record<string, unknown> = {
			goal: message,
			session_id: sessionId,
			workspace_path: workspacePath,
		}
		if (images && images.length > 0) {
			body.images = images
		}

		const { signal, cleanup } = this.mergeAbortAndTimeout()
		let resp: Response
		try {
			try {
				resp = await fetch(`${this.serverUrl}/v1/run`, {
					method: "POST",
					headers: this.buildHeaders(),
					body: JSON.stringify(body),
					...(signal ? { signal } : {}),
				})
			} catch (e) {
				throw enrichFetchError(e)
			}
		} finally {
			cleanup()
		}

		if (!resp.ok) {
			const errText = await resp.text()
			const slice = errText.slice(0, 500)
			throw new Error(`Cloud Agent error (HTTP ${resp.status}): ${slice}${apiKeyHintFor401(resp.status, slice)}`)
		}

		const data = await this.parseJsonResponse(resp)

		const { operations: workspaceOps, error: workspaceOpsError } = parseWorkspaceOps(data)
		if (workspaceOpsError !== undefined) {
			console.warn(`[CloudAgentClient] Invalid workspace_ops in /v1/run response: ${workspaceOpsError}`)
		}

		for (const log of data.logs || []) {
			await this.callbacks.onText(log)
		}

		if (data.memory_summary) {
			await this.callbacks.onText(data.memory_summary)
		}

		await this.callbacks.onDone(data.ok ? "Task completed" : "Task failed")

		return {
			memorySummary: data.memory_summary || "",
			tokensIn: data.tokens_in ?? 0,
			tokensOut: data.tokens_out ?? 0,
			cost: data.cost ?? 0,
			workspaceOps,
			workspaceOpsParseError: workspaceOpsError,
		}
	}

	/**
	 * Call POST /v1/compile to run cjc/cjpm build on the server side.
	 * Returns structured compile output (success flag + stdout/stderr).
	 */
	async compile(sessionId: string, workspacePath?: string): Promise<CloudCompileResult> {
		const body: Record<string, unknown> = { session_id: sessionId }
		if (workspacePath) {
			body.workspace_path = workspacePath
		}

		const { signal, cleanup } = this.mergeAbortAndTimeout()
		let resp: Response
		try {
			try {
				resp = await fetch(`${this.serverUrl}/v1/compile`, {
					method: "POST",
					headers: this.buildHeaders(),
					body: JSON.stringify(body),
					...(signal ? { signal } : {}),
				})
			} catch (e) {
				throw enrichFetchError(e)
			}
		} finally {
			cleanup()
		}

		if (!resp.ok) {
			const errText = await resp.text()
			const slice = errText.slice(0, 500)
			throw new Error(
				`Cloud Agent compile error (HTTP ${resp.status}): ${slice}${apiKeyHintFor401(resp.status, slice)}`,
			)
		}

		const text = await resp.text()
		let data: CloudCompileResponse
		try {
			data = JSON.parse(text) as CloudCompileResponse
		} catch {
			throw new Error(
				`Cloud Agent: compile response is not valid JSON (HTTP ${resp.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`,
			)
		}

		return {
			success: data.success,
			output: data.output ?? "",
		}
	}

	// -------------------------------------------------------------------
	// Deferred execution protocol
	// -------------------------------------------------------------------

	private async fetchDeferred(endpoint: string, body: Record<string, unknown>): Promise<DeferredResponse> {
		const { signal, cleanup } = this.mergeAbortAndTimeout()
		let resp: Response
		try {
			try {
				resp = await fetch(`${this.serverUrl}${endpoint}`, {
					method: "POST",
					headers: this.buildHeaders(),
					body: JSON.stringify(body),
					...(signal ? { signal } : {}),
				})
			} catch (e) {
				throw enrichFetchError(e)
			}
		} finally {
			cleanup()
		}

		if (!resp.ok) {
			const errText = await resp.text()
			const slice = errText.slice(0, 500)
			throw new Error(
				`Cloud Agent deferred error (HTTP ${resp.status}): ${slice}${apiKeyHintFor401(resp.status, slice)}`,
			)
		}

		const text = await resp.text()
		try {
			return JSON.parse(text) as DeferredResponse
		} catch {
			throw new Error(
				`Cloud Agent: deferred response is not valid JSON (HTTP ${resp.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`,
			)
		}
	}

	async deferredStart(
		sessionId: string,
		message: string,
		workspacePath?: string,
		images?: string[],
	): Promise<DeferredResponse> {
		const body: Record<string, unknown> = {
			goal: message,
			session_id: sessionId,
			workspace_path: workspacePath,
		}
		if (images && images.length > 0) {
			body.images = images
		}
		return this.fetchDeferred("/v1/deferred/start", body)
	}

	async deferredResume(
		runId: string,
		sessionId: string,
		toolResults: DeferredToolResult[],
	): Promise<DeferredResponse> {
		return this.fetchDeferred("/v1/deferred/resume", {
			run_id: runId,
			session_id: sessionId,
			tool_results: toolResults,
		})
	}

	async disconnect(): Promise<void> {
		// No persistent connection in REST mode
	}
}
