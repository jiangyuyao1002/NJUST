import * as vscode from "vscode"
import * as dotenvx from "@dotenvx/dotenvx"
import * as fs from "fs"
import * as path from "path"

// Load environment variables from .env file
// The extension-level .env is optional (not shipped in production builds).
// Avoid calling dotenvx when the file doesn't exist, otherwise dotenvx emits
// a noisy [MISSING_ENV_FILE] error to the extension host console.
const envPath = path.join(__dirname, "..", ".env")
if (fs.existsSync(envPath)) {
	try {
		dotenvx.config({ path: envPath })
	} catch (e) {
		// Best-effort only: never fail extension activation due to optional env loading.
		console.warn("Failed to load environment variables:", e)
	}
}

import type { } from "@njust-ai-cj/types"
import { customToolRegistry } from "@njust-ai-cj/core"

import "./utils/path" // Necessary to have access to String.prototype.toPosix.
import { createOutputChannelLogger } from "./utils/outputChannelLogger"
import { initializeNetworkProxy } from "./utils/networkProxy"

import { Package } from "./shared/package"
import { ContextProxy } from "./core/config/ContextProxy"
import { ClineProvider } from "./core/webview/ClineProvider"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"
import { McpServerManager } from "./services/mcp/McpServerManager"
import { CodeIndexManager } from "./services/code-index/manager"
import { CangjieLspClient } from "./services/cangjie-lsp/CangjieLspClient"
import { CangjieLspStatusBar } from "./services/cangjie-lsp/CangjieLspStatusBar"
import { CjfmtFormatter } from "./services/cangjie-lsp/CjfmtFormatter"
import { CjlintDiagnostics } from "./services/cangjie-lsp/CjlintDiagnostics"
import { CjpmTaskProvider } from "./services/cangjie-lsp/CjpmTaskProvider"
import { registerCangjieCommands } from "./services/cangjie-lsp/cangjieCommands"
import { CangjieCodeActionProvider } from "./services/cangjie-lsp/CangjieCodeActionProvider"
import { checkAndPromptSdkSetup } from "./services/cangjie-lsp/CangjieSdkSetup"
import { CangjieDocumentSymbolProvider } from "./services/cangjie-lsp/CangjieDocumentSymbolProvider"
import { CangjieFoldingRangeProvider } from "./services/cangjie-lsp/CangjieFoldingRangeProvider"
import { CangjieHoverProvider } from "./services/cangjie-lsp/CangjieHoverProvider"
import { CangjieTestCodeLensProvider } from "./services/cangjie-lsp/CangjieTestCodeLensProvider"
import { CangjieDebugAdapterFactory, CangjieDebugConfigurationProvider } from "./services/cangjie-lsp/CangjieDebugAdapterFactory"
import { CangjieSymbolIndex } from "./services/cangjie-lsp/CangjieSymbolIndex"
import { CangjieDefinitionProvider } from "./services/cangjie-lsp/CangjieDefinitionProvider"
import { CangjieReferenceProvider } from "./services/cangjie-lsp/CangjieReferenceProvider"
import { CangjieEnhancedRenameProvider } from "./services/cangjie-lsp/CangjieEnhancedRenameProvider"
import { CangjieMacroCodeLensProvider, CangjieMacroHoverProvider, registerMacroCommands } from "./services/cangjie-lsp/CangjieMacroProvider"
import { migrateSettings } from "./utils/migrateSettings"
import { autoImportSettings } from "./utils/autoImportSettings"
import { API } from "./extension/api"
import { RooToolsMcpServer } from "./services/mcp-server/RooToolsMcpServer"
import { getWorkspacePath } from "./utils/path"

import {
	handleUri,
	registerCommands,
	registerCodeActions,
	registerTerminalActions,
	CodeActionProvider,
} from "./activate"
import { initializeI18n } from "./i18n"
import { ChatParticipantHandler, registerLMTools, ChatStateSync } from "./chat"

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext
let cangjieLspClient: CangjieLspClient | undefined
let cangjieLspStatusBar: CangjieLspStatusBar | undefined
let cjfmtFormatter: CjfmtFormatter | undefined
let cjlintDiagnostics: CjlintDiagnostics | undefined
let cjpmTaskProvider: CjpmTaskProvider | undefined
let cangjieSymbolIndex: CangjieSymbolIndex | undefined
let rooToolsMcpServer: RooToolsMcpServer | undefined

/**
 * Check if we should auto-open the NJUST_AI_CJ sidebar after switching to a worktree.
 * This is called during extension activation to handle the worktree auto-open flow.
 */
