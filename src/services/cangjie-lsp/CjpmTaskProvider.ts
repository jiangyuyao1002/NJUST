import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { resolveCangjieToolPath } from "./cangjieToolUtils"

const CJPM_TASK_TYPE = "cjpm"

interface CjpmTaskDefinition extends vscode.TaskDefinition {
	command: string
	args?: string[]
}

const CJPM_COMMANDS: { command: string; label: string; group?: vscode.TaskGroup }[] = [
	{ command: "build", label: "cjpm build", group: vscode.TaskGroup.Build },
	{ command: "run", label: "cjpm run" },
	{ command: "test", label: "cjpm test", group: vscode.TaskGroup.Test },
	{ command: "bench", label: "cjpm bench", group: vscode.TaskGroup.Test },
	{ command: "check", label: "cjpm check" },
	{ command: "clean", label: "cjpm clean", group: vscode.TaskGroup.Clean },
	{ command: "init", label: "cjpm init" },
	{ command: "update", label: "cjpm update" },
	{ command: "tree", label: "cjpm tree" },
]

export class CjpmTaskProvider implements vscode.TaskProvider, vscode.Disposable {
	private disposables: vscode.Disposable[] = []
	private fileWatcher: vscode.FileSystemWatcher | undefined

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		this.disposables.push(
			vscode.tasks.registerTaskProvider(CJPM_TASK_TYPE, this),
		)

		this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/cjpm.toml")
		this.fileWatcher.onDidCreate(() => this.onCjpmTomlChanged())
		this.fileWatcher.onDidDelete(() => this.onCjpmTomlChanged())
		this.disposables.push(this.fileWatcher)
	}

	private onCjpmTomlChanged(): void {
		// Force VS Code to re-query tasks
		vscode.commands.executeCommand("workbench.action.tasks.refreshTasks")
	}

	async provideTasks(): Promise<vscode.Task[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders) return []

		const tasks: vscode.Task[] = []

		for (const folder of workspaceFolders) {
			const cjpmToml = path.join(folder.uri.fsPath, "cjpm.toml")
			if (!fs.existsSync(cjpmToml)) continue

			for (const cmd of CJPM_COMMANDS) {
				const task = this.createTask(cmd.command, cmd.label, folder, cmd.group)
				if (task) tasks.push(task)
			}
		}

		return tasks
	}

	resolveTask(task: vscode.Task): vscode.Task | undefined {
		const definition = task.definition as CjpmTaskDefinition
		if (definition.type !== CJPM_TASK_TYPE || !definition.command) {
			return undefined
		}

		const folder = task.scope as vscode.WorkspaceFolder | undefined
		if (!folder) return undefined

		return this.createTask(
			definition.command,
			task.name,
			folder,
			undefined,
			definition.args,
		)
	}

	private createTask(
		command: string,
		label: string,
		folder: vscode.WorkspaceFolder,
		group?: vscode.TaskGroup,
		extraArgs?: string[],
	): vscode.Task | undefined {
		const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
		if (!cjpmPath) return undefined

		const args = [command, ...(extraArgs || [])]

		const definition: CjpmTaskDefinition = {
			type: CJPM_TASK_TYPE,
			command,
			args: extraArgs,
		}

		const execution = new vscode.ShellExecution(cjpmPath, args, {
			cwd: folder.uri.fsPath,
		})

		const task = new vscode.Task(
			definition,
			folder,
			label,
			CJPM_TASK_TYPE,
			execution,
			"$cjc",
		)

		if (group) {
			task.group = group
		}

		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Always,
			panel: vscode.TaskPanelKind.Shared,
		}

		return task
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
	}
}
