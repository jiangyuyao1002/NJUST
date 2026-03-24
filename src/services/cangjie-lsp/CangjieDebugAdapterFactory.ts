import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { detectCangjieHome } from "./cangjieToolUtils"

/**
 * Provides a DebugAdapterDescriptor for the "cangjie" debug type.
 * Looks for the CJDB debugger executable in the Cangjie SDK.
 */
export class CangjieDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(
		session: vscode.DebugSession,
		_executable: vscode.DebugAdapterExecutable | undefined,
	): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		const cangjieHome = detectCangjieHome()
		if (!cangjieHome) {
			vscode.window.showErrorMessage("未找到 CANGJIE_HOME。请配置仓颉 SDK 路径以使用调试功能。")
			return undefined
		}

		const debuggerPath = this.resolveDebuggerPath(cangjieHome)
		if (!debuggerPath) {
			vscode.window.showErrorMessage(
				`未在 SDK 中找到调试器。请确认仓颉 SDK 包含 cjdb 工具。(CANGJIE_HOME=${cangjieHome})`,
			)
			return undefined
		}

		const args = session.configuration.debuggerArgs as string[] || []
		return new vscode.DebugAdapterExecutable(debuggerPath, ["--dap", ...args])
	}

	private resolveDebuggerPath(cangjieHome: string): string | undefined {
		const exeName = process.platform === "win32" ? "cjdb.exe" : "cjdb"
		const candidates = [
			path.join(cangjieHome, "tools", "bin", exeName),
			path.join(cangjieHome, "bin", exeName),
		]
		return candidates.find((p) => fs.existsSync(p))
	}
}

/**
 * Provides initial launch.json configurations for the "cangjie" debug type.
 */
export class CangjieDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		_token?: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor
			if (editor && editor.document.languageId === "cangjie") {
				config.type = "cangjie"
				config.name = "调试仓颉程序"
				config.request = "launch"
				config.program = "${workspaceFolder}/target/output"
				config.cwd = "${workspaceFolder}"
				config.preLaunchTask = "cjpm: build"
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("请在 launch.json 中配置 program 路径").then(
				() => undefined,
			)
		}

		config.cwd = config.cwd || folder?.uri.fsPath || "${workspaceFolder}"

		return config
	}

	provideDebugConfigurations(
		_folder: vscode.WorkspaceFolder | undefined,
		_token?: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.DebugConfiguration[]> {
		return [
			{
				type: "cangjie",
				request: "launch",
				name: "调试仓颉程序",
				program: "${workspaceFolder}/target/output",
				args: [],
				cwd: "${workspaceFolder}",
				preLaunchTask: "cjpm: build",
			},
			{
				type: "cangjie",
				request: "launch",
				name: "调试仓颉测试",
				program: "${workspaceFolder}/target/output",
				args: ["--test"],
				cwd: "${workspaceFolder}",
				preLaunchTask: "cjpm: build",
			},
		]
	}
}