async function checkWorktreeAutoOpen(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	try {
		const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return
		}

		const currentPath = workspaceFolders[0].uri.fsPath

		// Normalize paths for comparison
		const normalizePath = (p: string) => p.replace(/\/+$/, "").replace(/\\+/g, "/").toLowerCase()

		// Check if current workspace matches the worktree path
		if (normalizePath(currentPath) === normalizePath(worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			await context.globalState.update("worktreeAutoOpenPath", undefined)

			outputChannel.appendLine(`[Worktree] Auto-opening NJUST_AI_CJ sidebar for worktree: ${worktreeAutoOpenPath}`)

			// Open the NJUST_AI_CJ sidebar with a slight delay to ensure UI is ready
			setTimeout(async () => {
				try {
					await vscode.commands.executeCommand("njust-ai-cj.plusButtonClicked")
				} catch (error) {
					outputChannel.appendLine(
						`[Worktree] Error auto-opening sidebar: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}, 500)
		}
	} catch (error) {
		outputChannel.appendLine(
			`[Worktree] Error checking worktree auto-open: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel(Package.outputChannel)
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine(`${Package.name} extension activated - ${JSON.stringify(Package)}`)

	// Initialize network proxy configuration early, before any network requests.
	// When proxyUrl is configured, all HTTP/HTTPS traffic will be routed through it.
	// Only applied in debug mode (F5).
	await initializeNetworkProxy(context, outputChannel)

	// Set extension path for custom tool registry to find bundled esbuild
	customToolRegistry.setExtensionPath(context.extensionPath)

	// Migrate old settings to new
	await migrateSettings(context, outputChannel)

	// Initialize i18n for internationalization support.
	initializeI18n(context.globalState.get("language") ?? "en")

	// Initialize terminal shell execution handlers.
	TerminalRegistry.initialize()

	// Get default commands from configuration.
	const defaultCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}

	// Auto-generate Cloud Agent device token on first activation.
	if (!context.globalState.get<string>("njustCloudDeviceToken")) {
		const { randomUUID } = await import("crypto")
		const token = randomUUID()
		await context.globalState.update("njustCloudDeviceToken", token)
		outputChannel.appendLine(`[CloudAgent] Generated device token: ${token.slice(0, 8)}...`)
	}

	// Sync device token into workspace config so Task can read it.
	const cloudDeviceToken = context.globalState.get<string>("njustCloudDeviceToken")!
	const cloudConfig = vscode.workspace.getConfiguration(Package.name)
	if (cloudConfig.get<string>("cloudAgent.deviceToken") !== cloudDeviceToken) {
		await cloudConfig.update("cloudAgent.deviceToken", cloudDeviceToken, vscode.ConfigurationTarget.Global)
	}

	const contextProxy = await ContextProxy.getInstance(context)

	// Initialize code index managers for all workspace folders.
	const codeIndexManagers: CodeIndexManager[] = []

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const manager = CodeIndexManager.getInstance(context, folder.uri.fsPath)

			if (manager) {
				codeIndexManagers.push(manager)

				// Initialize in background; do not block extension activation
				void manager.initialize(contextProxy).catch((error) => {
					const message = error instanceof Error ? error.message : String(error)
					outputChannel.appendLine(
						`[CodeIndexManager] Error during background CodeIndexManager configuration/indexing for ${folder.uri.fsPath}: ${message}`,
					)
				})

				context.subscriptions.push(manager)
			}
		}
	}

	// Initialize and start the Cangjie Language Server client (lazy: defers until .cj file is opened).
	cangjieLspClient = new CangjieLspClient(outputChannel)
	context.subscriptions.push({ dispose: () => cangjieLspClient?.dispose() })

	// Defer formatter and linter until a .cj file is actually opened.
	cangjieLspClient.onCangjieActivated(() => {
		if (!cjfmtFormatter) {
			cjfmtFormatter = new CjfmtFormatter(outputChannel)
			context.subscriptions.push(cjfmtFormatter)
		}
		if (!cjlintDiagnostics) {
			cjlintDiagnostics = new CjlintDiagnostics(outputChannel)
			context.subscriptions.push(cjlintDiagnostics)
		}
	})

	cangjieLspStatusBar = new CangjieLspStatusBar(cangjieLspClient, cangjieLspClient.lspOutputChannel)
	context.subscriptions.push(cangjieLspStatusBar)

	registerCangjieCommands(context, cangjieLspClient)

	void checkAndPromptSdkSetup(context, outputChannel).catch(() => {})

	void cangjieLspClient.start().catch((error) => {
		const message = error instanceof Error ? error.message : String(error)
		outputChannel.appendLine(`[CangjieLSP] Error during startup: ${message}`)
	})

	// cjpm tasks are always registered (user may run tasks before opening .cj files).
	cjpmTaskProvider = new CjpmTaskProvider(outputChannel)
	context.subscriptions.push(cjpmTaskProvider)

	// Initialize the provider.
	const provider = new ClineProvider(context, outputChannel, "sidebar", contextProxy)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// Check for worktree auto-open path (set when switching to a worktree)
	await checkWorktreeAutoOpen(context, outputChannel)

	// Auto-import configuration if specified in settings.
	try {
		await autoImportSettings(outputChannel, {
			providerSettingsManager: provider.providerSettingsManager,
			contextProxy: provider.contextProxy,
			customModesManager: provider.customModesManager,
		})
	} catch (error) {
		outputChannel.appendLine(
			`[AutoImport] Error during auto-import: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	registerCommands({ context, outputChannel, provider })

	// Register VSCode Chat Participant (@roo) for the native chat panel.
	const chatParticipant = new ChatParticipantHandler(provider, context, outputChannel)
	context.subscriptions.push({ dispose: () => chatParticipant.dispose() })

	// Initialize Chat <-> Webview state synchronization.
	const chatStateSync = new ChatStateSync(provider, outputChannel)
	context.subscriptions.push({ dispose: () => chatStateSync.dispose() })

	// Register Roo's native tools as VSCode Language Model Tools.
	registerLMTools(context, provider, outputChannel)

	/**
	 * We use the text document content provider API to show the left side for diff
	 * view by creating a virtual document for the original content. This makes it
	 * readonly so users know to edit the right side if they want to keep their changes.
	 *
	 * This API allows you to create readonly documents in VSCode from arbitrary
	 * sources, and works by claiming an uri-scheme for which your provider then
	 * returns text contents. The scheme must be provided when registering a
	 * provider and cannot change afterwards.
	 *
	 * Note how the provider doesn't create uris for virtual documents - its role
	 * is to provide contents given such an uri. In return, content providers are
	 * wired into the open document logic so that providers are always considered.
	 *
	 * https://code.visualstudio.com/api/extension-guides/virtual-documents
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieCodeActionProvider(),
			{ providedCodeActionKinds: CangjieCodeActionProvider.providedCodeActionKinds },
		),
	)

	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieDocumentSymbolProvider(),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieFoldingRangeProvider(),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieHoverProvider(),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieTestCodeLensProvider(),
		),
	)

	// Cangjie debugger (DAP)
	const debugFactory = new CangjieDebugAdapterFactory()
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory("cangjie", debugFactory),
	)
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider("cangjie", new CangjieDebugConfigurationProvider()),
	)

	// Test run/debug commands for CodeLens
	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai-cj.cangjieRunTest", (testName: string, fileUri?: vscode.Uri) => {
			const folder = fileUri ? vscode.workspace.getWorkspaceFolder(fileUri) : vscode.workspace.workspaceFolders?.[0]
			const cwd = folder?.uri.fsPath
			const terminal = vscode.window.createTerminal({ name: "Cangjie Test", cwd })
			terminal.show()
			terminal.sendText(`cjpm test --filter "${testName}"`)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai-cj.cangjieDebugTest", (testName: string, fileUri?: vscode.Uri) => {
			const folder = fileUri ? vscode.workspace.getWorkspaceFolder(fileUri) : undefined
			vscode.debug.startDebugging(folder, {
				type: "cangjie",
				request: "launch",
				name: `调试测试: ${testName}`,
				program: "${workspaceFolder}/target/output",
				args: ["--test", "--filter", testName],
				cwd: "${workspaceFolder}",
				preLaunchTask: "cjpm: build",
			})
		}),
	)

	// Cangjie symbol index (persistent cross-file index for definition/reference/rename fallback)
	cangjieSymbolIndex = new CangjieSymbolIndex(outputChannel)
	context.subscriptions.push(cangjieSymbolIndex)
	void cangjieSymbolIndex.initialize().catch((err) => {
		outputChannel.appendLine(`[SymbolIndex] Initialization error: ${err instanceof Error ? err.message : String(err)}`)
	})

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieDefinitionProvider(cangjieSymbolIndex),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieReferenceProvider(cangjieSymbolIndex),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerRenameProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieEnhancedRenameProvider(cangjieSymbolIndex),
		),
	)

	// Macro CodeLens + Hover + commands
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieMacroCodeLensProvider(cangjieSymbolIndex),
		),
	)

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ language: "cangjie", scheme: "file" },
			new CangjieMacroHoverProvider(cangjieSymbolIndex),
		),
	)

	registerMacroCommands(context, outputChannel)

	registerCodeActions(context)
	registerTerminalActions(context)

	// Start MCP Tools Server if enabled in settings.
	const mcpServerConfig = vscode.workspace.getConfiguration(Package.name)
	const mcpServerEnabled = mcpServerConfig.get<boolean>("mcpServer.enabled", false)
	if (mcpServerEnabled) {
		const port = mcpServerConfig.get<number>("mcpServer.port", 3100)
		const bindAddress = mcpServerConfig.get<string>("mcpServer.bindAddress", "127.0.0.1")
		const authToken = mcpServerConfig.get<string>("mcpServer.authToken", "") || undefined
		const workspacePath = getWorkspacePath()

		if (workspacePath) {
			rooToolsMcpServer = new RooToolsMcpServer({
				workspacePath,
				port,
				bindAddress,
				authToken,
				allowedCommands: defaultCommands,
				deniedCommands: mcpServerConfig.get<string[]>("deniedCommands", []),
			})

			rooToolsMcpServer
				.start()
				.then(() => {
					outputChannel.appendLine(`[McpToolsServer] Started on http://${bindAddress}:${port}/mcp`)
					if (bindAddress === "0.0.0.0") {
						outputChannel.appendLine(
							`[McpToolsServer] WARNING: Server is accessible from remote machines. Ensure authToken is set and firewall rules are configured.`,
						)
					}
				})
				.catch((error) => {
					outputChannel.appendLine(
						`[McpToolsServer] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
					)
				})

			context.subscriptions.push({
				dispose: () => {
					rooToolsMcpServer?.stop()
				},
			})
		}
	}

	// Allows other extensions to activate once Roo is ready.
	vscode.commands.executeCommand(`${Package.name}.activationCompleted`)

	// Implements the `NJUST_AI_CJAPI` interface.
	const socketPath = process.env.NJUST_AI_CJ_IPC_SOCKET_PATH
	const enableLogging = typeof socketPath === "string"

	// Watch the core files and automatically reload the extension host.
	if (process.env.NODE_ENV === "development") {
		const watchPaths = [
			{ path: context.extensionPath, pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "../packages/types"), pattern: "**/*.ts" },
		]

		console.log(
			`♻️♻️♻️ Core auto-reloading: Watching for changes in ${watchPaths.map(({ path }) => path).join(", ")}`,
		)

		// Create a debounced reload function to prevent excessive reloads
		let reloadTimeout: NodeJS.Timeout | undefined
		const DEBOUNCE_DELAY = 1_000

		const debouncedReload = (uri: vscode.Uri) => {
			if (reloadTimeout) {
				clearTimeout(reloadTimeout)
			}

			console.log(`♻️ ${uri.fsPath} changed; scheduling reload...`)

			reloadTimeout = setTimeout(() => {
				console.log(`♻️ Reloading host after debounce delay...`)
				vscode.commands.executeCommand("workbench.action.reloadWindow")
			}, DEBOUNCE_DELAY)
		}

		watchPaths.forEach(({ path: watchPath, pattern }) => {
			const relPattern = new vscode.RelativePattern(vscode.Uri.file(watchPath), pattern)
			const watcher = vscode.workspace.createFileSystemWatcher(relPattern, false, false, false)

			// Listen to all change types to ensure symlinked file updates trigger reloads.
			watcher.onDidChange(debouncedReload)
			watcher.onDidCreate(debouncedReload)
			watcher.onDidDelete(debouncedReload)

			context.subscriptions.push(watcher)
		})

		// Clean up the timeout on deactivation
		context.subscriptions.push({
			dispose: () => {
				if (reloadTimeout) {
					clearTimeout(reloadTimeout)
				}
			},
		})
	}

	return new API(outputChannel, provider, socketPath, enableLogging)
}

// This method is called when your extension is deactivated.
export async function deactivate() {
	outputChannel.appendLine(`${Package.name} extension deactivated`)

	if (cangjieLspClient) {
		await cangjieLspClient.stop()
		cangjieLspClient = undefined
	}

	cangjieLspStatusBar?.dispose()
	cangjieLspStatusBar = undefined
	cjfmtFormatter?.dispose()
	cjfmtFormatter = undefined
	cjlintDiagnostics?.dispose()
	cjlintDiagnostics = undefined
	cjpmTaskProvider?.dispose()
	cjpmTaskProvider = undefined
	cangjieSymbolIndex?.dispose()
	cangjieSymbolIndex = undefined

	if (rooToolsMcpServer) {
		await rooToolsMcpServer.stop()
		rooToolsMcpServer = undefined
	}

	await McpServerManager.cleanup(extensionContext)
	TerminalRegistry.cleanup()
}
