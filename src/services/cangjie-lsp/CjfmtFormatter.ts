import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"

const execFileAsync = promisify(execFile)

export class CjfmtFormatter implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider, vscode.Disposable {
	private disposables: vscode.Disposable[] = []

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		this.disposables.push(
			vscode.languages.registerDocumentFormattingEditProvider(
				{ language: "cangjie", scheme: "file" },
				this,
			),
		)
		this.disposables.push(
			vscode.languages.registerDocumentRangeFormattingEditProvider(
				{ language: "cangjie", scheme: "file" },
				this,
			),
		)
	}

	async provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		_options: vscode.FormattingOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		return this.formatDocument(document, token)
	}

	async provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		_options: vscode.FormattingOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		return this.formatDocument(document, token, range)
	}

	private async formatDocument(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
		range?: vscode.Range,
	): Promise<vscode.TextEdit[]> {
		const t0 = Date.now()
		const cjfmtPath = resolveCangjieToolPath("cjfmt", "cangjieTools.cjfmtPath")
		if (!cjfmtPath) {
			this.outputChannel.appendLine("[CjFmt] cjfmt not found. Set njust-ai-cj.cangjieTools.cjfmtPath or CANGJIE_HOME.")
			return []
		}

		const originalContent = document.getText()
		const tmpDir = os.tmpdir()
		const tmpInput = path.join(tmpDir, `cjfmt_input_${Date.now()}.cj`)
		const tmpOutput = path.join(tmpDir, `cjfmt_output_${Date.now()}.cj`)

		try {
			fs.writeFileSync(tmpInput, originalContent, "utf-8")

			const args = ["-f", tmpInput, "-o", tmpOutput]

			if (range) {
				const startLine = range.start.line + 1
				const endLine = range.end.line + 1
				args.push("-l", `${startLine}:${endLine}`)
			}

			if (token.isCancellationRequested) return []

			await execFileAsync(cjfmtPath, args, { timeout: 30_000, env: buildCangjieToolEnv() as NodeJS.ProcessEnv })

			if (token.isCancellationRequested) return []

			if (!fs.existsSync(tmpOutput)) {
				this.outputChannel.appendLine("[CjFmt] No output file produced.")
				return []
			}

			const formattedContent = fs.readFileSync(tmpOutput, "utf-8")

			if (formattedContent === originalContent) return []

			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(originalContent.length),
			)

			this.outputChannel.appendLine(
				`[Perf] cjfmt formatted ${path.basename(document.fileName)} in ${Date.now() - t0}ms`,
			)

			return [vscode.TextEdit.replace(fullRange, formattedContent)]
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CjFmt] Error: ${message}`)
			return []
		} finally {
			try { fs.unlinkSync(tmpInput) } catch {}
			try { fs.unlinkSync(tmpOutput) } catch {}
		}
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
	}
}
