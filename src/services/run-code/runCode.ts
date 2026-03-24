import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "../cangjie-lsp/cangjieToolUtils"

interface RunConfig {
	command: string
	cwd?: string
	env?: Record<string, string>
}

const isWin = process.platform === "win32"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Chain multiple shell commands with short-circuit on failure.
 * On Windows (cmd.exe) uses `&&`; on POSIX uses `&&`.
 * The terminal is opened with cmd.exe on Windows so `&&` is always valid.
 */
function chain(...cmds: string[]): string {
	return cmds.join(" && ")
}

function findProjectRoot(startDir: string, markers: string[]): string | undefined {
	let dir = startDir
	const root = path.parse(dir).root
	while (true) {
		for (const marker of markers) {
			if (fs.existsSync(path.join(dir, marker))) {
				return dir
			}
		}
		const parent = path.dirname(dir)
		if (parent === dir || parent === root) {
			break
		}
		dir = parent
	}
	return undefined
}

function listSourceFiles(dir: string, extensions: string[]): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => {
				const ext = path.extname(f).toLowerCase()
				return extensions.includes(ext) && fs.statSync(path.join(dir, f)).isFile()
			})
			.map((f) => `"${f}"`)
	} catch {
		return []
	}
}

function exeName(base: string): string {
	return isWin ? `${base}.exe` : `./${base}`
}

// ---------------------------------------------------------------------------
// Per-language run config builders
// ---------------------------------------------------------------------------

function buildPythonConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const pyprojectRoot = findProjectRoot(fileDir, ["pyproject.toml"])
	if (pyprojectRoot) {
		if (fs.existsSync(path.join(pyprojectRoot, "poetry.lock"))) {
			return { command: `poetry run python "${filePath}"`, cwd: pyprojectRoot }
		}
		return { command: `python "${filePath}"`, cwd: pyprojectRoot }
	}

	if (fs.existsSync(path.join(fileDir, "__main__.py"))) {
		const pkgDir = path.dirname(fileDir)
		const pkgName = path.basename(fileDir)
		return { command: `python -m ${pkgName}`, cwd: pkgDir }
	}

	return { command: `python "${filePath}"` }
}

function buildJavaScriptConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)
	const pkgRoot = findProjectRoot(fileDir, ["package.json"])

	if (pkgRoot) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8"))
			if (pkg.scripts?.start) {
				return { command: "npm start", cwd: pkgRoot }
			}
			if (pkg.scripts?.dev) {
				return { command: "npm run dev", cwd: pkgRoot }
			}
		} catch { /* ignore */ }
	}

	return { command: `node "${filePath}"` }
}

function buildTypeScriptConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)
	const pkgRoot = findProjectRoot(fileDir, ["package.json"])

	if (pkgRoot) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8"))
			if (pkg.scripts?.start) {
				return { command: "npm start", cwd: pkgRoot }
			}
			if (pkg.scripts?.dev) {
				return { command: "npm run dev", cwd: pkgRoot }
			}
		} catch { /* ignore */ }
	}

	return { command: `npx tsx "${filePath}"` }
}

function buildCConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const cmakeRoot = findProjectRoot(fileDir, ["CMakeLists.txt"])
	if (cmakeRoot) {
		const bd = path.join(cmakeRoot, "build")
		return {
			command: chain(`cmake -S "${cmakeRoot}" -B "${bd}"`, `cmake --build "${bd}"`, `cmake --build "${bd}" --target run`),
			cwd: cmakeRoot,
		}
	}

	const makeRoot = findProjectRoot(fileDir, ["Makefile", "makefile", "GNUmakefile"])
	if (makeRoot) {
		return { command: chain("make", "make run"), cwd: makeRoot }
	}

	const base = path.basename(filePath, ".c")
	const cFiles = listSourceFiles(fileDir, [".c"])
	if (cFiles.length > 1) {
		const out = exeName(base)
		return { command: chain(`gcc ${cFiles.join(" ")} -o ${out}`, out), cwd: fileDir }
	}
	const out = exeName(base)
	return { command: chain(`gcc "${path.basename(filePath)}" -o ${out}`, out), cwd: fileDir }
}

function buildCppConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const cmakeRoot = findProjectRoot(fileDir, ["CMakeLists.txt"])
	if (cmakeRoot) {
		const bd = path.join(cmakeRoot, "build")
		return {
			command: chain(`cmake -S "${cmakeRoot}" -B "${bd}"`, `cmake --build "${bd}"`, `cmake --build "${bd}" --target run`),
			cwd: cmakeRoot,
		}
	}

	const makeRoot = findProjectRoot(fileDir, ["Makefile", "makefile", "GNUmakefile"])
	if (makeRoot) {
		return { command: chain("make", "make run"), cwd: makeRoot }
	}

	const base = path.basename(filePath, path.extname(filePath))
	const cppFiles = listSourceFiles(fileDir, [".cpp", ".cc", ".cxx"])
	if (cppFiles.length > 1) {
		const out = exeName(base)
		return { command: chain(`g++ ${cppFiles.join(" ")} -o ${out}`, out), cwd: fileDir }
	}
	const out = exeName(base)
	return { command: chain(`g++ "${path.basename(filePath)}" -o ${out}`, out), cwd: fileDir }
}

function buildJavaConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const mavenRoot = findProjectRoot(fileDir, ["pom.xml"])
	if (mavenRoot) {
		const mvn = isWin ? "mvn.cmd" : "mvn"
		return { command: chain(`${mvn} compile`, `${mvn} exec:java`), cwd: mavenRoot }
	}

	const gradleRoot = findProjectRoot(fileDir, ["build.gradle", "build.gradle.kts"])
	if (gradleRoot) {
		const wrapper = isWin ? "gradlew.bat" : "./gradlew"
		const cmd = fs.existsSync(path.join(gradleRoot, isWin ? "gradlew.bat" : "gradlew")) ? wrapper : "gradle"
		return { command: `${cmd} run`, cwd: gradleRoot }
	}

	const className = path.basename(filePath, ".java")
	const javaFiles = listSourceFiles(fileDir, [".java"])
	if (javaFiles.length > 1) {
		return { command: chain(`javac ${javaFiles.join(" ")}`, `java ${className}`), cwd: fileDir }
	}

	return { command: chain(`javac "${path.basename(filePath)}"`, `java ${className}`), cwd: fileDir }
}

function buildGoConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const goModRoot = findProjectRoot(fileDir, ["go.mod"])
	if (goModRoot) {
		const relDir = path.relative(goModRoot, fileDir) || "."
		return { command: `go run ./${relDir.replace(/\\/g, "/")}`, cwd: goModRoot }
	}

	const goFiles = listSourceFiles(fileDir, [".go"])
	if (goFiles.length > 1) {
		return { command: "go run .", cwd: fileDir }
	}

	return { command: `go run "${filePath}"` }
}

function buildRustConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const cargoRoot = findProjectRoot(fileDir, ["Cargo.toml"])
	if (cargoRoot) {
		return { command: "cargo run", cwd: cargoRoot }
	}

	const base = path.basename(filePath, ".rs")
	const out = exeName(base)
	return { command: chain(`rustc "${filePath}" -o ${out}`, out), cwd: fileDir }
}

function buildCangjieConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)
	const env = buildCangjieToolEnv()

	const cjpmRoot = findProjectRoot(fileDir, ["cjpm.toml"])
	if (cjpmRoot) {
		const cjpm = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath") || "cjpm"
		const cmd = isWin ? `& "${cjpm}" run` : `"${cjpm}" run`
		return { command: cmd, cwd: cjpmRoot, env }
	}

	const cjc = resolveCangjieToolPath("cjc", "cangjieLsp.cjcPath") || "cjc"
	const base = path.basename(filePath, ".cj")
	const cjFiles = listSourceFiles(fileDir, [".cj"])
	if (cjFiles.length > 1) {
		const out = exeName(base)
		return { command: chain(`"${cjc}" ${cjFiles.join(" ")} -o ${out}`, out), cwd: fileDir, env }
	}
	const out = exeName(base)
	return { command: chain(`"${cjc}" "${path.basename(filePath)}" -o ${out}`, out), cwd: fileDir, env }
}

function buildKotlinConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const gradleRoot = findProjectRoot(fileDir, ["build.gradle", "build.gradle.kts"])
	if (gradleRoot) {
		const wrapper = isWin ? "gradlew.bat" : "./gradlew"
		const cmd = fs.existsSync(path.join(gradleRoot, isWin ? "gradlew.bat" : "gradlew")) ? wrapper : "gradle"
		return { command: `${cmd} run`, cwd: gradleRoot }
	}

	const base = path.basename(filePath, ".kt")
	const ktFiles = listSourceFiles(fileDir, [".kt"])
	if (ktFiles.length > 1) {
		return {
			command: chain(`kotlinc ${ktFiles.join(" ")} -include-runtime -d "${base}.jar"`, `java -jar "${base}.jar"`),
			cwd: fileDir,
		}
	}

	return { command: chain(`kotlinc "${path.basename(filePath)}" -include-runtime -d "${base}.jar"`, `java -jar "${base}.jar"`), cwd: fileDir }
}

function buildDartConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)
	const pubRoot = findProjectRoot(fileDir, ["pubspec.yaml"])
	return { command: `dart run "${filePath}"`, cwd: pubRoot || fileDir }
}

function buildSwiftConfig(filePath: string): RunConfig {
	const fileDir = path.dirname(filePath)

	const spmRoot = findProjectRoot(fileDir, ["Package.swift"])
	if (spmRoot) {
		return { command: "swift run", cwd: spmRoot }
	}

	const swiftFiles = listSourceFiles(fileDir, [".swift"])
	if (swiftFiles.length > 1) {
		const base = path.basename(filePath, ".swift")
		const out = exeName(base)
		return { command: chain(`swiftc ${swiftFiles.join(" ")} -o ${out}`, out), cwd: fileDir }
	}

	return { command: `swift "${filePath}"` }
}

// ---------------------------------------------------------------------------
// Language → builder mapping
// ---------------------------------------------------------------------------

type RunConfigBuilder = (filePath: string, workDir: string) => RunConfig | undefined

const LANGUAGE_RUN_MAP: Record<string, RunConfigBuilder> = {
	python: buildPythonConfig,
	javascript: buildJavaScriptConfig,
	typescript: buildTypeScriptConfig,
	c: buildCConfig,
	cpp: buildCppConfig,
	java: buildJavaConfig,
	go: buildGoConfig,
	rust: buildRustConfig,
	cangjie: buildCangjieConfig,
	kotlin: buildKotlinConfig,
	dart: buildDartConfig,
	swift: buildSwiftConfig,
	ruby: (fp) => ({ command: `ruby "${fp}"` }),
	php: (fp) => ({ command: `php "${fp}"` }),
	shellscript: (fp) => ({ command: `bash "${fp}"` }),
	powershell: (fp) => ({ command: `powershell -ExecutionPolicy Bypass -File "${fp}"` }),
	lua: (fp) => ({ command: `lua "${fp}"` }),
	perl: (fp) => ({ command: `perl "${fp}"` }),
	r: (fp) => ({ command: `Rscript "${fp}"` }),
}

// ---------------------------------------------------------------------------
// Extension → language
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
	".py": "python",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".ts": "typescript",
	".mts": "typescript",
	".tsx": "typescript",
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".java": "java",
	".go": "go",
	".rs": "rust",
	".cj": "cangjie",
	".rb": "ruby",
	".php": "php",
	".sh": "shellscript",
	".bash": "shellscript",
	".ps1": "powershell",
	".lua": "lua",
	".pl": "perl",
	".r": "r",
	".R": "r",
	".swift": "swift",
	".kt": "kotlin",
	".kts": "kotlin",
	".dart": "dart",
}

function detectLanguage(document: vscode.TextDocument): string | undefined {
	const vscodeLang = document.languageId
	if (LANGUAGE_RUN_MAP[vscodeLang]) {
		return vscodeLang
	}
	const ext = path.extname(document.fileName).toLowerCase()
	return EXT_TO_LANGUAGE[ext]
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runActiveEditorCode(outputChannel: vscode.OutputChannel): Promise<void> {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		vscode.window.showWarningMessage("No active editor found. Please open a code file first.")
		return
	}

	const document = editor.document

	if (document.isUntitled) {
		vscode.window.showWarningMessage("Please save the file before running.")
		return
	}

	await vscode.workspace.saveAll(false)

	const language = detectLanguage(document)
	if (!language) {
		vscode.window.showWarningMessage(
			`Unsupported file type: ${path.extname(document.fileName) || document.languageId}`,
		)
		return
	}

	const builder = LANGUAGE_RUN_MAP[language]
	if (!builder) {
		vscode.window.showWarningMessage(`Unsupported language: ${language}`)
		return
	}

	const filePath = document.fileName
	const workDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.dirname(filePath)
	const config = builder(filePath, workDir)
	if (!config) {
		vscode.window.showWarningMessage("Failed to generate run command for this file.")
		return
	}

	const cwd = config.cwd || workDir
	const needsCmd = isWin && config.command.includes("&&")

	outputChannel.appendLine(`[Run Code] Language: ${language}, CWD: ${cwd}, Command: ${config.command}`)

	const terminal = vscode.window.createTerminal({
		name: `Run: ${path.basename(filePath)}`,
		cwd,
		env: config.env,
		shellPath: needsCmd ? "cmd.exe" : undefined,
	})
	terminal.show()
	terminal.sendText(config.command)
}
