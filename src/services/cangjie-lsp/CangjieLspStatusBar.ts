import * as vscode from "vscode"
import { execFile } from "child_process"
import { promisify } from "util"
import type { CangjieLspState, CangjieLspClient } from "./CangjieLspClient"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"

const execFileAsync = promisify(execFile)
const COMMAND_ID = "njust-ai-cj.cangjieShowLspOutput"

export class CangjieLspStatusBar implements vscode.Disposable {
	private item: vscode.StatusBarItem
	private disposables: vscode.Disposable[] = []
	private sdkVersion: string | undefined

	constructor(lspClient: CangjieLspClient, outputChannel: vscode.OutputChannel) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
		this.item.command = COMMAND_ID

		this.disposables.push(
			vscode.commands.registerCommand(COMMAND_ID, () => {
				outputChannel.show(true)
			}),
		)

		this.disposables.push(
			lspClient.onStateChange((state, message) => this.updateState(state, message)),
		)

		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				this.updateVisibility(editor)
			}),
		)

		this.updateState(lspClient.state)
		this.updateVisibility(vscode.window.activeTextEditor)
		void this.detectSdkVersion()
	}

	private async detectSdkVersion(): Promise<void> {
		try {
			const cjcPath = resolveCangjieToolPath("cjc", "cangjieTools.cjcPath")
			if (!cjcPath) return
			const { stdout } = await execFileAsync(cjcPath, ["--version"], {
				timeout: 5_000,
				env: buildCangjieToolEnv() as NodeJS.ProcessEnv,
			})
			const firstLine = stdout.trim().split("\n")[0]
			if (firstLine) {
				this.sdkVersion = firstLine
				this.updateState(this._lastState, this._lastMessage)
			}
		} catch {
			// SDK not available — no version display
		}
	}

	private _lastState: CangjieLspState = "idle"
	private _lastMessage: string | undefined

	private updateState(state: CangjieLspState, message?: string): void {
		this._lastState = state
		this._lastMessage = message
		const versionSuffix = this.sdkVersion ? ` (${this.sdkVersion})` : ""

		switch (state) {
			case "idle":
				this.item.text = "$(circle-outline) 仓颉 LSP"
				this.item.tooltip = `仓颉语言服务待命中（等待打开 .cj 文件）${versionSuffix}`
				this.item.backgroundColor = undefined
				break
			case "starting":
				this.item.text = "$(sync~spin) 仓颉 LSP"
				this.item.tooltip = `仓颉语言服务启动中…${versionSuffix}`
				this.item.backgroundColor = undefined
				break
			case "running":
				this.item.text = this.sdkVersion ? `$(check) 仓颉 ${this.sdkVersion}` : "$(check) 仓颉 LSP"
				this.item.tooltip = `仓颉语言服务运行中${versionSuffix}`
				this.item.backgroundColor = undefined
				break
			case "warning":
				this.item.text = "$(warning) 仓颉 LSP"
				this.item.tooltip = message ? `仓颉 LSP 警告: ${message}${versionSuffix}` : `仓颉语言服务异常${versionSuffix}`
				this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
				break
			case "error":
				this.item.text = "$(error) 仓颉 LSP"
				this.item.tooltip = message ? `仓颉 LSP 错误: ${message}${versionSuffix}` : `仓颉语言服务启动失败${versionSuffix}`
				this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
				break
			case "stopped":
				this.item.text = "$(circle-slash) 仓颉 LSP"
				this.item.tooltip = `仓颉语言服务已停止${versionSuffix}`
				this.item.backgroundColor = undefined
				break
		}
	}

	private updateVisibility(editor: vscode.TextEditor | undefined): void {
		if (editor && (editor.document.languageId === "cangjie" || editor.document.fileName.endsWith(".cj"))) {
			this.item.show()
		} else {
			this.item.hide()
		}
	}

	dispose(): void {
		this.item.dispose()
		this.disposables.forEach((d) => d.dispose())
	}
}
