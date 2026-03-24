import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

// ---------------------------------------------------------------------------
// Language-specific import extraction patterns
// ---------------------------------------------------------------------------

interface ImportResult {
	raw: string
	modulePath: string
}

interface LanguageImportConfig {
	languageIds: string[]
	extensions: string[]
	patterns: RegExp[]
	resolve: (imp: ImportResult, cwd: string, filePath: string) => string | null
	extractDefinitions: (content: string) => SimpleDef[]
}

interface SimpleDef {
	kind: string
	name: string
	signature: string
	line: number
}

interface ResolvedFileContext {
	filePath: string
	relPath: string
	importPath: string
	definitions: SimpleDef[]
}

const MAX_RESOLVED_FILES = 15
const MAX_DEFS_PER_FILE = 20
const MAX_TOTAL_DEFS = 80

// ---------------------------------------------------------------------------
// Definition extractors (lightweight regex, no tree-sitter dependency)
// ---------------------------------------------------------------------------

const CPP_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^[ \t]*(?:template\s*<[^>]*>\s*)?class\s+(\w+)/,           kind: "class" },
	{ re: /^[ \t]*(?:template\s*<[^>]*>\s*)?struct\s+(\w+)/,          kind: "struct" },
	{ re: /^[ \t]*enum\s+(?:class\s+)?(\w+)/,                         kind: "enum" },
	{ re: /^[ \t]*namespace\s+(\w+)/,                                  kind: "namespace" },
	{ re: /^[ \t]*typedef\s+.+\s+(\w+)\s*;/,                          kind: "typedef" },
	{ re: /^[ \t]*using\s+(\w+)\s*=/,                                  kind: "using" },
	{ re: /^[ \t]*(?:(?:static|inline|virtual|explicit|constexpr|extern|friend)\s+)*(?:[\w:*&<>,\s]+)\s+(\w+)\s*\(/, kind: "func" },
]

const JAVA_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^[ \t]*(?:public|private|protected)?\s*(?:abstract|final|static)?\s*class\s+(\w+)/,       kind: "class" },
	{ re: /^[ \t]*(?:public|private|protected)?\s*interface\s+(\w+)/,                                 kind: "interface" },
	{ re: /^[ \t]*(?:public|private|protected)?\s*enum\s+(\w+)/,                                      kind: "enum" },
	{ re: /^[ \t]*(?:public|private|protected)?\s*@interface\s+(\w+)/,                                kind: "annotation" },
	{ re: /^[ \t]*(?:public|private|protected)?\s*(?:abstract|static|final|synchronized|native)?\s*(?:[\w<>,\[\]\s]+)\s+(\w+)\s*\(/, kind: "method" },
]

const PYTHON_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^class\s+(\w+)/,                  kind: "class" },
	{ re: /^def\s+(\w+)/,                    kind: "func" },
	{ re: /^async\s+def\s+(\w+)/,            kind: "func" },
	{ re: /^(\w+)\s*:\s*TypeAlias/,           kind: "type" },
]

const GO_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^type\s+(\w+)\s+struct\b/,        kind: "struct" },
	{ re: /^type\s+(\w+)\s+interface\b/,      kind: "interface" },
	{ re: /^type\s+(\w+)\s+/,                 kind: "type" },
	{ re: /^func\s+(?:\(\s*\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/, kind: "func" },
]

const RUST_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+struct\s+(\w+)/,  kind: "struct" },
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+enum\s+(\w+)/,    kind: "enum" },
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+trait\s+(\w+)/,   kind: "trait" },
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+fn\s+(\w+)/,      kind: "fn" },
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+type\s+(\w+)/,    kind: "type" },
	{ re: /^[ \t]*pub(?:\([\w:]+\))?\s+mod\s+(\w+)/,     kind: "mod" },
	{ re: /^[ \t]*struct\s+(\w+)/,                         kind: "struct" },
	{ re: /^[ \t]*enum\s+(\w+)/,                           kind: "enum" },
	{ re: /^[ \t]*trait\s+(\w+)/,                          kind: "trait" },
	{ re: /^[ \t]*fn\s+(\w+)/,                             kind: "fn" },
]

const TS_DEF_PATTERNS: Array<{ re: RegExp; kind: string }> = [
	{ re: /^[ \t]*export\s+(?:default\s+)?class\s+(\w+)/,          kind: "class" },
	{ re: /^[ \t]*export\s+(?:default\s+)?interface\s+(\w+)/,      kind: "interface" },
	{ re: /^[ \t]*export\s+(?:default\s+)?type\s+(\w+)/,           kind: "type" },
	{ re: /^[ \t]*export\s+(?:default\s+)?enum\s+(\w+)/,           kind: "enum" },
	{ re: /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/, kind: "func" },
	{ re: /^[ \t]*export\s+(?:const|let|var)\s+(\w+)/,             kind: "const" },
	{ re: /^[ \t]*class\s+(\w+)/,                                   kind: "class" },
	{ re: /^[ \t]*interface\s+(\w+)/,                                kind: "interface" },
	{ re: /^[ \t]*type\s+(\w+)/,                                    kind: "type" },
	{ re: /^[ \t]*enum\s+(\w+)/,                                    kind: "enum" },
]

