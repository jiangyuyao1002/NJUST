/**
 * Cangjie (.cj) source code parser that extracts definitions without tree-sitter.
 *
 * Two strategies are available:
 *  1. Regex-based heuristic parser (fast, no external dependency)
 *  2. `cjc --dump-ast` integration (optional, requires the Cangjie SDK)
 *
 * The regex parser is always used as the primary parser for
 * `parseSourceCodeDefinitionsForFile` (folded context).
 * The cjc-based parser is attempted first when configured; the regex
 * parser serves as the fallback.
 */

import * as vscode from "vscode"
import { execFile } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as fs from "fs"
import { QueryCapture } from "web-tree-sitter"
import { Package } from "../../shared/package"

const execFileAsync = promisify(execFile)

// ─── MockNode / MockCapture (same pattern as markdownParser.ts) ───

interface MockNode {
	startPosition: { row: number }
	endPosition: { row: number }
	text: string
	parent?: MockNode
}

interface MockCapture {
	node: MockNode
	name: string
	patternIndex: number
}

// ─── Definition types we look for ───

export type CangjieDefKind =
	| "class"
	| "struct"
	| "interface"
	| "enum"
	| "func"
	| "extend"
	| "type_alias"
	| "var"
	| "let"
	| "main"
	| "macro"
	| "package"
	| "import"

export interface CangjieDef {
	kind: CangjieDefKind
	name: string
	startLine: number // 0-based
	endLine: number // 0-based
}

// ─── Regex-based heuristic parser ───

const MODIFIER_PREFIX = `(?:(?:public|protected|private|internal|open|abstract|sealed|override|static|mut|unsafe|foreign)\\s+)*`

const DEF_PATTERNS: { kind: CangjieDefKind; re: RegExp }[] = [
	{ kind: "class", re: new RegExp(`^\\s*${MODIFIER_PREFIX}class\\s+(\\w+)`) },
	{ kind: "struct", re: new RegExp(`^\\s*${MODIFIER_PREFIX}struct\\s+(\\w+)`) },
	{ kind: "interface", re: new RegExp(`^\\s*${MODIFIER_PREFIX}interface\\s+(\\w+)`) },
	{ kind: "enum", re: new RegExp(`^\\s*${MODIFIER_PREFIX}enum\\s+(\\w+)`) },
	{ kind: "func", re: new RegExp(`^\\s*${MODIFIER_PREFIX}func\\s+(\\w+)`) },
	{ kind: "macro", re: new RegExp(`^\\s*${MODIFIER_PREFIX}macro\\s+(\\w+)`) },
	{ kind: "extend", re: new RegExp(`^\\s*${MODIFIER_PREFIX}extend\\s+(\\w[\\w<>, ]*?)\\s*(<:|\\{)`) },
	{ kind: "type_alias", re: new RegExp(`^\\s*${MODIFIER_PREFIX}type\\s+(\\w+)\\s*=`) },
	{ kind: "var", re: new RegExp(`^\\s*${MODIFIER_PREFIX}var\\s+(\\w+)`) },
	{ kind: "let", re: new RegExp(`^\\s*${MODIFIER_PREFIX}let\\s+(\\w+)`) },
	{ kind: "main", re: /^\s*main\s*\(/ },
	{ kind: "package", re: /^\s*(?:macro\s+)?package\s+(\S+)/ },
	{ kind: "import", re: /^\s*(?:internal\s+)?import\s+(\S+)/ },
]

/**
 * Find the closing brace that matches the opening brace at `openLine`.
 * Returns the 0-based line index of the `}`, or `openLine` if none found.
 */
function findClosingBrace(lines: string[], openLine: number): number {
	let depth = 0
	for (let i = openLine; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === "{") depth++
			if (ch === "}") {
				depth--
				if (depth === 0) return i
			}
		}
	}
	return openLine
}

/**
 * Determine whether a definition kind is a "block" definition (has `{ ... }`).
 */
function isBlockDef(kind: CangjieDefKind): boolean {
	return ["class", "struct", "interface", "enum", "func", "extend", "main", "macro"].includes(kind)
}

