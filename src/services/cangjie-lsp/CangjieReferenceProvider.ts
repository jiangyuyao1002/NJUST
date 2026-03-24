import * as vscode from "vscode"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"

/**
 * Fallback ReferenceProvider for Cangjie files. Uses the local symbol index
 * to find all text-based references to a symbol across the workspace.
 * VS Code merges results from multiple providers.
 */
export class CangjieReferenceProvider implements vscode.ReferenceProvider {
	constructor(private readonly index: CangjieSymbolIndex) {}

	provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.ReferenceContext,
		_token: vscode.CancellationToken,
	): vscode.Location[] | undefined {
		const wordRange = document.getWordRangeAtPosition(position)
		if (!wordRange) return undefined

		const word = document.getText(wordRange)
		if (!word || word.length < 2) return undefined

		const refs = this.index.findReferences(word)
		if (refs.length === 0) return undefined

		const locations = refs.map((r) => new vscode.Location(
			vscode.Uri.file(r.filePath),
			new vscode.Position(r.line, r.column),
		))

		if (!context.includeDeclaration) {
			const defs = this.index.findDefinitions(word)
			const defKeys = new Set(defs.map((d) => `${d.filePath}:${d.startLine}`))
			return locations.filter((loc) => !defKeys.has(`${loc.uri.fsPath}:${loc.range.start.line}`))
		}

		return locations
	}
}
