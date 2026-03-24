import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"

const execFileAsync = promisify(execFile)

const DEBOUNCE_MS = 1500

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
	private debounceTimer: ReturnType<typeof setTimeout> | undefined

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("cjlint")
		this.disposables.push(this.diagnosticCollection)

		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (doc.languageId === "cangjie") {
					this.debouncedLint(doc.uri)
				}
			}),
		)

		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => {
				if (doc.languageId === "cangjie") {
					this.debouncedLint(doc.uri)
				}
			}),
		)
	}

	private debouncedLint(changedUri?: vscode.Uri): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined
			if (changedUri) {
				void this.lintSingleFile(changedUri)
			} else {
				void this.lintWorkspace()
			}
		}, DEBOUNCE_MS)
	}

	/**
	 * Lint a single file instead of the entire workspace.
	 * Falls back to workspace lint if the file path cannot be resolved.
	 */
	async lintSingleFile(uri: vscode.Uri): Promise<void> {
		if (this.running) return
		this.running = true
		const t0 = Date.now()

		try {
			const cjlintPath = resolveCangjieToolPath("cjlint", "cangjieTools.cjlintPath")
			if (!cjlintPath) return

			const filePath = uri.fsPath
			if (!fs.existsSync(filePath)) return

			const folder = vscode.workspace.getWorkspaceFolder(uri)
			const cwd = folder?.uri.fsPath || path.dirname(filePath)
			const tmpReport = path.join(os.tmpdir(), `cjlint_single_${Date.now()}`)

			try {
				await execFileAsync(
					cjlintPath,
					["-f", filePath, "-r", "json", "-o", tmpReport],
					{ timeout: 30_000, cwd, env: buildCangjieToolEnv() as NodeJS.ProcessEnv },
				)
			} catch {
				// cjlint may exit with non-zero when issues are found
			}

			const allDiagnostics = new Map<string, vscode.Diagnostic[]>()
			const reportPath = `${tmpReport}.json`

			if (fs.existsSync(reportPath)) {
				this.parseReport(reportPath, cwd, allDiagnostics)
				try { fs.unlinkSync(reportPath) } catch {}
			} else if (fs.existsSync(tmpReport)) {
				this.parseReport(tmpReport, cwd, allDiagnostics)
			}
			try { fs.unlinkSync(tmpReport) } catch {}

			const normalized = path.resolve(filePath)
			const fileDiags = allDiagnostics.get(normalized) || []
			const deduplicated = this.deduplicateWithLsp(uri, fileDiags)
			this.diagnosticCollection.set(uri, deduplicated)

			this.outputChannel.appendLine(
				`[Perf] cjlint single-file scan completed in ${Date.now() - t0}ms (${path.basename(filePath)})`,
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CjLint] Error (single file): ${message}`)
		} finally {
			this.running = false
		}
	}

	async lintWorkspace(): Promise<void> {
		if (this.running) return
		this.running = true
		const t0 = Date.now()

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
				const deduplicated = this.deduplicateWithLsp(uri, diagnostics)
				this.diagnosticCollection.set(uri, deduplicated)
			}

			this.outputChannel.appendLine(
				`[Perf] cjlint workspace scan completed in ${Date.now() - t0}ms (${allDiagnostics.size} files)`,
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CjLint] Error: ${message}`)
		} finally {
			this.running = false
		}
	}

	/**
	 * Filter out cjlint diagnostics that overlap with LSP diagnostics
	 * on the same line with similar message content.
	 */
	private deduplicateWithLsp(uri: vscode.Uri, cjlintDiags: vscode.Diagnostic[]): vscode.Diagnostic[] {
		const allExisting = vscode.languages.getDiagnostics(uri)
		const lspDiags = allExisting.filter((d) => d.source !== "cjlint")

		if (lspDiags.length === 0) return cjlintDiags

		return cjlintDiags.filter((cjd) => {
			return !lspDiags.some((lspd) =>
				lspd.range.start.line === cjd.range.start.line &&
				(lspd.message.includes(cjd.message.replace(/^\[.*?\]\s*/, "")) ||
				 cjd.message.replace(/^\[.*?\]\s*/, "").includes(lspd.message)),
			)
		})
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
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.disposables.forEach((d) => d.dispose())
	}
}