function extractDefs(content: string, patterns: Array<{ re: RegExp; kind: string }>): SimpleDef[] {
	const lines = content.split("\n")
	const defs: SimpleDef[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		for (const { re, kind } of patterns) {
			const m = line.match(re)
			if (m && m[1]) {
				defs.push({ kind, name: m[1], signature: line.trim(), line: i + 1 })
				break
			}
		}
	}

	return defs
}

// ---------------------------------------------------------------------------
// Import pattern extraction per language
// ---------------------------------------------------------------------------

const CPP_INCLUDE_LOCAL = /^\s*#include\s+"([^"]+)"/gm
const CPP_INCLUDE_SYSTEM = /^\s*#include\s+<([^>]+)>/gm

const JAVA_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm

const PYTHON_IMPORT = /^\s*import\s+([\w.]+)/gm
const PYTHON_FROM_IMPORT = /^\s*from\s+([\w.]+)\s+import\s+/gm

const GO_IMPORT_SINGLE = /^\s*import\s+"([^"]+)"/gm
const GO_IMPORT_BLOCK = /import\s*\(\s*([\s\S]*?)\)/gm
const GO_IMPORT_LINE = /"([^"]+)"/g

const RUST_USE = /^\s*(?:pub\s+)?use\s+(?:crate|super|self)(::[\w:*{},\s]+)/gm
const RUST_MOD = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm

const TS_IMPORT = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm
const TS_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm

// ---------------------------------------------------------------------------
// File resolution helpers
// ---------------------------------------------------------------------------

function resolveRelativePath(importPath: string, cwd: string, sourceFile: string): string | null {
	if (!importPath.startsWith(".")) return null
	const dir = path.dirname(sourceFile)
	const resolved = path.resolve(dir, importPath)

	for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".d.ts", "/index.ts", "/index.js"]) {
		const candidate = resolved + ext
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
	}
	return null
}

function findFileInWorkspace(name: string, cwd: string, extensions: string[]): string | null {
	for (const ext of extensions) {
		const candidate = path.join(cwd, name + ext)
		if (fs.existsSync(candidate)) return candidate
	}
	return null
}

function resolveCppInclude(imp: ImportResult, cwd: string, _filePath: string): string | null {
	const p = imp.modulePath
	const dir = path.dirname(_filePath)
	const local = path.resolve(dir, p)
	if (fs.existsSync(local)) return local

	const fromRoot = path.join(cwd, p)
	if (fs.existsSync(fromRoot)) return fromRoot

	for (const incDir of ["include", "src", "lib"]) {
		const candidate = path.join(cwd, incDir, p)
		if (fs.existsSync(candidate)) return candidate
	}
	return null
}

function resolveJavaImport(imp: ImportResult, cwd: string, _filePath: string): string | null {
	const parts = imp.modulePath.replace(/\.\*$/, "").split(".")
	const relPath = parts.join(path.sep)

	for (const srcDir of ["src/main/java", "src", "app/src/main/java"]) {
		const candidate = path.join(cwd, srcDir, relPath + ".java")
		if (fs.existsSync(candidate)) return candidate

		const asDir = path.join(cwd, srcDir, relPath)
		if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) return asDir
	}
	return null
}

function resolvePythonImport(imp: ImportResult, cwd: string, _filePath: string): string | null {
	const parts = imp.modulePath.split(".")
	const relPath = parts.join(path.sep)

	const asFile = path.join(cwd, relPath + ".py")
	if (fs.existsSync(asFile)) return asFile

	const asPackage = path.join(cwd, relPath, "__init__.py")
	if (fs.existsSync(asPackage)) return path.join(cwd, relPath)

	for (const srcDir of ["src", "lib"]) {
		const candidate = path.join(cwd, srcDir, relPath + ".py")
		if (fs.existsSync(candidate)) return candidate
	}
	return null
}

function resolveGoImport(imp: ImportResult, cwd: string, _filePath: string): string | null {
	const p = imp.modulePath
	const candidate = path.join(cwd, p)
	if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate

	const lastSeg = p.split("/").pop() || ""
	const internal = path.join(cwd, "internal", lastSeg)
	if (fs.existsSync(internal)) return internal

	const pkg = path.join(cwd, "pkg", lastSeg)
	if (fs.existsSync(pkg)) return pkg

	return null
}

