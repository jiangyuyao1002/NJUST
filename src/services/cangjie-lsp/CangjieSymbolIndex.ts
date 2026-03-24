import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { parseCangjieDefinitions, type CangjieDef, type CangjieDefKind } from "../tree-sitter/cangjieParser"

const INDEX_DIR = ".cangjie-index"
const INDEX_FILE = "symbols.json"
const INDEX_VERSION = 1
const REFERENCE_RE = /\b([A-Z]\w+|[a-z_]\w*)\b/g

export interface SymbolEntry {
	name: string
	kind: CangjieDefKind
	filePath: string
	startLine: number
	endLine: number
	signature: string
}

export interface ReferenceEntry {
	filePath: string
	line: number
	column: number
}

interface FileEntry {
	mtime: number
	symbols: SymbolEntry[]
}

interface IndexData {
	version: number
	files: Record<string, FileEntry>
}

export class CangjieSymbolIndex implements vscode.Disposable {
	private static instance: CangjieSymbolIndex | undefined

	private data: IndexData = { version: INDEX_VERSION, files: {} }
	private watcher: vscode.FileSystemWatcher | undefined
	private disposables: vscode.Disposable[] = []
	private indexPath: string | undefined
	private dirty = false
	private flushTimer: ReturnType<typeof setTimeout> | undefined
	private indexing = false

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		CangjieSymbolIndex.instance = this
	}

	static getInstance(): CangjieSymbolIndex | undefined {
		return CangjieSymbolIndex.instance
	}

	async initialize(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) return

		const root = workspaceFolder.uri.fsPath
		const indexDir = path.join(root, INDEX_DIR)
		this.indexPath = path.join(indexDir, INDEX_FILE)

		this.loadFromDisk()

		this.watcher = vscode.workspace.createFileSystemWatcher("**/*.cj")
		this.disposables.push(this.watcher)

		this.watcher.onDidChange((uri) => void this.reindexFile(uri.fsPath))
		this.watcher.onDidCreate((uri) => void this.reindexFile(uri.fsPath))
		this.watcher.onDidDelete((uri) => this.removeFile(uri.fsPath))

		await this.fullIndex(root)
	}

	private loadFromDisk(): void {
		if (!this.indexPath) return
		try {
			if (fs.existsSync(this.indexPath)) {
				const raw = fs.readFileSync(this.indexPath, "utf-8")
				const parsed = JSON.parse(raw) as IndexData
				if (parsed.version === INDEX_VERSION) {
					this.data = parsed
					this.outputChannel.appendLine(`[SymbolIndex] Loaded index with ${Object.keys(this.data.files).length} files`)
				}
			}
		} catch {
			this.data = { version: INDEX_VERSION, files: {} }
		}
	}

	private scheduleSave(): void {
		this.dirty = true
		if (this.flushTimer) return
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined
			this.saveToDisk()
		}, 5_000)
	}

	private saveToDisk(): void {
		if (!this.indexPath || !this.dirty) return
		try {
			const dir = path.dirname(this.indexPath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(this.indexPath, JSON.stringify(this.data), "utf-8")
			this.dirty = false
		} catch (err) {
			this.outputChannel.appendLine(`[SymbolIndex] Failed to save: ${err}`)
		}
	}

	private async fullIndex(root: string): Promise<void> {
		if (this.indexing) return
		this.indexing = true
		const t0 = Date.now()

		try {
			const files = await vscode.workspace.findFiles("**/*.cj", "**/target/**", 2000)
			let updated = 0

			for (const uri of files) {
				const filePath = uri.fsPath
				const stat = fs.statSync(filePath)
				const mtime = stat.mtimeMs
				const existing = this.data.files[filePath]

				if (existing && existing.mtime >= mtime) continue

				await this.reindexFile(filePath)
				updated++
			}

			const staleFiles = Object.keys(this.data.files).filter((f) => !fs.existsSync(f))
			for (const f of staleFiles) {
				delete this.data.files[f]
			}

			if (updated > 0 || staleFiles.length > 0) {
				this.scheduleSave()
			}

			this.outputChannel.appendLine(
				`[Perf] Symbol index built in ${Date.now() - t0}ms (${files.length} files, ${updated} updated, ${staleFiles.length} removed)`,
			)
		} finally {
			this.indexing = false
		}
	}

	async reindexFile(filePath: string): Promise<void> {
		if (!filePath.endsWith(".cj")) return

		try {
			const stat = fs.statSync(filePath)
			const content = fs.readFileSync(filePath, "utf-8")
			const defs = parseCangjieDefinitions(content)
			const lines = content.split("\n")

			const symbols: SymbolEntry[] = defs
				.filter((d) => d.kind !== "import" && d.kind !== "package")
				.map((d) => ({
					name: d.name,
					kind: d.kind,
					filePath,
					startLine: d.startLine,
					endLine: d.endLine,
					signature: lines[d.startLine]?.trim() || "",
				}))

			this.data.files[filePath] = { mtime: stat.mtimeMs, symbols }
			this.scheduleSave()
		} catch {
			// File may have been deleted or be unreadable
		}
	}

	private removeFile(filePath: string): void {
		if (this.data.files[filePath]) {
			delete this.data.files[filePath]
			this.scheduleSave()
		}
	}

	// ── Query APIs ──

	findDefinitions(name: string): SymbolEntry[] {
		const results: SymbolEntry[] = []
		for (const file of Object.values(this.data.files)) {
			for (const sym of file.symbols) {
				if (sym.name === name) {
					results.push(sym)
				}
			}
		}
		return results
	}

	findDefinitionsByKind(name: string, kind: CangjieDefKind): SymbolEntry[] {
		return this.findDefinitions(name).filter((s) => s.kind === kind)
	}

	findReferences(name: string): ReferenceEntry[] {
		const results: ReferenceEntry[] = []
		for (const [filePath, fileEntry] of Object.entries(this.data.files)) {
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const lines = content.split("\n")
				for (let i = 0; i < lines.length; i++) {
					let match: RegExpExecArray | null
					REFERENCE_RE.lastIndex = 0
					while ((match = REFERENCE_RE.exec(lines[i])) !== null) {
						if (match[1] === name) {
							results.push({ filePath, line: i, column: match.index })
						}
					}
				}
			} catch {
				// Skip unreadable files
			}
		}
		return results
	}

	findSymbolsByPrefix(prefix: string, limit = 50): SymbolEntry[] {
		const results: SymbolEntry[] = []
		const lowerPrefix = prefix.toLowerCase()
		for (const file of Object.values(this.data.files)) {
			for (const sym of file.symbols) {
				if (sym.name.toLowerCase().startsWith(lowerPrefix)) {
					results.push(sym)
					if (results.length >= limit) return results
				}
			}
		}
		return results
	}

	getAllSymbols(): SymbolEntry[] {
		const all: SymbolEntry[] = []
		for (const file of Object.values(this.data.files)) {
			all.push(...file.symbols)
		}
		return all
	}

	getSymbolsByDirectory(dirPath: string): SymbolEntry[] {
		const normalized = dirPath.replace(/\\/g, "/")
		const results: SymbolEntry[] = []
		for (const [filePath, fileEntry] of Object.entries(this.data.files)) {
			if (filePath.replace(/\\/g, "/").startsWith(normalized)) {
				results.push(...fileEntry.symbols)
			}
		}
		return results
	}

	getIndexedFiles(): string[] {
		return Object.keys(this.data.files)
	}

	get fileCount(): number {
		return Object.keys(this.data.files).length
	}

	get symbolCount(): number {
		let count = 0
		for (const file of Object.values(this.data.files)) {
			count += file.symbols.length
		}
		return count
	}

	dispose(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
		}
		this.saveToDisk()
		this.disposables.forEach((d) => d.dispose())
		if (CangjieSymbolIndex.instance === this) {
			CangjieSymbolIndex.instance = undefined
		}
	}
}
