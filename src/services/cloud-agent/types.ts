/** Structured file ops from POST /v1/run (optional). Applied locally only when settings allow. */
export type WorkspaceOp =
	| { op: "write_file"; path: string; content: string }
	| { op: "apply_diff"; path: string; diff: string }

export interface WorkspaceOpsEnvelope {
	version?: 1
	operations: WorkspaceOp[]
}

export interface CloudRunResponse {
	ok: boolean
	user_goal: string
	memory_summary: string
	logs: string[]
	/** Usage fields when returned by the cloud service */
	tokens_in?: number
	tokens_out?: number
	cost?: number
	/** Optional machine-readable workspace mutations (see parseWorkspaceOps). */
	workspace_ops?: WorkspaceOpsEnvelope
}

export interface CloudRunResult {
	memorySummary: string
	tokensIn: number
	tokensOut: number
	cost: number
	/** Validated ops from workspace_ops; empty if absent or invalid. */
	workspaceOps: WorkspaceOp[]
	/** Set when the server included workspace_ops but it failed Zod validation (see parseWorkspaceOps). */
	workspaceOpsParseError?: string
}

export interface CloudAgentCallbacks {
	onText: (content: string) => Promise<void>
	onReasoning: (content: string) => Promise<void>
	onDone: (summary?: string) => Promise<void>
	onError: (message: string) => Promise<void>
}

export interface CloudAgentClientOptions {
	/** Sent as X-API-Key when set. Omit header when unset (some deployments use device token only). */
	apiKey?: string
	/** Aborts in-flight fetch when signalled (e.g. user cancelled the task). */
	signal?: AbortSignal
	/** Per-request timeout in ms; 0 or unset means no timeout. */
	requestTimeoutMs?: number
}

/** POST /v1/compile response from the cloud server. */
export interface CloudCompileResponse {
	success: boolean
	output: string
}

export interface CloudCompileResult {
	success: boolean
	output: string
}

// ---------------------------------------------------------------------------
// Deferred execution protocol (POST /v1/deferred/start, /v1/deferred/resume)
// ---------------------------------------------------------------------------

/** A single tool call the server wants the extension to execute locally. */
export interface DeferredToolCall {
	call_id: string
	tool: string
	arguments: Record<string, unknown>
}

/** Result of a locally-executed tool call, sent back to the server. */
export interface DeferredToolResult {
	call_id: string
	content: string
	is_error: boolean
}

/** Response shape shared by both /v1/deferred/start and /v1/deferred/resume. */
export interface DeferredResponse {
	run_id: string
	status: "pending" | "done"
	/** Tool calls the extension must execute locally before resuming. */
	tool_calls?: DeferredToolCall[]
	/** Structured workspace mutations (same schema as /v1/run). */
	workspace_ops?: WorkspaceOpsEnvelope
	/** Incremental text to display in chat. */
	text?: string
	/** Reasoning / chain-of-thought text. */
	reasoning?: string
	/** Whether the overall task succeeded (present when status == "done"). */
	ok?: boolean
	memory_summary?: string
	logs?: string[]
	tokens_in?: number
	tokens_out?: number
	cost?: number
}