/**
 * Fast regex-based parser. Returns definitions found in the source.
 */
export function parseCangjieDefinitions(content: string): CangjieDef[] {
	const lines = content.split("\n")
	const defs: CangjieDef[] = []
	const processedLines = new Set<number>()

	for (let i = 0; i < lines.length; i++) {
		if (processedLines.has(i)) continue
		const line = lines[i]

		// Skip blank lines and pure comments
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
			continue
		}

		for (const { kind, re } of DEF_PATTERNS) {
			const match = line.match(re)
			if (!match) continue

			const name = match[1] ?? kind
			let endLine = i

			if (isBlockDef(kind)) {
				if (line.includes("{")) {
					endLine = findClosingBrace(lines, i)
				} else {
					// Opening brace may be on the next line
					for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
						if (lines[j].includes("{")) {
							endLine = findClosingBrace(lines, j)
							break
						}
					}
				}
			}

			// Top-level var/let: single-line unless it contains a lambda
			if ((kind === "var" || kind === "let") && line.includes("{")) {
				endLine = findClosingBrace(lines, i)
			}

			defs.push({ kind, name, startLine: i, endLine })

			// Mark lines within this definition to avoid duplicate matches on the same opening line
			for (let k = i; k <= endLine; k++) {
				processedLines.add(k)
			}
			break // First matching pattern wins
		}
	}

	return defs
}

/**
 * Convert extracted definitions into mock QueryCaptures compatible with
 * processCaptures() in tree-sitter/index.ts.
 */
export function cangjieDefsToCaptures(defs: CangjieDef[], lines: string[]): QueryCapture[] {
	const captures: MockCapture[] = []

	for (const def of defs) {
		// Skip imports / package headers — they are single-line and not structural
		if (def.kind === "import" || def.kind === "package") continue

		const node: MockNode = {
			startPosition: { row: def.startLine },
			endPosition: { row: def.endLine },
			text: def.name,
		}

		captures.push({
			node,
			name: `name.definition.${def.kind}`,
			patternIndex: 0,
		})

		captures.push({
			node,
			name: `definition.${def.kind}`,
			patternIndex: 0,
		})
	}

	return captures as QueryCapture[]
}

/**
 * High-level entry: parse a Cangjie source string and return mock captures.
 */
export function parseCangjie(content: string): QueryCapture[] {
	if (!content || content.trim() === "") return []
	const defs = parseCangjieDefinitions(content)
	return cangjieDefsToCaptures(defs, content.split("\n"))
}

// ─── cjc --dump-ast integration (optional, best-effort) ───

interface CjcAstNode {
	type: string
	name?: string
	startLine?: number
	endLine?: number
	children: CjcAstNode[]
}

/**
 * Resolve the `cjc` executable path from configuration or environment.
 */
function resolveCjcPath(): string | undefined {
	const configured = vscode.workspace
		.getConfiguration(Package.name)
		.get<string>("cangjieLsp.cjcPath", "")

	if (configured) {
		const resolved = path.resolve(configured)
		if (fs.existsSync(resolved)) return resolved
		return undefined
	}

	const cangjieHome = process.env.CANGJIE_HOME
	if (cangjieHome) {
		const candidates = [
			path.join(cangjieHome, "bin", "cjc.exe"),
			path.join(cangjieHome, "bin", "cjc"),
		]
		for (const c of candidates) {
			if (fs.existsSync(c)) return c
		}
	}

	return process.platform === "win32" ? "cjc.exe" : "cjc"
}

/**
 * Parse the tree-structured text output of `cjc --dump-ast --dump-to-screen`.
 *
 * Example fragment:
 * ```
 * ClassDecl {
 *   -identifier: Token {
 *     value: "Data"
 *     kind: IDENTIFIER
 *     pos: 1: 7
 *   }
 *   ...
 * }
 * ```
 */
