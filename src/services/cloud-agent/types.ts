export interface CloudRunResponse {
	ok: boolean
	user_goal: string
	memory_summary: string
	logs: string[]
}

export type ToolExecutionHandler = (name: string, args: Record<string, unknown>) => Promise<string>

export interface CloudAgentCallbacks {
	onText: (content: string) => Promise<void>
	onReasoning: (content: string) => Promise<void>
	onDone: (summary?: string) => Promise<void>
	onError: (message: string) => Promise<void>
	onToolExecution: ToolExecutionHandler
}
