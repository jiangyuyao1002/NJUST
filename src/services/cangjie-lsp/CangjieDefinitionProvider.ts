import * as vscode from "vscode"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"

/**
 * Fallback DefinitionProvider for Cangjie files. Queries the local symbol
 * index for cross-file go-to-definition when the LSP doesn't return results.
 * VS Code merges results from multiple providers.
 */
export class CangjieDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private readonly index: CangjieSymbolIndex) {}

	provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.Location[] | undefined {
		const wordRange = document.getWordRangeAtPosition(position)
		if (!wordRange) return undefined

		const word = document.getText(wordRange)
		if (!word || word.length < 2) return undefined

		const defs = this.index.findDefinitions(word)
		if (defs.length === 0) return undefined

		return defs.map((d) => new vscode.Location(
			vscode.Uri.file(d.filePath),
			new vscode.Range(d.startLine, 0, d.startLine, d.signature.length),
		))
	}
}