function resolveRustImport(imp: ImportResult, cwd: string, _filePath: string): string | null {
	const cleaned = imp.modulePath.replace(/^::/, "").split("::")[0]
	if (!cleaned) return null

	const srcFile = path.join(cwd, "src", cleaned + ".rs")
	if (fs.existsSync(srcFile)) return srcFile

	const srcDir = path.join(cwd, "src", cleaned, "mod.rs")
	if (fs.existsSync(srcDir)) return srcDir

	return null
}

function resolveTsImport(imp: ImportResult, cwd: string, filePath: string): string | null {
	return resolveRelativePath(imp.modulePath, cwd, filePath)
}

// ---------------------------------------------------------------------------
// Language configurations
// ---------------------------------------------------------------------------

const LANGUAGE_CONFIGS: LanguageImportConfig[] = [
	{
		languageIds: ["cpp", "c"],
		extensions: [".cpp", ".hpp", ".c", ".h", ".cc", ".cxx", ".hxx"],
		patterns: [CPP_INCLUDE_LOCAL],
		resolve: resolveCppInclude,
		extractDefinitions: (content) => extractDefs(content, CPP_DEF_PATTERNS),
	},
	{
		languageIds: ["java"],
		extensions: [".java"],
		patterns: [JAVA_IMPORT],
		resolve: resolveJavaImport,
		extractDefinitions: (content) => extractDefs(content, JAVA_DEF_PATTERNS),
	},
	{
		languageIds: ["python"],
		extensions: [".py"],
		patterns: [PYTHON_IMPORT, PYTHON_FROM_IMPORT],
		resolve: resolvePythonImport,
		extractDefinitions: (content) => extractDefs(content, PYTHON_DEF_PATTERNS),
	},
	{
		languageIds: ["go"],
		extensions: [".go"],
		patterns: [GO_IMPORT_SINGLE],
		resolve: resolveGoImport,
		extractDefinitions: (content) => extractDefs(content, GO_DEF_PATTERNS),
	},
	{
		languageIds: ["rust"],
		extensions: [".rs"],
		patterns: [RUST_USE, RUST_MOD],
		resolve: resolveRustImport,
		extractDefinitions: (content) => extractDefs(content, RUST_DEF_PATTERNS),
	},
	{
		languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
		extensions: [".ts", ".tsx", ".js", ".jsx"],
		patterns: [TS_IMPORT, TS_REQUIRE],
		resolve: resolveTsImport,
		extractDefinitions: (content) => extractDefs(content, TS_DEF_PATTERNS),
	},
]

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getLanguageConfig(languageId: string): LanguageImportConfig | null {
	return LANGUAGE_CONFIGS.find((c) => c.languageIds.includes(languageId)) || null
}

function extractImportsForLanguage(
	content: string,
	config: LanguageImportConfig,
	languageId: string,
): ImportResult[] {
	const results: ImportResult[] = []
	const seen = new Set<string>()

	if (languageId === "go") {
		GO_IMPORT_BLOCK.lastIndex = 0
		let blockMatch: RegExpExecArray | null
		while ((blockMatch = GO_IMPORT_BLOCK.exec(content)) !== null) {
			GO_IMPORT_LINE.lastIndex = 0
			let lineMatch: RegExpExecArray | null
			while ((lineMatch = GO_IMPORT_LINE.exec(blockMatch[1])) !== null) {
				if (!seen.has(lineMatch[1])) {
					seen.add(lineMatch[1])
					results.push({ raw: lineMatch[0], modulePath: lineMatch[1] })
				}
			}
		}
	}

	for (const pattern of config.patterns) {
		pattern.lastIndex = 0
		let m: RegExpExecArray | null
		while ((m = pattern.exec(content)) !== null) {
			const modulePath = m[1]
			if (!seen.has(modulePath)) {
				seen.add(modulePath)
				results.push({ raw: m[0], modulePath })
			}
		}
	}

	return results
}

function resolveImports(
	imports: ImportResult[],
	config: LanguageImportConfig,
	cwd: string,
	filePath: string,
): ResolvedFileContext[] {
	const resolved: ResolvedFileContext[] = []
	const seenPaths = new Set<string>()

	for (const imp of imports) {
		if (resolved.length >= MAX_RESOLVED_FILES) break

		const resolvedPath = config.resolve(imp, cwd, filePath)
		if (!resolvedPath) continue

		if (fs.statSync(resolvedPath).isDirectory()) {
			const files = collectFilesInDir(resolvedPath, config.extensions, 3)
			for (const f of files) {
				if (seenPaths.has(f) || resolved.length >= MAX_RESOLVED_FILES) continue
				seenPaths.add(f)
				const ctx = extractFileContext(f, imp.modulePath, cwd, config)
				if (ctx) resolved.push(ctx)
			}
		} else {
			if (seenPaths.has(resolvedPath)) continue
			seenPaths.add(resolvedPath)
			const ctx = extractFileContext(resolvedPath, imp.modulePath, cwd, config)
			if (ctx) resolved.push(ctx)
		}
	}

	return resolved
}

