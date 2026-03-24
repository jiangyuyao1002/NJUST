import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { execFile } from "child_process"
import { promisify } from "util"
import { Package } from "../../shared/package"
import { detectCangjieHome } from "./cangjieToolUtils"

const execFileAsync = promisify(execFile)
const DISMISSED_KEY = "cangjie.sdkSetupDismissed"
const DOWNLOAD_URL = "https://cangjie-lang.cn/download"

async function validateSdk(sdkPath: string): Promise<string | undefined> {
	const exeName = process.platform === "win32" ? "cjc.exe" : "cjc"
	const candidates = [
		path.join(sdkPath, "bin", exeName),
		path.join(sdkPath, "tools", "bin", exeName),
	]

	for (const cjcPath of candidates) {
		if (!fs.existsSync(cjcPath)) continue
		try {
			const { stdout } = await execFileAsync(cjcPath, ["--version"], { timeout: 10_000 })
			const version = stdout.trim().split("\n")[0]
			return version || "unknown version"
		} catch {
			continue
		}
	}
	return undefined
}

async function configureSdkPath(sdkPath: string): Promise<void> {
	const config = vscode.workspace.getConfiguration(Package.name)
	const lspExe = process.platform === "win32" ? "LSPServer.exe" : "LSPServer"
	const lspCandidates = [
		path.join(sdkPath, "bin", lspExe),
		path.join(sdkPath, "tools", "bin", lspExe),
	]
	const lspPath = lspCandidates.find((p) => fs.existsSync(p))
	if (lspPath) {
		await config.update("cangjieLsp.serverPath", lspPath, vscode.ConfigurationTarget.Global)
	}
}

async function promptManualSelect(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
	const uris = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		canSelectMany: false,
		openLabel: "选择仓颉 SDK 目录",
	})

	if (!uris || uris.length === 0) return

	const selectedPath = uris[0].fsPath
	const version = await validateSdk(selectedPath)

	if (version) {
		await configureSdkPath(selectedPath)
		vscode.window.showInformationMessage(`仓颉 SDK 已配置成功（${version}）`)
		outputChannel.appendLine(`[CangjieSdkSetup] SDK configured at ${selectedPath} (${version})`)
	} else {
		const retry = await vscode.window.showWarningMessage(
			`所选目录下未找到有效的 cjc 编译器。请确认选择了正确的 SDK 根目录。`,
			"重新选择",
			"取消",
		)
		if (retry === "重新选择") {
			await promptManualSelect(context, outputChannel)
		}
	}
}

export async function checkAndPromptSdkSetup(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	if (context.globalState.get<boolean>(DISMISSED_KEY)) {
		return
	}

	const config = vscode.workspace.getConfiguration(Package.name)
	const configuredServerPath = config.get<string>("cangjieLsp.serverPath", "")
	if (configuredServerPath && fs.existsSync(configuredServerPath)) {
		return
	}

	const detectedHome = detectCangjieHome()

	if (detectedHome) {
		const version = await validateSdk(detectedHome)
		const label = version ? `（${version}）` : ""

		const choice = await vscode.window.showInformationMessage(
			`检测到仓颉 SDK 位于 ${detectedHome}${label}，是否自动配置？`,
			"是",
			"手动选择",
			"忽略",
		)

		if (choice === "是") {
			await configureSdkPath(detectedHome)
			vscode.window.showInformationMessage(`仓颉 SDK 已自动配置${label}`)
			outputChannel.appendLine(`[CangjieSdkSetup] Auto-configured SDK at ${detectedHome} ${label}`)
		} else if (choice === "手动选择") {
			await promptManualSelect(context, outputChannel)
		} else {
			await context.globalState.update(DISMISSED_KEY, true)
		}
	} else {
		const choice = await vscode.window.showWarningMessage(
			"未检测到仓颉 SDK。请配置 SDK 路径以启用完整的仓颉语言支持。",
			"选择 SDK 目录",
			"下载 SDK",
			"稍后",
		)

		if (choice === "选择 SDK 目录") {
			await promptManualSelect(context, outputChannel)
		} else if (choice === "下载 SDK") {
			vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL))
		} else {
			await context.globalState.update(DISMISSED_KEY, true)
		}
	}
}