function parseCjcDumpOutput(output: string): CjcAstNode[] {
	const nodes: CjcAstNode[] = []
	const lines = output.split("\n")

	const nodeStartRe = /^(\s*)(?:-?\w+:\s*)?(\w+)\s*\{/
	const identifierValueRe = /^\s*value:\s*"(.+)"/
	const posRe = /^\s*pos:\s*(\d+):\s*(\d+)/

	interface ParseCtx {
		type: string
		indent: number
		name?: string
		startLine?: number
	}

	const stack: ParseCtx[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		const startMatch = line.match(nodeStartRe)
		if (startMatch) {
			const indent = startMatch[1].length
			const nodeType = startMatch[2]
			stack.push({ type: nodeType, indent })
			continue
		}

		if (stack.length > 0) {
			const current = stack[stack.length - 1]

			const idMatch = line.match(identifierValueRe)
			if (idMatch && !current.name) {
				current.name = idMatch[1]
			}

			const posMatch = line.match(posRe)
			if (posMatch && current.startLine === undefined) {
				current.startLine = parseInt(posMatch[1]) - 1 // Convert to 0-based
			}
		}

		if (line.trim() === "}") {
			const finished = stack.pop()
			if (finished) {
				const declTypes = [
					"ClassDecl", "StructDecl", "InterfaceDecl", "EnumDecl",
					"FuncDecl", "MacroDecl", "VarDecl", "MainDecl",
					"ExtendDecl", "TypeAliasDecl",
				]
				if (declTypes.includes(finished.type)) {
					nodes.push({
						type: finished.type,
						name: finished.name,
						startLine: finished.startLine,
						children: [],
					})
				}
			}
		}
	}

	return nodes
}

function cjcNodeKindToDefKind(nodeType: string): CangjieDefKind {
	const map: Record<string, CangjieDefKind> = {
		ClassDecl: "class",
		StructDecl: "struct",
		InterfaceDecl: "interface",
		EnumDecl: "enum",
		FuncDecl: "func",
		MacroDecl: "macro",
		VarDecl: "var",
		MainDecl: "main",
		ExtendDecl: "extend",
		TypeAliasDecl: "type_alias",
	}
	return map[nodeType] ?? "func"
}

/**
 * Run `cjc --dump-ast --dump-to-screen` on a file and convert the output
 * to CangjieDef[]. Returns undefined if cjc is not available or fails.
 */
export async function parseCangjieCjcAst(filePath: string): Promise<CangjieDef[] | undefined> {
	const cjcPath = resolveCjcPath()
	if (!cjcPath) return undefined

	try {
		const { stdout } = await execFileAsync(
			cjcPath,
			["--dump-ast", "--dump-to-screen", filePath],
			{ timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
		)

		const astNodes = parseCjcDumpOutput(stdout)
		if (astNodes.length === 0) return undefined

		// Read the source file to compute end-lines via brace matching
		const content = fs.readFileSync(filePath, "utf-8")
		const sourceLines = content.split("\n")

		return astNodes.map((node) => {
			const startLine = node.startLine ?? 0
			let endLine = startLine

			if (["ClassDecl", "StructDecl", "InterfaceDecl", "EnumDecl", "FuncDecl", "MacroDecl", "ExtendDecl", "MainDecl"].includes(node.type)) {
				// Find the closing brace from source
				for (let j = startLine; j < Math.min(startLine + 3, sourceLines.length); j++) {
					if (sourceLines[j].includes("{")) {
						endLine = findClosingBrace(sourceLines, j)
						break
					}
				}
			}

			return {
				kind: cjcNodeKindToDefKind(node.type),
				name: node.name ?? node.type,
				startLine,
				endLine,
			}
		})
	} catch {
		return undefined
	}
}

/**
 * Try cjc AST first, fall back to regex parser.
 * Used for code-index integration where richer structure is beneficial.
 */
export async function parseCangjieWithFallback(
	filePath: string,
	content: string,
): Promise<CangjieDef[]> {
	const cjcDefs = await parseCangjieCjcAst(filePath)
	if (cjcDefs && cjcDefs.length > 0) return cjcDefs
	return parseCangjieDefinitions(content)
}