function collectFilesInDir(dir: string, extensions: string[], maxFiles: number): string[] {
	const files: string[] = []
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			if (files.length >= maxFiles) break
			if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
				files.push(path.join(dir, entry.name))
			}
		}
	} catch {
		// skip unreadable directories
	}
	return files
}

function extractFileContext(
	filePath: string,
	importPath: string,
	cwd: string,
	config: LanguageImportConfig,
): ResolvedFileContext | null {
	try {
		const content = fs.readFileSync(filePath, "utf-8")
		const defs = config.extractDefinitions(content)
		if (defs.length === 0) return null

		return {
			filePath,
			relPath: path.relative(cwd, filePath).replace(/\\/g, "/"),
			importPath,
			definitions: defs.slice(0, MAX_DEFS_PER_FILE),
		}
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Context formatting
// ---------------------------------------------------------------------------

function formatResolvedContext(contexts: ResolvedFileContext[]): string {
	const sections: string[] = []
	let totalDefs = 0

	for (const ctx of contexts) {
		if (totalDefs >= MAX_TOTAL_DEFS) break

		const defLines = ctx.definitions
			.slice(0, MAX_TOTAL_DEFS - totalDefs)
			.map((d) => `  - ${d.kind} **${d.name}**: \`${d.signature}\` _(line ${d.line})_`)

		sections.push(`**${ctx.relPath}** ← \`${ctx.importPath}\`\n${defLines.join("\n")}`)
		totalDefs += defLines.length
	}

	return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Visible editors context (symbols from all open files of the same language)
// ---------------------------------------------------------------------------

function collectVisibleEditorSymbols(languageId: string, config: LanguageImportConfig): string | null {
	const MAX_VISIBLE_DEFS = 40
	const fileSections: string[] = []
	let total = 0

	for (const editor of vscode.window.visibleTextEditors) {
		if (total >= MAX_VISIBLE_DEFS) break
		const doc = editor.document
		if (!config.languageIds.includes(doc.languageId)) continue

		const content = doc.getText()
		const defs = config.extractDefinitions(content)
		if (defs.length === 0) continue

		const remaining = MAX_VISIBLE_DEFS - total
		const sliced = defs.slice(0, remaining)
		const lines = sliced.map((d) => `- ${d.kind} **${d.name}**: \`${d.signature}\` _(line ${d.line})_`)

		fileSections.push(`**${path.basename(doc.fileName)}**:\n${lines.join("\n")}`)
		total += sliced.length
	}

	if (fileSections.length === 0) return null
	return `## Current Editor Symbols\n\n${fileSections.join("\n\n")}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	cpp: "C/C++",
	c: "C/C++",
	java: "Java",
	python: "Python",
	go: "Go",
	rust: "Rust",
	typescript: "TypeScript",
	typescriptreact: "TypeScript (React)",
	javascript: "JavaScript",
	javascriptreact: "JavaScript (React)",
}

export function getMultiFileContextSection(cwd: string): string {
	const editor = vscode.window.activeTextEditor
	if (!editor) return ""

	const languageId = editor.document.languageId
	const config = getLanguageConfig(languageId)
	if (!config) return ""

	const langName = LANGUAGE_DISPLAY_NAMES[languageId] || languageId

	const sections: string[] = []

	// 1. Symbols from visible editors
	const visibleSymbols = collectVisibleEditorSymbols(languageId, config)
	if (visibleSymbols) sections.push(visibleSymbols)

	// 2. Cross-file symbols from imports
	const content = editor.document.getText()
	const imports = extractImportsForLanguage(content, config, languageId)

	if (imports.length > 0) {
		const resolved = resolveImports(imports, config, cwd, editor.document.fileName)
		if (resolved.length > 0) {
			const formatted = formatResolvedContext(resolved)
			sections.push(
				`## Imported Module Definitions\n\n` +
				`The following symbols are imported in the current file and available for use:\n\n${formatted}`,
			)
		}
	}

	if (sections.length === 0) return ""

	return `====

${langName.toUpperCase()} CROSS-FILE CONTEXT

${sections.join("\n\n")}
`
}

export {
	extractDefs,
	extractImportsForLanguage,
	getLanguageConfig,
	LANGUAGE_CONFIGS,
	type SimpleDef,
	type ImportResult,
	type LanguageImportConfig,
}
