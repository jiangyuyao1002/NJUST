import * as vscode from "vscode"

import { CodeActionName, CodeActionId } from "@njust-ai-cj/types"
import { Package } from "../shared/package"

import { getCodeActionCommand } from "../utils/commands"
import { EditorUtils } from "../integrations/editor/EditorUtils"
import { CJC_ERROR_PATTERNS } from "../core/prompts/sections/cangjie-context"

export const TITLES: Record<CodeActionName, string> = {
	EXPLAIN: "Explain with NJUST_AI_CJ",
	FIX: "Fix with NJUST_AI_CJ",
	IMPROVE: "Improve with NJUST_AI_CJ",
	ADD_TO_CONTEXT: "Add to NJUST_AI_CJ",
	NEW_TASK: "New NJUST_AI_CJ Task",
} as const

/**
 * For Cangjie files, enrich diagnostic data with matched error pattern
 * suggestions so the AI gets targeted fix guidance.
 */
function enrichCangjieFixData(diagnostics: ReturnType<typeof EditorUtils.createDiagnosticData>[]): typeof diagnostics {
	return diagnostics.map((d) => {
		for (const pattern of CJC_ERROR_PATTERNS) {
			if (pattern.pattern.test(d.message)) {
				return {
					...d,
					message: `${d.message}\n[仓颉修复建议] ${pattern.suggestion}`,
				}
			}
		}
		return d
	})
}

export class CodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
		vscode.CodeActionKind.RefactorRewrite,
	]

	private createAction(
		title: string,
		kind: vscode.CodeActionKind,
		command: CodeActionId,
		args: any[],
	): vscode.CodeAction {
		const action = new vscode.CodeAction(title, kind)
		action.command = { command: getCodeActionCommand(command), title, arguments: args }
		return action
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		try {
			if (!vscode.workspace.getConfiguration(Package.name).get<boolean>("enableCodeActions", true)) {
				return []
			}

			const effectiveRange = EditorUtils.getEffectiveRange(document, range)

			if (!effectiveRange) {
				return []
			}

			const filePath = EditorUtils.getFilePath(document)
			const isCangjie = document.languageId === "cangjie"
			const actions: vscode.CodeAction[] = []

			actions.push(
				this.createAction(TITLES.ADD_TO_CONTEXT, vscode.CodeActionKind.QuickFix, "addToContext", [
					filePath,
					effectiveRange.text,
					effectiveRange.range.start.line + 1,
					effectiveRange.range.end.line + 1,
				]),
			)

			if (context.diagnostics.length > 0) {
				const relevantDiagnostics = context.diagnostics.filter((d) =>
					EditorUtils.hasIntersectingRange(effectiveRange.range, d.range),
				)

				if (relevantDiagnostics.length > 0) {
					let diagData = relevantDiagnostics.map(EditorUtils.createDiagnosticData)
					if (isCangjie) {
						diagData = enrichCangjieFixData(diagData)
					}

					actions.push(
						this.createAction(TITLES.FIX, vscode.CodeActionKind.QuickFix, "fixCode", [
							filePath,
							effectiveRange.text,
							effectiveRange.range.start.line + 1,
							effectiveRange.range.end.line + 1,
							diagData,
						]),
					)
				}
			} else {
				actions.push(
					this.createAction(TITLES.EXPLAIN, vscode.CodeActionKind.QuickFix, "explainCode", [
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
					]),
				)

				actions.push(
					this.createAction(TITLES.IMPROVE, vscode.CodeActionKind.QuickFix, "improveCode", [
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
					]),
				)
			}

			return actions
		} catch (error) {
			console.error("Error providing code actions:", error)
			return []
		}
	}
}
