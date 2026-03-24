import * as vscode from "vscode"
import { parseCangjieDefinitions, type CangjieDefKind } from "../tree-sitter/cangjieParser"

const BLOCK_KINDS: CangjieDefKind[] = [
	"class", "struct", "interface", "enum", "func", "extend", "main", "macro",
]

export class CangjieFoldingRangeProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken,
	): vscode.FoldingRange[] {
		const content = document.getText()
		const ranges: vscode.FoldingRange[] = []

		const defs = parseCangjieDefinitions(content)
		for (const def of defs) {
			if (BLOCK_KINDS.includes(def.kind) && def.endLine > def.startLine) {
				ranges.push(new vscode.FoldingRange(def.startLine, def.endLine, vscode.FoldingRangeKind.Region))
			}
		}

		this.addImportFolding(document, ranges)
		this.addCommentFolding(document, ranges)

		return ranges
	}

	private addImportFolding(document: vscode.TextDocument, ranges: vscode.FoldingRange[]): void {
		let importStart = -1
		let importEnd = -1

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text.trim()
			if (/^(?:internal\s+)?import\s+/.test(text)) {
				if (importStart === -1) importStart = i
				importEnd = i
			} else if (importStart !== -1 && text !== "" && !text.startsWith("//")) {
				break
			}
		}

		if (importStart !== -1 && importEnd > importStart) {
			ranges.push(new vscode.FoldingRange(importStart, importEnd, vscode.FoldingRangeKind.Imports))
		}
	}

	private addCommentFolding(document: vscode.TextDocument, ranges: vscode.FoldingRange[]): void {
		let blockStart = -1

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text

			if (text.includes("/*") && !text.includes("*/")) {
				blockStart = i
			} else if (blockStart !== -1 && text.includes("*/")) {
				ranges.push(new vscode.FoldingRange(blockStart, i, vscode.FoldingRangeKind.Comment))
				blockStart = -1
			}

			if (blockStart === -1 && text.trim().startsWith("//")) {
				const commentStart = i
				while (i + 1 < document.lineCount && document.lineAt(i + 1).text.trim().startsWith("//")) {
					i++
				}
				if (i > commentStart) {
					ranges.push(new vscode.FoldingRange(commentStart, i, vscode.FoldingRangeKind.Comment))
				}
			}
		}
	}
}
