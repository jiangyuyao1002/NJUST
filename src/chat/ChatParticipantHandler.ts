import * as vscode from "vscode"

import type { ClineProvider } from "../core/webview/ClineProvider"
import type { ClineMessage } from "@njust-ai-cj/types"

const PARTICIPANT_ID = "njust-ai-cj.agent"

const COMMAND_MODE_MAP: Record<string, string> = {
	code: "code",
	architect: "architect",
	ask: "ask",
	debug: "debug",
	plan: "orchestrator",
	cangjie: "cangjie",
}

interface RooChatResult extends vscode.ChatResult {
	metadata: {
		command: string
		taskId?: string
	}
}

/**
 * Bridges VSCode's Chat Participant API with the existing ClineProvider/Task system.
 * Users can invoke @roo in the native VSCode chat panel to leverage the full
 * Agent capabilities (file editing, terminal execution, code search, etc.).
 */
export class ChatParticipantHandler {
	private participant: vscode.ChatParticipant
	private activeStreams: Map<string, vscode.ChatResponseStream> = new Map()

	constructor(
		private readonly provider: ClineProvider,
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
	) {
		this.participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, this.handleRequest.bind(this))
		this.participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "icon.png")
		this.participant.followupProvider = {
			provideFollowups: this.provideFollowups.bind(this),
		}

		context.subscriptions.push(this.participant)
		context.subscriptions.push(
			this.participant.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
				this.outputChannel.appendLine(
					`[ChatParticipant] Feedback received: ${feedback.kind === vscode.ChatResultFeedbackKind.Helpful ? "helpful" : "unhelpful"}`,
				)
			}),
		)
	}

	private async handleRequest(
		request: vscode.ChatRequest,
		chatContext: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<RooChatResult> {
		const command = request.command || "code"
		const modeSlug = COMMAND_MODE_MAP[command] || "code"

		stream.progress(`Starting Roo Agent in ${modeSlug} mode...`)

		try {
			const previousMessages = this.buildContextFromHistory(chatContext)
			const fullPrompt = previousMessages
				? `${previousMessages}\n\nUser: ${request.prompt}`
				: request.prompt

			await this.provider.handleModeSwitch(modeSlug as any)

			const task = await this.provider.createTask(fullPrompt)
			const taskId = task.taskId

			this.activeStreams.set(taskId, stream)

			await this.streamTaskOutput(task, stream, token)

			this.activeStreams.delete(taskId)

			return {
				metadata: {
					command,
					taskId,
				},
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			stream.markdown(`**Error:** ${message}`)
			this.outputChannel.appendLine(`[ChatParticipant] Error: ${message}`)
			return { metadata: { command } }
		}
	}

	private async streamTaskOutput(
		task: any,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<void> {
		return new Promise<void>((resolve) => {
			let lastMessageCount = 0
			let resolved = false

			const cleanup = () => {
				if (resolved) return
				resolved = true
				clearInterval(pollInterval)
			}

			token.onCancellationRequested(() => {
				task.abortTask?.()
				cleanup()
				resolve()
			})

			const pollInterval = setInterval(() => {
				if (resolved) {
					clearInterval(pollInterval)
					return
				}

				try {
					const messages: ClineMessage[] = task.clineMessages || []

					for (let i = lastMessageCount; i < messages.length; i++) {
						const msg = messages[i]
						this.renderClineMessage(msg, stream)
					}
					lastMessageCount = messages.length

					if (task.didFinishAbortingStream || task.abandoned) {
						cleanup()
						resolve()
					}
				} catch {
					cleanup()
					resolve()
				}
			}, 200)

			const checkCompletion = () => {
				if (resolved) return

				const messages: ClineMessage[] = task.clineMessages || []
				const lastMsg = messages[messages.length - 1]

				if (lastMsg?.type === "say" && lastMsg.say === "completion_result") {
					cleanup()
					resolve()
				}
			}

			task.on?.("message", checkCompletion)
			task.on?.("taskCompleted", () => {
				cleanup()
				resolve()
			})

			setTimeout(() => {
				if (!resolved) {
					cleanup()
					resolve()
				}
			}, 5 * 60 * 1000)
		})
	}

	private renderClineMessage(msg: ClineMessage, stream: vscode.ChatResponseStream): void {
		if (msg.type === "say") {
			switch (msg.say) {
				case "text":
					if (msg.text) {
						stream.markdown(msg.text)
					}
					break
				case "tool":
					if (msg.text) {
						try {
							const toolData = JSON.parse(msg.text)
							stream.progress(`Using tool: ${toolData.tool || "unknown"}`)
						} catch {
							stream.progress("Executing tool...")
						}
					}
					break
				case "completion_result":
					if (msg.text) {
						stream.markdown(`\n\n---\n**Result:** ${msg.text}`)
					}
					break
				case "error":
					if (msg.text) {
						stream.markdown(`\n**Error:** ${msg.text}`)
					}
					break
				case "shell_integration_warning":
					break
				default:
					break
			}
		} else if (msg.type === "ask") {
			switch (msg.ask) {
				case "tool":
					if (msg.text) {
						try {
							const toolData = JSON.parse(msg.text)
							stream.markdown(
								`\n> **Tool approval needed:** ${toolData.tool || "unknown"}\n> Use the Roo sidebar to approve or reject.\n`,
							)
						} catch {
							stream.markdown("\n> **Tool approval needed.** Use the Roo sidebar to approve or reject.\n")
						}
					}
					break
				case "followup":
					if (msg.text) {
						stream.markdown(`\n**Question:** ${msg.text}\n`)
					}
					break
				default:
					break
			}
		}
	}

	private buildContextFromHistory(chatContext: vscode.ChatContext): string | undefined {
		const relevantHistory = chatContext.history.filter(
			(h) => h instanceof vscode.ChatRequestTurn || h instanceof vscode.ChatResponseTurn,
		)

		if (relevantHistory.length === 0) {
			return undefined
		}

		const parts: string[] = []
		for (const turn of relevantHistory) {
			if (turn instanceof vscode.ChatRequestTurn) {
				parts.push(`User: ${turn.prompt}`)
			} else if (turn instanceof vscode.ChatResponseTurn) {
				const text = turn.response
					.filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
					.map((r) => r.value.value)
					.join("")
				if (text) {
					parts.push(`Assistant: ${text}`)
				}
			}
		}

		return parts.join("\n")
	}

	private provideFollowups(
		result: RooChatResult,
		_context: vscode.ChatContext,
		_token: vscode.CancellationToken,
	): vscode.ChatFollowup[] {
		const followups: vscode.ChatFollowup[] = []

		if (result.metadata.command === "architect") {
			followups.push({
				prompt: "Now implement the plan",
				label: "Implement the plan",
				command: "code",
			})
		} else if (result.metadata.command === "code") {
			followups.push({
				prompt: "Explain what was changed",
				label: "Explain changes",
				command: "ask",
			})
			followups.push({
				prompt: "Debug and fix any issues",
				label: "Debug issues",
				command: "debug",
			})
		} else if (result.metadata.command === "ask") {
			followups.push({
				prompt: "Write code based on this explanation",
				label: "Write code",
				command: "code",
			})
		}

		return followups
	}

	public getActiveStream(taskId: string): vscode.ChatResponseStream | undefined {
		return this.activeStreams.get(taskId)
	}

	dispose(): void {
		this.activeStreams.clear()
	}
}
