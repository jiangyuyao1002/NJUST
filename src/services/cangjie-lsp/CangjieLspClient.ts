import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node"
import { Package } from "../../shared/package"

const CANGJIE_LANGUAGE_ID = "cangjie"
const LSP_SERVER_NAME = "Cangjie Language Server"

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
function detectCangjieHome(serverPath?: string): string | undefined {
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

export class CangjieLspClient {
	private client: LanguageClient | undefined
	private outputChannel: vscode.OutputChannel
	private configChangeDisposable: vscode.Disposable | undefined

	constructor(private readonly extensionOutputChannel: vscode.OutputChannel) {
		this.outputChannel = vscode.window.createOutputChannel(LSP_SERVER_NAME)
	}

	async start(): Promise<void> {
		const config = getConfig()

		if (!config.enabled) {
			this.extensionOutputChannel.appendLine("[CangjieLSP] Cangjie LSP is disabled by configuration.")
			return
		}

		const cangjieHome = detectCangjieHome(config.serverPath)
		this.extensionOutputChannel.appendLine(`[CangjieLSP] Detected CANGJIE_HOME: ${cangjieHome || "(not found)"}`)

		const serverExecutable = resolveServerPath(config.serverPath, cangjieHome)
		if (!serverExecutable) {
			const msg = config.serverPath
				? `Cangjie LSP server not found at configured path: ${config.serverPath}`
				: "Cangjie LSP server not found. Set 'njust-ai-cj.cangjieLsp.serverPath' or the CANGJIE_HOME environment variable."
			vscode.window.showWarningMessage(msg)
			this.extensionOutputChannel.appendLine(`[CangjieLSP] ${msg}`)
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

		const serverOptions: ServerOptions = {
			command: serverExecutable,
			args,
			transport: TransportKind.stdio,
			options: {
				env: serverEnv as NodeJS.ProcessEnv,
			},
		}

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: "file", language: CANGJIE_LANGUAGE_ID }],
			outputChannel: this.outputChannel,
			synchronize: {
				fileEvents: vscode.workspace.createFileSystemWatcher("**/*.cj"),
			},
		}

		this.client = new LanguageClient(
			"cangjieLsp",
			LSP_SERVER_NAME,
			serverOptions,
			clientOptions,
		)

		try {
			await this.client.start()
			this.extensionOutputChannel.appendLine("[CangjieLSP] Server started successfully.")
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.extensionOutputChannel.appendLine(`[CangjieLSP] Failed to start server: ${message}`)
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

		this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration(`${Package.name}.cangjieLsp`)) {
				this.extensionOutputChannel.appendLine("[CangjieLSP] Configuration changed, restarting server...")
				await this.stop()
				await this.start()
			}
		})
	}

	async stop(): Promise<void> {
		this.configChangeDisposable?.dispose()
		this.configChangeDisposable = undefined

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
	}

	dispose(): void {
		this.outputChannel.dispose()
		this.configChangeDisposable?.dispose()
	}

	isRunning(): boolean {
		return this.client?.isRunning() ?? false
	}
}
