import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import {
	LanguageClient,
	LanguageClientOptions,
	Middleware,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node"
import { Package } from "../../shared/package"

const CANGJIE_LANGUAGE_ID = "cangjie"
const LSP_SERVER_NAME = "Cangjie Language Server"

// ---------------------------------------------------------------------------
// Middleware helpers: debounce high-frequency LSP requests
// ---------------------------------------------------------------------------

function debounceMiddleware<T>(delayMs: number): (
	next: () => vscode.ProviderResult<T>,
) => Thenable<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	let pending: { resolve: (v: T) => void; reject: (e: unknown) => void } | undefined
	let lastResult: T | undefined

	return (next) => {
		if (timer) {
			clearTimeout(timer)
			pending?.resolve(lastResult as T)
		}
		return new Promise<T>((resolve, reject) => {
			pending = { resolve, reject }
			timer = setTimeout(() => {
				timer = undefined
				pending = undefined
				Promise.resolve(next()).then((result) => {
					lastResult = result as T
					resolve(result as T)
				}, reject)
			}, delayMs)
		})
	}
}

function buildMiddleware(): Middleware {
	const hoverDebounce = debounceMiddleware<vscode.Hover | null | undefined>(100)
	const completionDebounce = debounceMiddleware<vscode.CompletionItem[] | vscode.CompletionList | null | undefined>(150)

	return {
		provideHover: (document, position, token, next) =>
			hoverDebounce(() => next(document, position, token)),
		provideCompletionItem: (document, position, context, token, next) =>
			completionDebounce(() => next(document, position, context, token)),
	}
}

// ---------------------------------------------------------------------------
// cjpm.toml package name reader & false-positive diagnostic filter
// ---------------------------------------------------------------------------

const CJPM_PKG_NAME_RE = /^\s*name\s*=\s*"([^"]+)"/m

function readCjpmPackageName(projectRoot: string): string | undefined {
	try {
		const tomlPath = path.join(projectRoot, "cjpm.toml")
		const content = fs.readFileSync(tomlPath, "utf-8")

		const pkgIdx = content.indexOf("[package]")
		if (pkgIdx === -1) return undefined

		const nextSectionIdx = content.indexOf("\n[", pkgIdx + 1)
		const pkgSection = nextSectionIdx === -1
			? content.slice(pkgIdx)
			: content.slice(pkgIdx, nextSectionIdx)

		const match = pkgSection.match(CJPM_PKG_NAME_RE)
		return match ? match[1] : undefined
	} catch {
		return undefined
	}
}

const PKG_SUPPOSED_RE = /package\s+name\s+supposed\s+to\s+be\s+'(\w+)'/i

function filterFalsePackageDiagnostics(
	diagnostics: vscode.Diagnostic[],
	realPackageName: string,
): vscode.Diagnostic[] {
	return diagnostics.filter((diag) => {
		const match = diag.message.match(PKG_SUPPOSED_RE)
		if (!match) return true

		const lspExpected = match[1]
		if (lspExpected === "default" && realPackageName !== "default") {
			return false
		}
		return true
	})
}

interface CangjieLspConfig {
	enabled: boolean
	serverPath: string
	enableLog: boolean
	logPath: string
	disableAutoImport: boolean
}

function getConfig(): CangjieLspConfig {
	const config = vscode.workspace.getConfiguration(Package.name)
	return {
		enabled: config.get<boolean>("cangjieLsp.enabled", true),
		serverPath: config.get<string>("cangjieLsp.serverPath", ""),
		enableLog: config.get<boolean>("cangjieLsp.enableLog", false),
		logPath: config.get<string>("cangjieLsp.logPath", ""),
		disableAutoImport: config.get<boolean>("cangjieLsp.disableAutoImport", false),
	}
}

/**
 * Detect CANGJIE_HOME from environment, configured path, or well-known locations.
 */
