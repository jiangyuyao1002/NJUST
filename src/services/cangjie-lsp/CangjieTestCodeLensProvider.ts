import * as vscode from "vscode"

const TEST_CLASS_RE = /^\s*@Test\b/
const TEST_CASE_RE = /^\s*@TestCase\b/
const FUNC_RE = /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|override\s+)*func\s+(\w+)/
const CLASS_RE = /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|abstract\s+)*class\s+(\w+)/

interface TestTarget {
	name: string
	line: number
	kind: "class" | "func"
}

export class CangjieTestCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = []
		const targets = this.findTestTargets(document)

		for (const target of targets) {
			const range = new vscode.Range(target.line, 0, target.line, 0)

			lenses.push(new vscode.CodeLens(range, {
				title: "$(play) 运行测试",
				command: "njust-ai-cj.cangjieRunTest",
				arguments: [target.name, document.uri],
			}))

			lenses.push(new vscode.CodeLens(range, {
				title: "$(debug-alt) 调试测试",
				command: "njust-ai-cj.cangjieDebugTest",
				arguments: [target.name, document.uri],
			}))
		}

		return lenses
	}

	private findTestTargets(document: vscode.TextDocument): TestTarget[] {
		const targets: TestTarget[] = []
		let inTestClass = false
		let pendingTestCase = false

		for (let i = 0; i < document.lineCount; i++) {
			const text = document.lineAt(i).text

			if (TEST_CLASS_RE.test(text)) {
				inTestClass = true
				continue
			}

			if (TEST_CASE_RE.test(text)) {
				pendingTestCase = true
				continue
			}

			if (inTestClass) {
				const classMatch = text.match(CLASS_RE)
				if (classMatch) {
					targets.push({ name: classMatch[1], line: i, kind: "class" })
					inTestClass = false
					continue
				}
			}

			if (pendingTestCase || inTestClass) {
				const funcMatch = text.match(FUNC_RE)
				if (funcMatch) {
					targets.push({ name: funcMatch[1], line: i, kind: "func" })
					pendingTestCase = false
					continue
				}
			}

			const trimmed = text.trim()
			if (trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("@")) {
				if (pendingTestCase) pendingTestCase = false
				if (inTestClass && !CLASS_RE.test(trimmed)) inTestClass = false
			}
		}

		return targets
	}
}
