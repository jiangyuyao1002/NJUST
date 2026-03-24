import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"

const execFileAsync = promisify(execFile)

const MACRO_CALL_RE = /(?:^|\s)@(\w+)/g
const MACRO_DEF_RE = /^\s*(?:public\s+|private\s+|protected\s+|internal\s+)*macro\s+(\w+)/

/**
 * CodeLens provider that shows "Expand Macro" / "Go to Macro Definition"
 * above lines containing macro invocations (@MacroName).
 */
export class CangjieMacroCodeLensProvider implements vscode.CodeLensProvider {
	constructor(private readonly index: CangjieSymbolIndex) {}

	provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = []

		for (let i = 0; i < document.lineCount; i++) {
			const lineText = document.lineAt(i).text
			MACRO_CALL_RE.lastIndex = 0
			let match: RegExpExecArray | null

			while ((match = MACRO_CALL_RE.exec(lineText)) !== null) {
				const macroName = match[1]
				if (this.isBuiltinAnnotation(macroName)) continue

				const range = new vscode.Range(i, 0, i, 0)

				const macroDefs = this.index.findDefinitionsByKind(macroName, "macro")
				if (macroDefs.length > 0) {
					lenses.push(new vscode.CodeLens(range, {
						title: `$(symbol-event) 跳转到宏定义: ${macroName}`,
						command: "njust-ai-cj.cangjieGoToMacroDef",
						arguments: [macroDefs[0].filePath, macroDefs[0].startLine],
					}))
				}

				lenses.push(new vscode.CodeLens(range, {
					title: `$(unfold) 展开宏: @${macroName}`,
					command: "njust-ai-cj.cangjieExpandMacro",
					arguments: [document.uri, i],
				}))
			}
		}

		return lenses
	}

	private isBuiltinAnnotation(name: string): boolean {
		return ["Test", "TestCase", "Assert", "Deprecated", "Suppress", "Override"].includes(name)
	}
}

/**
 * Hover provider that shows macro expansion preview when hovering over @MacroName.
 */
export class CangjieMacroHoverProvider implements vscode.HoverProvider {
	constructor(private readonly index: CangjieSymbolIndex) {}

	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.Hover | undefined {
		const lineText = document.lineAt(position.line).text
		MACRO_CALL_RE.lastIndex = 0
		let match: RegExpExecArray | null

		while ((match = MACRO_CALL_RE.exec(lineText)) !== null) {
			const macroName = match[1]
			const atIndex = match.index + (match[0].length - macroName.length - 1)
			const nameStart = atIndex + 1

			if (position.character >= atIndex && position.character <= nameStart + macroName.length) {
				const defs = this.index.findDefinitionsByKind(macroName, "macro")

				const md = new vscode.MarkdownString()
				md.appendMarkdown(`**宏调用:** \`@${macroName}\`\n\n`)

				if (defs.length > 0) {
					const def = defs[0]
					md.appendMarkdown(`**定义位置:** ${path.basename(def.filePath)}:${def.startLine + 1}\n\n`)
					md.appendCodeblock(def.signature, "cangjie")
				} else {
					md.appendMarkdown(`*未在本地索引中找到宏定义（可能来自标准库或外部包）*`)
				}

				return new vscode.Hover(md, new vscode.Range(
					position.line, atIndex,
					position.line, nameStart + macroName.length,
				))
			}
		}

		return undefined
	}
}

/**
 * Register commands for macro expansion and navigation.
 */
export function registerMacroCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"njust-ai-cj.cangjieGoToMacroDef",
			async (filePath: string, startLine: number) => {
				const uri = vscode.Uri.file(filePath)
				const doc = await vscode.workspace.openTextDocument(uri)
				const editor = await vscode.window.showTextDocument(doc)
				const pos = new vscode.Position(startLine, 0)
				editor.selection = new vscode.Selection(pos, pos)
				editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"njust-ai-cj.cangjieExpandMacro",
			async (uri: vscode.Uri, _line: number) => {
				const cjcPath = resolveCangjieToolPath("cjc")
				if (!cjcPath) {
					vscode.window.showWarningMessage("未找到 cjc 编译器，无法展开宏。")
					return
				}

				const filePath = uri.fsPath
				if (!fs.existsSync(filePath)) return

				try {
					const { stdout, stderr } = await execFileAsync(
						cjcPath,
						["--expand-macros", "--dump-to-screen", filePath],
						{ timeout: 15_000, env: buildCangjieToolEnv() as NodeJS.ProcessEnv },
					)

					const expanded = stdout || stderr
					if (!expanded || expanded.trim().length === 0) {
						vscode.window.showInformationMessage("宏展开未产生输出（可能 cjc 不支持 --expand-macros 标志）。")
						return
					}

					const doc = await vscode.workspace.openTextDocument({
						content: expanded,
						language: "cangjie",
					})
					await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside })
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					outputChannel.appendLine(`[MacroExpand] Error: ${msg}`)

					if (msg.includes("--expand-macros")) {
						vscode.window.showWarningMessage(
							"当前版本的 cjc 不支持 --expand-macros 参数。宏展开功能需要更高版本的仓颉 SDK。",
						)
					} else {
						vscode.window.showWarningMessage(`宏展开失败: ${msg}`)
					}
				}
			},
		),
	)
}