export function detectCangjieHome(serverPath?: string): string | undefined {
	if (process.env.CANGJIE_HOME && fs.existsSync(process.env.CANGJIE_HOME)) {
		return process.env.CANGJIE_HOME
	}

	if (serverPath) {
		const resolved = path.resolve(serverPath)
		const binDir = path.dirname(resolved)
		const parentDir = path.dirname(binDir)
		if (fs.existsSync(path.join(parentDir, "runtime")) || fs.existsSync(path.join(parentDir, "lib"))) {
			return parentDir
		}
		const grandParent = path.dirname(parentDir)
		if (fs.existsSync(path.join(grandParent, "runtime")) || fs.existsSync(path.join(grandParent, "lib"))) {
			return grandParent
		}
	}

	const wellKnownPaths = process.platform === "win32"
		? ["D:\\cangjie", "C:\\cangjie", path.join(process.env.LOCALAPPDATA || "", "cangjie")]
		: ["/usr/local/cangjie", path.join(process.env.HOME || "", ".cangjie")]

	for (const p of wellKnownPaths) {
		if (p && fs.existsSync(path.join(p, "bin"))) {
			return p
		}
	}

	return undefined
}

/**
 * Build the environment variables the LSP server needs.
 * Mirrors the logic in envsetup.ps1 / envsetup.sh.
 */
function buildServerEnv(cangjieHome: string): Record<string, string> {
	const env = { ...process.env } as Record<string, string>
	env["CANGJIE_HOME"] = cangjieHome

	const sep = process.platform === "win32" ? ";" : ":"
	const extraPaths: string[] = []

	if (process.platform === "win32") {
		extraPaths.push(path.join(cangjieHome, "runtime", "lib", "windows_x86_64_llvm"))
		extraPaths.push(path.join(cangjieHome, "lib", "windows_x86_64_llvm"))
	} else {
		extraPaths.push(path.join(cangjieHome, "runtime", "lib", "linux_x86_64_llvm"))
		extraPaths.push(path.join(cangjieHome, "lib", "linux_x86_64_llvm"))
	}
	extraPaths.push(path.join(cangjieHome, "bin"))
	extraPaths.push(path.join(cangjieHome, "tools", "bin"))
	extraPaths.push(path.join(cangjieHome, "tools", "lib"))

	const existing = env["PATH"] || env["Path"] || ""
	const pathKey = process.platform === "win32" ? "Path" : "PATH"
	env[pathKey] = extraPaths.filter((p) => fs.existsSync(p)).join(sep) + sep + existing

	if (process.platform !== "win32") {
		const ldPaths = extraPaths.filter((p) => fs.existsSync(p))
		const existingLd = env["LD_LIBRARY_PATH"] || ""
		if (ldPaths.length > 0) {
			env["LD_LIBRARY_PATH"] = ldPaths.join(sep) + (existingLd ? sep + existingLd : "")
		}
	}

	return env
}

/**
 * Try to locate the LSPServer executable by checking:
 * 1. User-configured path
 * 2. CANGJIE_HOME environment variable
 * 3. Well-known install locations
 * 4. System PATH
 */
function resolveServerPath(configuredPath: string, cangjieHome?: string): string | undefined {
	if (configuredPath) {
		const resolved = path.resolve(configuredPath)
		if (fs.existsSync(resolved)) {
			return resolved
		}
		return undefined
	}

	if (cangjieHome) {
		const candidates = [
			path.join(cangjieHome, "bin", "LSPServer.exe"),
			path.join(cangjieHome, "bin", "LSPServer"),
			path.join(cangjieHome, "tools", "bin", "LSPServer.exe"),
			path.join(cangjieHome, "tools", "bin", "LSPServer"),
		]
		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate
			}
		}
	}

	const exeName = process.platform === "win32" ? "LSPServer.exe" : "LSPServer"
	return exeName
}

function buildServerArgs(config: CangjieLspConfig): string[] {
	const args: string[] = []
	if (config.enableLog) {
		args.push("--enable-log=true")
		args.push("-V")
	}
	if (config.logPath) {
		args.push(`--log-path=${config.logPath}`)
	}
	if (config.disableAutoImport) {
		args.push("--disableAutoImport")
	}
	return args
}

