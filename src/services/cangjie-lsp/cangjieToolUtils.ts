import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { Package } from "../../shared/package"

/**
 * Detect CANGJIE_HOME from environment or well-known install locations.
 */
export function detectCangjieHome(): string | undefined {
	if (process.env.CANGJIE_HOME && fs.existsSync(process.env.CANGJIE_HOME)) {
		return process.env.CANGJIE_HOME
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
 * Build environment variables for running Cangjie SDK tools.
 * Ensures runtime libraries are on PATH / LD_LIBRARY_PATH.
 */
export function buildCangjieToolEnv(cangjieHome?: string): Record<string, string> {
	const home = cangjieHome || detectCangjieHome()
	if (!home) return { ...process.env } as Record<string, string>

	const env = { ...process.env } as Record<string, string>
	env["CANGJIE_HOME"] = home

	const sep = process.platform === "win32" ? ";" : ":"
	const extraPaths: string[] = []

	if (process.platform === "win32") {
		extraPaths.push(path.join(home, "runtime", "lib", "windows_x86_64_llvm"))
		extraPaths.push(path.join(home, "lib", "windows_x86_64_llvm"))
	} else {
		extraPaths.push(path.join(home, "runtime", "lib", "linux_x86_64_llvm"))
		extraPaths.push(path.join(home, "lib", "linux_x86_64_llvm"))
	}
	extraPaths.push(path.join(home, "bin"))
	extraPaths.push(path.join(home, "tools", "bin"))
	extraPaths.push(path.join(home, "tools", "lib"))

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
 * Resolve a Cangjie SDK tool executable by checking:
 * 1. User-configured path in settings
 * 2. CANGJIE_HOME environment variable
 * 3. Well-known install locations
 * 4. System PATH (fallback)
 */
export function resolveCangjieToolPath(
	toolName: string,
	configKey?: string,
): string | undefined {
	if (configKey) {
		const configured = vscode.workspace
			.getConfiguration(Package.name)
			.get<string>(configKey, "")
		if (configured) {
			const resolved = path.resolve(configured)
			if (fs.existsSync(resolved)) return resolved
			return undefined
		}
	}

	const exeName = process.platform === "win32" ? `${toolName}.exe` : toolName

	const cangjieHome = detectCangjieHome()
	if (cangjieHome) {
		const candidates = [
			path.join(cangjieHome, "bin", exeName),
			path.join(cangjieHome, "tools", "bin", exeName),
		]
		for (const c of candidates) {
			if (fs.existsSync(c)) return c
		}
	}

	return exeName
}
