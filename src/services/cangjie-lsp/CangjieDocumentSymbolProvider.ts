import * as vscode from "vscode"
import { parseCangjieDefinitions, type CangjieDef, type CangjieDefKind } from "../tree-sitter/cangjieParser"

const KIND_MAP: Record<CangjieDefKind, vscode.SymbolKind> = {
	class: vscode.SymbolKind.Class,
	struct: vscode.SymbolKind.Struct,
	interface: vscode.SymbolKind.Interface,
	enum: vscode.SymbolKind.Enum,
	func: vscode.SymbolKind.Function,
	main: vscode.SymbolKind.Function,
	macro: vscode.SymbolKind.Function,
	extend: vscode.SymbolKind.Namespace,
	var: vscode.SymbolKind.Variable,
	let: vscode.SymbolKind.Variable,
	type_alias: vscode.SymbolKind.TypeParameter,
	package: vscode.SymbolKind.Package,
	import: vscode.SymbolKind.Module,
}

function defToSymbol(def: CangjieDef, document: vscode.TextDocument): vscode.DocumentSymbol {
	const startLine = Math.max(0, def.startLine)
	const endLine = Math.min(document.lineCount - 1, def.endLine)
	const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length)
	const selectionRange = new vscode.Range(startLine, 0, startLine, document.lineAt(startLine).text.length)
	const kind = KIND_MAP[def.kind] ?? vscode.SymbolKind.Variable

	return new vscode.DocumentSymbol(
		def.name || def.kind,
		def.kind,
		kind,
		range,
		selectionRange,
	)
}

function isContainer(kind: CangjieDefKind): boolean {
	return ["class", "struct", "interface", "enum", "extend"].includes(kind)
}

function buildHierarchy(defs: CangjieDef[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
	const filtered = defs.filter((d) => d.kind !== "import")
	const symbols = filtered.map((d) => ({ def: d, symbol: defToSymbol(d, document) }))

	const roots: vscode.DocumentSymbol[] = []

	for (let i = 0; i < symbols.length; i++) {
		const { def, symbol } = symbols[i]
		let added = false

		if (!isContainer(def.kind)) {
			for (let j = i - 1; j >= 0; j--) {
				const parent = symbols[j]
				if (
					isContainer(parent.def.kind) &&
					parent.def.startLine <= def.startLine &&
					parent.def.endLine >= def.endLine
				) {
					parent.symbol.children.push(symbol)
					added = true
					break
				}
			}
		}

		if (!added) {
			roots.push(symbol)
		}
	}

	return roots
}

export class CangjieDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): vscode.DocumentSymbol[] {
		const content = document.getText()
		const defs = parseCangjieDefinitions(content)

		if (defs.length === 0) return []

		return buildHierarchy(defs, document)
	}
}
