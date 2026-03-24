import * as vscode from "vscode"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"

/**
 * Enhanced RenameProvider that compares LSP rename results with the local
 * symbol index. When discrepancies are detected, warns the user and offers
 * an index-based rename that may cover additional references.
 */
export class CangjieEnhancedRenameProvider implements vscode.RenameProvider {
	private inLspRename = false

	constructor(private readonly index: CangjieSymbolIndex) {}

	prepareRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.Range | undefined {
		const wordRange = document.getWordRangeAtPosition(position)
		if (!wordRange) return undefined

		const word = document.getText(wordRange)
		if (!word || word.length < 2) return undefined

		const defs = this.index.findDefinitions(word)
		if (defs.length === 0) return undefined

		return wordRange
	}

	async provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		_token: vscode.CancellationToken,
	): Promise<vscode.WorkspaceEdit | undefined> {
		// When VS Code dispatches executeDocumentRenameProvider it re-enters
		// all registered RenameProviders. Skip our logic on re-entry so only
		// the LSP provider responds, avoiding infinite recursion.
		if (this.inLspRename) return undefined

		const wordRange = document.getWordRangeAtPosition(position)
		if (!wordRange) return undefined

		const oldName = document.getText(wordRange)
		if (!oldName || oldName.length < 2) return undefined

		const lspEdit = await this.tryLspRename(document, position, newName)
		const indexRefs = this.index.findReferences(oldName)

		const lspLocCount = lspEdit ? this.countLocations(lspEdit) : 0
		const indexLocCount = indexRefs.length

		if (lspEdit && indexLocCount > lspLocCount) {
			const diff = indexLocCount - lspLocCount
			const choice = await vscode.window.showWarningMessage(
				`LSP 重命名找到 ${lspLocCount} 处引用，本地索引发现 ${indexLocCount} 处（多 ${diff} 处）。是否使用增强版重命名？`,
				"使用增强版（本地索引）",
				"使用 LSP 结果",
				"取消",
			)

			if (choice === "使用增强版（本地索引）") {
				return this.buildIndexRenameEdit(oldName, newName, indexRefs)
			} else if (choice === "使用 LSP 结果") {
				return lspEdit
			}
			return undefined
		}

		if (lspEdit) return lspEdit

		if (indexRefs.length > 0) {
			return this.buildIndexRenameEdit(oldName, newName, indexRefs)
		}

		return undefined
	}

	private async tryLspRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
	): Promise<vscode.WorkspaceEdit | undefined> {
		this.inLspRename = true
		try {
			const result = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
				"vscode.executeDocumentRenameProvider",
				document.uri,
				position,
				newName,
			)
			return result && this.countLocations(result) > 0 ? result : undefined
		} catch {
			return undefined
		} finally {
			this.inLspRename = false
		}
	}

	private countLocations(edit: vscode.WorkspaceEdit): number {
		let count = 0
		for (const [, edits] of edit.entries()) {
			count += edits.length
		}
		return count
	}

	private buildIndexRenameEdit(
		oldName: string,
		newName: string,
		refs: Array<{ filePath: string; line: number; column: number }>,
	): vscode.WorkspaceEdit {
		const edit = new vscode.WorkspaceEdit()
		for (const ref of refs) {
			const uri = vscode.Uri.file(ref.filePath)
			const range = new vscode.Range(
				ref.line, ref.column,
				ref.line, ref.column + oldName.length,
			)
			edit.replace(uri, range, newName)
		}
		return edit
	}
}