export type CangjieLspState = "idle" | "starting" | "running" | "warning" | "error" | "stopped"

export type CangjieLspStateListener = (state: CangjieLspState, message?: string) => void

const MAX_AUTO_RESTARTS = 3
const RESTART_DELAYS_MS = [2_000, 5_000, 10_000]

export class CangjieLspClient {
	private client: LanguageClient | undefined
	private readonly _lspOutputChannel: vscode.OutputChannel
	private configChangeDisposable: vscode.Disposable | undefined
	private lazyStartDisposable: vscode.Disposable | undefined
	private clientStateDisposable: vscode.Disposable | undefined
	private _state: CangjieLspState = "idle"
	private stateListeners: CangjieLspStateListener[] = []
	private onCangjieActivatedCallback: (() => void) | undefined
	private autoRestartCount = 0
	private restartTimer: ReturnType<typeof setTimeout> | undefined
	private firstCompletionLogged = false
	private firstHoverLogged = false

	constructor(private readonly extensionOutputChannel: vscode.OutputChannel) {
		this._lspOutputChannel = vscode.window.createOutputChannel(LSP_SERVER_NAME)
	}

	get lspOutputChannel(): vscode.OutputChannel {
		return this._lspOutputChannel
	}

	get state(): CangjieLspState {
		return this._state
	}

	onStateChange(listener: CangjieLspStateListener): vscode.Disposable {
		this.stateListeners.push(listener)
		return { dispose: () => { this.stateListeners = this.stateListeners.filter((l) => l !== listener) } }
	}

	/**
	 * Register a callback invoked once when the first .cj file is opened,
	 * allowing other Cangjie services (formatter, linter) to defer initialization.
	 */
	onCangjieActivated(callback: () => void): void {
		if (this._state === "running" || this._state === "starting") {
			callback()
		} else {
			this.onCangjieActivatedCallback = callback
		}
	}

	private setState(state: CangjieLspState, message?: string): void {
		this._state = state
		for (const listener of this.stateListeners) {
			listener(state, message)
		}
	}

