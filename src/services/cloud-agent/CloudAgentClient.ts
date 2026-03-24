import type { CloudAgentCallbacks, CloudRunResponse } from "./types"

const CLOUD_API_KEY = "X-20060507012610261002"

export class CloudAgentClient {
	private serverUrl: string
	private deviceToken: string
	private callbacks: CloudAgentCallbacks

	constructor(serverUrl: string, deviceToken: string, callbacks: CloudAgentCallbacks) {
		this.serverUrl = serverUrl.replace(/\/$/, "")
		this.deviceToken = deviceToken
		this.callbacks = callbacks
	}

	async connect(): Promise<void> {
		const resp = await fetch(`${this.serverUrl}/health`)
		if (!resp.ok) {
			throw new Error(`Cloud Agent health check failed: HTTP ${resp.status}`)
		}
	}

	async submitTask(sessionId: string, message: string, workspacePath?: string): Promise<string> {
		const resp = await fetch(`${this.serverUrl}/v1/run`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": CLOUD_API_KEY,
				"X-Device-Token": this.deviceToken,
			},
			body: JSON.stringify({
				goal: message,
				session_id: sessionId,
				workspace_path: workspacePath,
			}),
		})

		if (!resp.ok) {
			const errText = await resp.text()
			throw new Error(`Cloud Agent error (HTTP ${resp.status}): ${errText}`)
		}

		const data: CloudRunResponse = await resp.json()

		for (const log of data.logs || []) {
			await this.callbacks.onText(log)
		}

		if (data.memory_summary) {
			await this.callbacks.onText(data.memory_summary)
		}

		await this.callbacks.onDone(data.ok ? "任务完成" : "任务失败")

		return data.memory_summary || ""
	}

	async disconnect(): Promise<void> {
		// No persistent connection in REST mode
	}
}
