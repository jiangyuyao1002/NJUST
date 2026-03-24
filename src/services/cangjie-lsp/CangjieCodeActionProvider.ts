import * as vscode from "vscode"

interface QuickFixPattern {
	pattern: RegExp
	createFix: (document: vscode.TextDocument, diagnostic: vscode.Diagnostic, match: RegExpMatchArray) => vscode.CodeAction | undefined
}

const STDLIB_IMPORT_HINTS: Record<string, string> = {
	ArrayList: "std.collection",
	HashMap: "std.collection",
	HashSet: "std.collection",
	LinkedList: "std.collection",
	File: "std.fs",
	Path: "std.fs",
	Socket: "std.net",
	HttpClient: "std.net",
	Mutex: "std.sync",
	AtomicInt: "std.sync",
	AtomicBool: "std.sync",
	Duration: "std.time",
	DateTime: "std.time",
	Regex: "std.regex",
	Random: "std.random",
	Process: "std.process",
	StringBuilder: "std.core",
	Console: "std.console",
}

function findInsertPosition(document: vscode.TextDocument): vscode.Position {
	let lastImportLine = -1
	let packageLine = -1
	for (let i = 0; i < Math.min(document.lineCount, 50); i++) {
		const text = document.lineAt(i).text.trim()
		if (text.startsWith("package ")) {
			packageLine = i
		}
		if (text.startsWith("import ")) {
			lastImportLine = i
		}
	}
	if (lastImportLine >= 0) {
		return new vscode.Position(lastImportLine + 1, 0)
	}
	if (packageLine >= 0) {
		return new vscode.Position(packageLine + 1, 0)
	}
	return new vscode.Position(0, 0)
}

const QUICK_FIX_PATTERNS: QuickFixPattern[] = [
	{
		pattern: /(?:undeclared|cannot find|not found|未找到符号|unresolved)\b.*?\b(\w+)/i,
		createFix(document, diagnostic, match) {
			const symbolName = match[1]
			const pkg = STDLIB_IMPORT_HINTS[symbolName]
			if (!pkg) return undefined

			const importLine = `import ${pkg}.*\n`
			const pos = findInsertPosition(document)

			const existingText = document.getText()
			if (existingText.includes(`import ${pkg}`)) return undefined

			const action = new vscode.CodeAction(
				`添加 import ${pkg}.*`,
				vscode.CodeActionKind.QuickFix,
			)
			action.diagnostics = [diagnostic]
			action.isPreferred = true
			const edit = new vscode.WorkspaceEdit()
			edit.insert(document.uri, pos, importLine)
			action.edit = edit
			return action
		},
	},
	{
		pattern: /(?:immutable|cannot assign|let.*reassign|不可变|mut.*let|let.*mut)/i,
		createFix(document, diagnostic) {
			const line = diagnostic.range.start.line

			for (let i = line; i >= Math.max(0, line - 10); i--) {
				const lineText = document.lineAt(i).text
				const letMatch = lineText.match(/^(\s*)let\b/)
				if (letMatch) {
					const action = new vscode.CodeAction(
						`将 let 改为 var`,
						vscode.CodeActionKind.QuickFix,
					)
					action.diagnostics = [diagnostic]
					const edit = new vscode.WorkspaceEdit()
					const letStart = lineText.indexOf("let")
					edit.replace(
						document.uri,
						new vscode.Range(i, letStart, i, letStart + 3),
						"var",
					)
					action.edit = edit
					return action
				}
			}
			return undefined
		},
	},
	{
		pattern: /(?:non-exhaustive|not exhaustive|未穷尽|incomplete match)/i,
		createFix(document, diagnostic) {
			const matchLine = diagnostic.range.start.line

			for (let i = matchLine; i < Math.min(document.lineCount, matchLine + 30); i++) {
				const lineText = document.lineAt(i).text
				if (lineText.trim() === "}") {
					const indent = lineText.match(/^(\s*)/)?.[1] || ""
					const action = new vscode.CodeAction(
						`添加 case _ => 通配分支`,
						vscode.CodeActionKind.QuickFix,
					)
					action.diagnostics = [diagnostic]
					const edit = new vscode.WorkspaceEdit()
					edit.insert(
						document.uri,
						new vscode.Position(i, 0),
						`${indent}\tcase _ => ()\n`,
					)
					action.edit = edit
					return action
				}
			}
			return undefined
		},
	},
	{
		pattern: /(?:missing return|no return|缺少返回|return expected)/i,
		createFix(document, diagnostic) {
			const line = diagnostic.range.start.line

			for (let i = line; i < Math.min(document.lineCount, line + 20); i++) {
				const lineText = document.lineAt(i).text
				if (lineText.trim() === "}") {
					const indent = lineText.match(/^(\s*)/)?.[1] || ""
					const action = new vscode.CodeAction(
						`在函数末尾添加 return`,
						vscode.CodeActionKind.QuickFix,
					)
					action.diagnostics = [diagnostic]
					const edit = new vscode.WorkspaceEdit()
					edit.insert(
						document.uri,
						new vscode.Position(i, 0),
						`${indent}\treturn 0\n`,
					)
					action.edit = edit
					return action
				}
			}
			return undefined
		},
	},
	{
		pattern: /(?:missing import|import.*not found|未导入)\b.*?\b(\w+)/i,
		createFix(document, diagnostic, match) {
			const symbolName = match[1]
			const pkg = STDLIB_IMPORT_HINTS[symbolName]
			if (!pkg) return undefined

			const existingText = document.getText()
			if (existingText.includes(`import ${pkg}`)) return undefined

			const importLine = `import ${pkg}.*\n`
			const pos = findInsertPosition(document)

			const action = new vscode.CodeAction(
				`添加 import ${pkg}.*`,
				vscode.CodeActionKind.QuickFix,
			)
			action.diagnostics = [diagnostic]
			action.isPreferred = true
			const edit = new vscode.WorkspaceEdit()
			edit.insert(document.uri, pos, importLine)
			action.edit = edit
			return action
		},
	},
]

export class CangjieCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix]

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = []

		for (const diagnostic of context.diagnostics) {
			for (const pattern of QUICK_FIX_PATTERNS) {
				const match = diagnostic.message.match(pattern.pattern)
				if (match) {
					const action = pattern.createFix(document, diagnostic, match)
					if (action) {
						actions.push(action)
					}
				}
			}
		}

		return actions
	}
}
