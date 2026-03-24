import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"
import type { CangjieLspClient } from "./CangjieLspClient"

interface CjpmCommandDef {
	id: string
	label: string
	cjpmArg: string
}

const CJPM_COMMANDS: CjpmCommandDef[] = [
	{ id: "njust-ai-cj.cangjieBuild", label: "Cangjie: Build (cjpm build)", cjpmArg: "build" },
	{ id: "njust-ai-cj.cangjieRun", label: "Cangjie: Run (cjpm run)", cjpmArg: "run" },
	{ id: "njust-ai-cj.cangjieTest", label: "Cangjie: Test (cjpm test)", cjpmArg: "test" },
	{ id: "njust-ai-cj.cangjieCheck", label: "Cangjie: Check (cjpm check)", cjpmArg: "check" },
	{ id: "njust-ai-cj.cangjieClean", label: "Cangjie: Clean (cjpm clean)", cjpmArg: "clean" },
]

function findCjpmRoot(): string | undefined {
	const folders = vscode.workspace.workspaceFolders
	if (!folders) return undefined

	for (const folder of folders) {
		const tomlPath = path.join(folder.uri.fsPath, "cjpm.toml")
		if (fs.existsSync(tomlPath)) {
			return folder.uri.fsPath
		}
	}

	return folders[0]?.uri.fsPath
}

function runCjpmCommand(cjpmArg: string): void {
	const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
	if (!cjpmPath) {
		vscode.window.showErrorMessage("cjpm not found. Set CANGJIE_HOME or configure njust-ai-cj.cangjieTools.cjpmPath.")
		return
	}

	const cwd = findCjpmRoot()
	if (!cwd) {
		vscode.window.showErrorMessage("No workspace folder open.")
		return
	}

	const terminal = vscode.window.createTerminal({
		name: `cjpm ${cjpmArg}`,
		cwd,
		env: buildCangjieToolEnv() as Record<string, string>,
	})
	terminal.show()
	const cmd = process.platform === "win32"
		? `& "${cjpmPath}" ${cjpmArg}`
		: `"${cjpmPath}" ${cjpmArg}`
	terminal.sendText(cmd)
}

export function registerCangjieCommands(
	context: vscode.ExtensionContext,
	lspClient: CangjieLspClient,
): void {
	for (const cmd of CJPM_COMMANDS) {
		context.subscriptions.push(
			vscode.commands.registerCommand(cmd.id, () => runCjpmCommand(cmd.cjpmArg)),
		)
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai-cj.cangjieRestartLsp", async () => {
			vscode.window.showInformationMessage("Restarting Cangjie Language Server…")
			await lspClient.restart()
			vscode.window.showInformationMessage("Cangjie Language Server restarted.")
		}),
	)
}
