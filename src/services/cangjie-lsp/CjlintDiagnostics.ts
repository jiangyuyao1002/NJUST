import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"

const execFileAsync = promisify(execFile)

interface CjlintEntry {
	defect_id?: string
	rule_id?: string
	file?: string
	path?: string
	line?: string | number
	colum?: string | number
	column?: string | number
	severity?: string
	level?: string
	message?: string
	description?: string
}

export class CjlintDiagnostics implements vscode.Disposable {
	private diagnosticCollection: vscode.DiagnosticCollection
	private disposables: vscode.Disposable[] = []
	private running = false

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("cjlint")
		this.disposables.push(this.diagnosticCollection)

		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (doc.languageId === "cangjie") {
					void this.lintWorkspace()
				}
			}),
		)

		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => {
				if (doc.languageId === "cangjie") {
					void this.lintWorkspace()
				}
			}),
		)
	}

	async lintWorkspace(): Promise<void> {
		if (this.running) return
		this.running = true

		try {
			const cjlintPath = resolveCangjieToolPath("cjlint", "cangjieTools.cjlintPath")
			if (!cjlintPath) {
				return
			}

			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) return

			this.diagnosticCollection.clear()
			const allDiagnostics = new Map<string, vscode.Diagnostic[]>()

			for (const folder of workspaceFolders) {
				const srcDir = path.join(folder.uri.fsPath, "src")
				const targetDir = fs.existsSync(srcDir) ? srcDir : folder.uri.fsPath

				if (!fs.existsSync(targetDir)) continue

				const tmpReport = path.join(os.tmpdir(), `cjlint_report_${Date.now()}`)

				try {
					await execFileAsync(
						cjlintPath,
						["-f", targetDir, "-r", "json", "-o", tmpReport],
						{ timeout: 60_000, cwd: folder.uri.fsPath, env: buildCangjieToolEnv() as NodeJS.ProcessEnv },
					)
				} catch {
					// cjlint may exit with non-zero when issues are found
				}

				const reportPath = `${tmpReport}.json`
				if (!fs.existsSync(reportPath)) {
					// Try without extension
					if (fs.existsSync(tmpReport)) {
						this.parseReport(tmpReport, folder.uri.fsPath, allDiagnostics)
					}
					continue
				}

				this.parseReport(reportPath, folder.uri.fsPath, allDiagnostics)

				try { fs.unlinkSync(reportPath) } catch {}
				try { fs.unlinkSync(tmpReport) } catch {}
			}

			for (const [filePath, diagnostics] of allDiagnostics) {
				const uri = vscode.Uri.file(filePath)
				this.diagnosticCollection.set(uri, diagnostics)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CjLint] Error: ${message}`)
		} finally {
			this.running = false
		}
	}

	private parseReport(
		reportPath: string,
		workspaceRoot: string,
		allDiagnostics: Map<string, vscode.Diagnostic[]>,
	): void {
		try {
			const content = fs.readFileSync(reportPath, "utf-8")
			const data = JSON.parse(content)

			const entries: CjlintEntry[] = Array.isArray(data) ? data : (data.defects || data.results || data.issues || [])

			for (const entry of entries) {
				const filePath = entry.file || entry.path
				if (!filePath) continue

				const absolutePath = path.isAbsolute(filePath)
					? filePath
					: path.resolve(workspaceRoot, filePath)

				const line = Math.max(0, Number(entry.line || 1) - 1)
				const col = Math.max(0, Number(entry.colum || entry.column || 1) - 1)
				const message = entry.message || entry.description || entry.rule_id || entry.defect_id || "lint issue"
				const ruleId = entry.rule_id || entry.defect_id || ""

				const severity = this.mapSeverity(entry.severity || entry.level)

				const range = new vscode.Range(line, col, line, col + 1)
				const diagnostic = new vscode.Diagnostic(
					range,
					ruleId ? `[${ruleId}] ${message}` : message,
					severity,
				)
				diagnostic.source = "cjlint"

				if (!allDiagnostics.has(absolutePath)) {
					allDiagnostics.set(absolutePath, [])
				}
				allDiagnostics.get(absolutePath)!.push(diagnostic)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CjLint] Failed to parse report ${reportPath}: ${message}`)
		}
	}

	private mapSeverity(severity?: string): vscode.DiagnosticSeverity {
		switch (severity?.toLowerCase()) {
			case "error":
				return vscode.DiagnosticSeverity.Error
			case "warning":
			case "warn":
				return vscode.DiagnosticSeverity.Warning
			case "info":
			case "information":
				return vscode.DiagnosticSeverity.Information
			case "hint":
				return vscode.DiagnosticSeverity.Hint
			default:
				return vscode.DiagnosticSeverity.Warning
		}
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
	}
}