	/**
	 * Lazy start: if no .cj file is currently open, defer server startup
	 * until the user opens one. This avoids spawning the LSP process for
	 * workspaces that don't contain Cangjie code.
	 */
	async start(): Promise<void> {
		const config = getConfig()

		if (!config.enabled) {
			this.extensionOutputChannel.appendLine("[CangjieLSP] Cangjie LSP is disabled by configuration.")
			this.setState("stopped")
			return
		}

		const hasOpenCangjieFile = vscode.workspace.textDocuments.some(
			(doc) => doc.languageId === CANGJIE_LANGUAGE_ID || doc.fileName.endsWith(".cj"),
		)

		if (hasOpenCangjieFile) {
			await this.doStart(config)
		} else {
			this.extensionOutputChannel.appendLine("[CangjieLSP] No .cj files open — deferring LSP startup.")
			this.setState("idle")
			this.lazyStartDisposable = vscode.workspace.onDidOpenTextDocument(async (doc) => {
				if (doc.languageId === CANGJIE_LANGUAGE_ID || doc.fileName.endsWith(".cj")) {
					this.lazyStartDisposable?.dispose()
					this.lazyStartDisposable = undefined
					await this.doStart(getConfig())
				}
			})
		}

		this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration(`${Package.name}.cangjieLsp`)) {
				this.extensionOutputChannel.appendLine("[CangjieLSP] Configuration changed, restarting server...")
				await this.stop()
				await this.start()
			}
		})
	}

	private findCjpmRoot(): string | undefined {
		const folders = vscode.workspace.workspaceFolders
		if (!folders) return undefined

		for (const folder of folders) {
			const tomlPath = path.join(folder.uri.fsPath, "cjpm.toml")
			if (fs.existsSync(tomlPath)) return folder.uri.fsPath
		}
		return undefined
	}

	private async doStart(config: CangjieLspConfig): Promise<void> {
		this.setState("starting")

		const cangjieHome = detectCangjieHome(config.serverPath)
		this.extensionOutputChannel.appendLine(`[CangjieLSP] Detected CANGJIE_HOME: ${cangjieHome || "(not found)"}`)

		const serverExecutable = resolveServerPath(config.serverPath, cangjieHome)
		if (!serverExecutable) {
			const msg = config.serverPath
				? `Cangjie LSP server not found at configured path: ${config.serverPath}`
				: "Cangjie LSP server not found. Set 'njust-ai-cj.cangjieLsp.serverPath' or the CANGJIE_HOME environment variable."
			vscode.window.showWarningMessage(msg)
			this.extensionOutputChannel.appendLine(`[CangjieLSP] ${msg}`)
			this.setState("warning", msg)
			return
		}

		this.extensionOutputChannel.appendLine(`[CangjieLSP] Starting server: ${serverExecutable}`)

		const args = buildServerArgs(config)
		const serverEnv = cangjieHome ? buildServerEnv(cangjieHome) : { ...process.env }

		if (cangjieHome) {
			this.extensionOutputChannel.appendLine(`[CangjieLSP] Server environment: CANGJIE_HOME=${cangjieHome}`)
		} else {
			this.extensionOutputChannel.appendLine(
				"[CangjieLSP] WARNING: CANGJIE_HOME not detected. The LSP server may fail to start. " +
				"Please set the CANGJIE_HOME environment variable or run envsetup.ps1 from the Cangjie SDK."
			)
		}

		const cjpmRoot = this.findCjpmRoot()
		const serverCwd = cjpmRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

		const serverOptions: ServerOptions = {
			command: serverExecutable,
			args,
			transport: TransportKind.stdio,
			options: {
				env: serverEnv as NodeJS.ProcessEnv,
				cwd: serverCwd,
			},
		}

		if (cjpmRoot) {
			this.extensionOutputChannel.appendLine(`[CangjieLSP] Project root (cjpm.toml): ${cjpmRoot}`)
		}

		const realPackageName = cjpmRoot ? readCjpmPackageName(cjpmRoot) : undefined
		if (realPackageName) {
			this.extensionOutputChannel.appendLine(`[CangjieLSP] Root package name from cjpm.toml: "${realPackageName}"`)
		}

		const self = this
		const baseMiddleware = buildMiddleware()
		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: "file", language: CANGJIE_LANGUAGE_ID }],
			outputChannel: this._lspOutputChannel,
			workspaceFolder: cjpmRoot
				? { uri: vscode.Uri.file(cjpmRoot), name: path.basename(cjpmRoot), index: 0 }
				: undefined,
			initializationOptions: cjpmRoot ? { projectRoot: cjpmRoot } : undefined,
			synchronize: {
				fileEvents: vscode.workspace.createFileSystemWatcher("**/*.cj"),
			},
			middleware: {
				handleDiagnostics(uri, diagnostics, next) {
					if (realPackageName) {
						diagnostics = filterFalsePackageDiagnostics(diagnostics, realPackageName)
					}
					next(uri, diagnostics)
				},
				provideCompletionItem(document, position, context, token, next) {
					const t0 = Date.now()
					const result = baseMiddleware.provideCompletionItem!(document, position, context, token, next)
					if (!self.firstCompletionLogged && result) {
						Promise.resolve(result).then(() => {
							if (!self.firstCompletionLogged) {
								self.firstCompletionLogged = true
								self.extensionOutputChannel.appendLine(`[Perf] First completion response in ${Date.now() - t0}ms`)
							}
						}).catch(() => {})
					}
					return result
				},
				provideHover(document, position, token, next) {
					const t0 = Date.now()
					const result = baseMiddleware.provideHover!(document, position, token, next)
					if (!self.firstHoverLogged && result) {
						Promise.resolve(result).then(() => {
							if (!self.firstHoverLogged) {
								self.firstHoverLogged = true
								self.extensionOutputChannel.appendLine(`[Perf] First hover response in ${Date.now() - t0}ms`)
							}
						}).catch(() => {})
					}
					return result
				},
			},
		}

		this.client = new LanguageClient(
			"cangjieLsp",
			LSP_SERVER_NAME,
			serverOptions,
			clientOptions,
		)

		const startTime = Date.now()
		try {
			await this.client.start()
			const elapsed = Date.now() - startTime
			this.extensionOutputChannel.appendLine(`[Perf] LSP server started in ${elapsed}ms`)
			this.extensionOutputChannel.appendLine("[CangjieLSP] Server started successfully.")
			this.setState("running")
			this.autoRestartCount = 0
			this.onCangjieActivatedCallback?.()
			this.onCangjieActivatedCallback = undefined

			this.clientStateDisposable?.dispose()
			this.clientStateDisposable = this.client.onDidChangeState((e) => {
				if (e.newState === 1 /* Stopped */ && this._state === "running") {
					this.extensionOutputChannel.appendLine("[CangjieLSP] Server process stopped unexpectedly.")
					this.setState("error", "Server stopped unexpectedly")
					this.client = undefined
					this.scheduleAutoRestart()
				}
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.extensionOutputChannel.appendLine(`[CangjieLSP] Failed to start server: ${message}`)
			this.setState("error", message)
			if (message.includes("initialize fail") || message.includes("system api")) {
				vscode.window.showErrorMessage(
					`Cangjie LSP 启动失败: ${message}。请确认已运行 Cangjie SDK 的 envsetup 脚本，或在设置中配置正确的 CANGJIE_HOME 路径。`,
					"打开设置"
				).then((choice) => {
					if (choice === "打开设置") {
						vscode.commands.executeCommand("workbench.action.openSettings", `${Package.name}.cangjieLsp`)
					}
				})
			} else {
				vscode.window.showErrorMessage(`Failed to start Cangjie Language Server: ${message}`)
			}
		}
	}

	private scheduleAutoRestart(): void {
		if (this.autoRestartCount >= MAX_AUTO_RESTARTS) {
			this.extensionOutputChannel.appendLine(
				`[CangjieLSP] Auto-restart limit reached (${MAX_AUTO_RESTARTS}). Use "Cangjie: Restart Language Server" to retry manually.`,
			)
			vscode.window.showErrorMessage(
				`仓颉语言服务连续崩溃 ${MAX_AUTO_RESTARTS} 次，已停止自动重启。请检查 SDK 配置或手动重启。`,
				"手动重启",
			).then((choice) => {
				if (choice === "手动重启") {
					this.autoRestartCount = 0
					void this.restart()
				}
			})
			return
		}

		const delayMs = RESTART_DELAYS_MS[Math.min(this.autoRestartCount, RESTART_DELAYS_MS.length - 1)]
		this.autoRestartCount++
		this.extensionOutputChannel.appendLine(
			`[CangjieLSP] Auto-restarting in ${delayMs / 1000}s (attempt ${this.autoRestartCount}/${MAX_AUTO_RESTARTS})…`,
		)

		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined
			void this.doStart(getConfig())
		}, delayMs)
	}

	async stop(): Promise<void> {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer)
			this.restartTimer = undefined
		}
		this.configChangeDisposable?.dispose()
		this.configChangeDisposable = undefined
		this.lazyStartDisposable?.dispose()
		this.lazyStartDisposable = undefined
		this.clientStateDisposable?.dispose()
		this.clientStateDisposable = undefined

		if (this.client) {
			try {
				if (this.client.isRunning()) {
					await this.client.stop()
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				this.extensionOutputChannel.appendLine(`[CangjieLSP] Error stopping server: ${message}`)
			}
			this.client = undefined
		}
		this.setState("stopped")
	}

	async restart(): Promise<void> {
		this.autoRestartCount = 0
		await this.stop()
		await this.start()
	}

	dispose(): void {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer)
		}
		this._lspOutputChannel.dispose()
		this.configChangeDisposable?.dispose()
		this.lazyStartDisposable?.dispose()
		this.clientStateDisposable?.dispose()
	}

	isRunning(): boolean {
		return this.client?.isRunning() ?? false
	}
}
