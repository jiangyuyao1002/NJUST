import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { parseCangjieDefinitions, type CangjieDef } from "../../../services/tree-sitter/cangjieParser"
import { CangjieSymbolIndex, type SymbolEntry } from "../../../services/cangjie-lsp/CangjieSymbolIndex"

const IMPORT_REGEX = /^\s*import\s+([\w.]+)\.\*?\s*$/gm
const FROM_IMPORT_REGEX = /^\s*from\s+([\w.]+)\s+import\s+/gm
const PACKAGE_DECL_REGEX = /^\s*package\s+([\w.]+)\s*$/m

interface DocMapping {
	prefix: string
	docPaths: string[]
	summary: string
}

const STDLIB_DOC_MAP: DocMapping[] = [
	{ prefix: "std.collection", docPaths: ["std/collection/", "kernel/source_zh_cn/collections/"], summary: "ArrayList, HashMap, HashSet 等集合类型" },
	{ prefix: "std.io", docPaths: ["std/io/", "kernel/source_zh_cn/Basic_IO/"], summary: "流式 IO、文件读写" },
	{ prefix: "std.fs", docPaths: ["std/fs/"], summary: "文件系统操作" },
	{ prefix: "std.net", docPaths: ["std/net/", "kernel/source_zh_cn/Net/"], summary: "HTTP/Socket/WebSocket 网络编程" },
	{ prefix: "std.sync", docPaths: ["std/sync/", "kernel/source_zh_cn/concurrency/"], summary: "Mutex、AtomicInt 等并发同步原语" },
	{ prefix: "std.time", docPaths: ["std/time/"], summary: "日期时间处理" },
	{ prefix: "std.math", docPaths: ["std/math/"], summary: "数学运算" },
	{ prefix: "std.regex", docPaths: ["std/regex/"], summary: "正则表达式" },
	{ prefix: "std.console", docPaths: ["std/console/"], summary: "控制台输入输出" },
	{ prefix: "std.convert", docPaths: ["std/convert/"], summary: "类型转换" },
	{ prefix: "std.unittest", docPaths: ["std/unittest/"], summary: "单元测试框架 (@Test, @TestCase, @Assert)" },
	{ prefix: "std.random", docPaths: ["std/random/"], summary: "随机数生成" },
	{ prefix: "std.process", docPaths: ["std/process/"], summary: "进程管理" },
	{ prefix: "std.env", docPaths: ["std/env/"], summary: "环境变量" },
	{ prefix: "std.reflect", docPaths: ["std/reflect/", "kernel/source_zh_cn/reflect_and_annotation/"], summary: "反射与注解" },
	{ prefix: "std.sort", docPaths: ["std/sort/"], summary: "排序算法" },
	{ prefix: "std.binary", docPaths: ["std/binary/"], summary: "二进制数据处理" },
	{ prefix: "std.ast", docPaths: ["std/ast/"], summary: "AST 操作（宏编程）" },
	{ prefix: "std.crypto", docPaths: ["std/crypto/"], summary: "加密与哈希" },
	{ prefix: "std.database", docPaths: ["std/database/"], summary: "数据库 SQL 接口" },
	{ prefix: "std.core", docPaths: ["std/core/"], summary: "核心类型与函数（自动导入）" },
	{ prefix: "std.deriving", docPaths: ["std/deriving/"], summary: "自动派生宏" },
	{ prefix: "std.overflow", docPaths: ["std/overflow/"], summary: "溢出安全运算" },
]

interface CjcErrorPattern {
	pattern: RegExp
	category: string
	docPaths: string[]
	suggestion: string
}

const CJC_ERROR_PATTERNS: CjcErrorPattern[] = [
	{
		pattern: /(?:undeclared|cannot find|not found|未找到符号|unresolved)/i,
		category: "未找到符号",
		docPaths: ["kernel/source_zh_cn/package/import.md"],
		suggestion: "检查 import 语句是否正确，确认 cjpm.toml 中是否声明了依赖包",
	},
	{
		pattern: /(?:type mismatch|incompatible types|类型不匹配)/i,
		category: "类型不匹配",
		docPaths: ["kernel/source_zh_cn/class_and_interface/typecast.md", "kernel/source_zh_cn/class_and_interface/subtype.md"],
		suggestion: "检查赋值和参数的类型是否一致，必要时使用类型转换或泛型约束",
	},
	{
		pattern: /(?:cyclic dependency|循环依赖)/i,
		category: "循环依赖",
		docPaths: ["kernel/source_zh_cn/package/package_overview.md"],
		suggestion: "使用 `cjpm check` 查看依赖关系图，将共享类型抽取到独立包中打破循环",
	},
	{
		pattern: /(?:immutable|cannot assign|let.*reassign|不可变)/i,
		category: "不可变变量赋值",
		docPaths: ["kernel/source_zh_cn/basic_programming_concepts/expression.md"],
		suggestion: "将 `let` 改为 `var` 声明，或重新设计为不可变模式",
	},
	{
		pattern: /(?:mut function|mut.*let|let.*mut)/i,
		category: "mut 函数限制",
		docPaths: ["kernel/source_zh_cn/struct/mut.md"],
		suggestion: "let 绑定的 struct 变量不能调用 mut 函数，改用 var 声明",
	},
	{
		pattern: /(?:recursive struct|recursive value type|递归结构体)/i,
		category: "递归结构体",
		docPaths: ["kernel/source_zh_cn/struct/define_struct.md", "kernel/source_zh_cn/class_and_interface/class.md"],
		suggestion: "struct 是值类型不能自引用，改用 class（引用类型）或 Option 包装",
	},
	{
		pattern: /(?:overflow|arithmetic.*overflow)/i,
		category: "算术溢出",
		docPaths: ["kernel/source_zh_cn/error_handle/common_runtime_exceptions.md"],
		suggestion: "使用 std.overflow 包中的溢出安全运算，或检查边界条件",
	},
	{
		pattern: /(?:NoneValueException|unwrap.*None|getOrThrow)/i,
		category: "空值异常",
		docPaths: ["kernel/source_zh_cn/error_handle/use_option.md", "kernel/source_zh_cn/enum_and_pattern_match/option_type.md"],
		suggestion: "使用 `??` 合并运算符提供默认值，或用 match/if-let 安全解包 Option",
	},
	{
		pattern: /(?:not implement|missing implementation|未实现接口)/i,
		category: "接口未实现",
		docPaths: ["kernel/source_zh_cn/class_and_interface/interface.md"],
		suggestion: "检查类是否完整实现了所有接口方法，注意方法签名必须完全匹配",
	},
	{
		pattern: /(?:access.*denied|private|protected|not accessible|访问权限)/i,
		category: "访问权限错误",
		docPaths: ["kernel/source_zh_cn/package/toplevel_access.md", "kernel/source_zh_cn/extension/access_rules.md"],
		suggestion: "检查成员的访问修饰符（public/protected/private/internal），跨包访问需要 public",
	},
	{
		pattern: /(?:missing return|no return|缺少返回|return expected)/i,
		category: "缺少 return 语句",
		docPaths: ["kernel/source_zh_cn/function/define_functions.md"],
		suggestion: "非 Unit 返回类型的函数所有分支必须有 return 语句，或将最后一个表达式作为返回值",
	},
	{
		pattern: /(?:wrong number.*argument|too (?:many|few) argument|参数数量|arity)/i,
		category: "函数参数数量错误",
		docPaths: ["kernel/source_zh_cn/function/call_functions.md"],
		suggestion: "检查函数调用的参数数量是否与声明匹配，注意命名参数需要用 `name:` 语法",
	},
	{
		pattern: /(?:missing import|import.*not found|未导入)/i,
		category: "缺少 import",
		docPaths: ["kernel/source_zh_cn/package/import.md"],
		suggestion: "添加缺失的 import 语句，如 `import std.collection.*` 或 `import std.io.*`",
	},
	{
		pattern: /(?:non-exhaustive|not exhaustive|未穷尽|incomplete match)/i,
		category: "match 不穷尽",
		docPaths: ["kernel/source_zh_cn/enum_and_pattern_match/match.md"],
		suggestion: "match 表达式必须覆盖所有可能的值，添加缺失的 case 分支或使用 `case _ =>` 通配",
	},
	{
		pattern: /(?:constraint.*not satisfied|does not conform|泛型约束|type parameter.*bound)/i,
		category: "泛型约束不满足",
		docPaths: ["kernel/source_zh_cn/generic/generic_constraint.md"],
		suggestion: "检查类型参数是否满足 where 子句中的约束（如 `<: Comparable<T>`），必要时添加约束或换用其他类型",
	},
	{
		pattern: /(?:constructor.*argument|init.*parameter|构造.*参数)/i,
		category: "构造函数参数错误",
		docPaths: ["kernel/source_zh_cn/class_and_interface/class.md", "kernel/source_zh_cn/struct/create_instance.md"],
		suggestion: "检查构造函数 init 的参数列表与调用处是否匹配",
	},
	{
		pattern: /(?:duplicate.*definition|redefinition|already defined|重复定义)/i,
		category: "重复定义",
		docPaths: ["kernel/source_zh_cn/basic_programming_concepts/identifier.md"],
		suggestion: "同一作用域内不能有同名定义，检查是否重复声明了变量、函数或类型",
	},
	{
		pattern: /(?:main.*signature|main.*return|main.*Int64)/i,
		category: "main 函数签名错误",
		docPaths: ["kernel/source_zh_cn/basic_programming_concepts/program_structure.md"],
		suggestion: "main 函数签名必须为 `main(): Int64`，必须返回 Int64 类型",
	},
	{
		pattern: /(?:Resource.*interface|isClosed|close.*not.*implement)/i,
		category: "Resource 接口未实现",
		docPaths: ["kernel/source_zh_cn/error_handle/handle.md"],
		suggestion: "try-with-resources 中的对象必须实现 Resource 接口（isClosed() 和 close() 方法）",
	},
	{
		pattern: /(?:override.*missing|must.*override|需要.*override|override.*required)/i,
		category: "缺少 override 修饰符",
		docPaths: ["kernel/source_zh_cn/class_and_interface/class.md"],
		suggestion: "重写父类方法必须使用 `override` 关键字，重定义使用 `redef`",
	},
	{
		pattern: /(?:index.*out.*bound|IndexOutOfBounds|数组越界|下标越界)/i,
		category: "索引越界",
		docPaths: ["kernel/source_zh_cn/error_handle/common_runtime_exceptions.md"],
		suggestion: "访问数组/字符串前检查索引范围，使用 `.size` 获取长度",
	},
	{
		pattern: /(?:capture.*mutable|spawn.*var|并发.*可变)/i,
		category: "spawn 捕获可变引用",
		docPaths: ["kernel/source_zh_cn/concurrency/create_thread.md"],
		suggestion: "spawn 块内不能直接捕获可变引用，使用 Mutex/Atomic 保护共享状态",
	},
	{
		pattern: /(?:where.*clause|where.*syntax|where.*error)/i,
		category: "where 子句语法错误",
		docPaths: ["kernel/source_zh_cn/generic/generic_constraint.md"],
		suggestion: "where 子句语法: `where T <: Interface`，多约束用 `&` 连接: `where T <: A & B`",
	},
	{
		pattern: /(?:prop.*getter|prop.*setter|属性.*语法)/i,
		category: "prop 语法错误",
		docPaths: ["kernel/source_zh_cn/class_and_interface/prop.md"],
		suggestion: "属性语法: `prop name: Type { get() { ... } set(v) { ... } }`，只读属性可省略 set",
	},
	{
		pattern: /(?:expected.*semicolon|expected.*bracket|expected.*paren|语法错误|syntax error|unexpected token)/i,
		category: "语法解析错误",
		docPaths: ["kernel/source_zh_cn/basic_programming_concepts/expression.md"],
		suggestion: "检查括号/花括号是否匹配，语句是否完整。注意仓颉不使用分号结尾（除非同一行多条语句）",
	},
]

const SYNTAX_PITFALLS = `## 仓颉语法常见陷阱（写代码前必读）

### 入口函数
- main 函数签名: \`main(): Int64\`，必须返回 Int64，不是 Unit/void
- main 函数位于顶层，不在任何 class/struct 内

### 声明与赋值
- \`let\` 是不可变绑定，不能重新赋值；需要可变绑定用 \`var\`
- \`const\` 是编译期常量，值必须在编译时可确定
- 变量声明可省略类型（类型推断），但函数参数和返回值类型不能省略

### struct vs class
- struct 是值类型：不支持继承、不能自引用（递归成员）、赋值是拷贝
- class 是引用类型：支持继承（\`<:\`）、可以自引用、赋值是引用
- let 绑定的 struct 变量不能调用 mut 方法（需要 var 绑定）

### 函数
- 命名参数调用必须带 \`name:\`：\`func foo(x!: Int64)\` → 调用 \`foo(x: 42)\`
- Lambda: \`{ params => body }\`，不是 \`(params) => { body }\`
- 函数最后一个表达式可作为返回值（无需 return），但类型必须匹配

### 模式匹配
- match 必须穷尽所有可能分支，否则编译错误
- 用 \`case _ =>\` 作为默认分支
- enum 匹配时每个构造器都必须覆盖

### 泛型
- 泛型约束用 where 子句：\`func f<T>(x: T) where T <: Comparable<T>\`
- 多约束用 \`&\` 连接：\`where T <: A & B\`
- 泛型类型实例化需要显式类型参数或可推断

### 并发
- \`spawn { ... }\` 创建协程，返回 Future<T>
- spawn 块内不能直接捕获外部 var 变量（可变引用）
- 共享可变状态必须用 Mutex/AtomicReference 保护

### 包与导入
- 文件顶部声明 \`package pkg_name\`
- 导入: \`import std.collection.*\` 或 \`import std.io.{File, Path}\`
- 跨包访问的类型/函数必须标记 \`public\`

### 字符串
- 字符串插值用 \`\${expr}\`：\`"value is \${x + 1}"\`
- 多行字符串无特殊语法，字符串内可直接包含换行符
- Rune 类型代表单个 Unicode 字符，用单引号 \`'A'\`

### 错误处理
- try-catch: \`try { ... } catch (e: ExceptionType) { ... }\`
- try-with-resources: \`try (res = expr) { ... }\`，对象必须实现 Resource 接口
- Option 类型: \`?T\`，使用 \`??\` 提供默认值，\`?.\` 可选链

### 操作符
- 区间: \`0..10\` 左闭右开，\`0..=10\` 左闭右闭
- 管道: \`x |> f\` 等同于 \`f(x)\`
- 类型检查: \`x is Type\`，类型转换: \`x as Type\`（不安全）
`

const CODE_REVIEW_CHECKLIST = `## 仓颉代码审查要点

### 类型与语义
- 优先使用 struct（值语义），仅在需要继承/引用语义时使用 class
- 优先使用 let（不可变绑定），仅在需要重新赋值时使用 var
- 使用 Option<?T> 而非 null 表达可空值

### 命名规范
- 类型名: PascalCase (MyClass, HttpServer)
- 函数/变量: camelCase (getData, itemCount)
- 常量: SCREAMING_SNAKE_CASE (MAX_RETRY_COUNT)
- 包名: snake_case (my_package)

### 错误处理
- 使用 try-catch 处理可恢复错误，不要忽略异常
- 使用 try-with-resources 自动管理资源释放
- 使用 Option 的 ?? 运算符提供默认值，避免 getOrThrow

### 并发
- 使用 spawn {} 创建协程，使用 Future.get() 获取结果
- 共享可变状态必须使用 Mutex/AtomicReference 保护
- 避免在 spawn 中直接捕获可变引用

### 项目结构与包管理
- cjpm.toml 中 name 字段须与模块目录名一致
- workspace 的 members 列表须包含所有参与构建的模块
- 库模块的公共 API 须标记 public，并在入口文件中 public import 重新导出
- 各模块的 [dependencies] 须声明实际使用的依赖，不留多余项
- 源文件中的 package 声明须与 src/ 下的目录路径匹配
- 测试文件命名: xxx_test.cj，与被测文件放在同一目录
- 使用 @Test 标注测试类，@TestCase 标注测试方法
- 避免循环依赖，使用 cjpm check 检查依赖关系
- 每个有效包目录须直接包含至少一个 .cj 文件`

// ---------------------------------------------------------------------------
// Project structure types and constants
// ---------------------------------------------------------------------------

interface CjpmProjectInfo {
	name: string
	version: string
	outputType: string
	isWorkspace: boolean
	members?: Array<{ name: string; path: string; outputType: string }>
	dependencies?: Record<string, { path?: string; git?: string; tag?: string; branch?: string }>
	srcDir: string
}

interface PackageNode {
	packageName: string
	dirPath: string
	sourceFiles: string[]
	testFiles: string[]
	hasMain: boolean
	children: PackageNode[]
}

const MAX_SCAN_DEPTH = 5
const MAX_SCAN_FILES = 500
const MAX_WORKSPACE_MEMBERS = 20

/**
 * Extract import statements from Cangjie source code.
 */
function extractImports(content: string): string[] {
	const imports: string[] = []
	let match: RegExpExecArray | null

	IMPORT_REGEX.lastIndex = 0
	while ((match = IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	FROM_IMPORT_REGEX.lastIndex = 0
	while ((match = FROM_IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	return [...new Set(imports)]
}

/**
 * Map imports to relevant documentation paths and summaries.
 */
function mapImportsToDocPaths(imports: string[]): Array<{ prefix: string; summary: string; docPaths: string[] }> {
	const results: Array<{ prefix: string; summary: string; docPaths: string[] }> = []
	const seen = new Set<string>()

	for (const imp of imports) {
		for (const mapping of STDLIB_DOC_MAP) {
			if (imp.startsWith(mapping.prefix) && !seen.has(mapping.prefix)) {
				seen.add(mapping.prefix)
				results.push(mapping)
			}
		}
	}

	return results
}

/**
 * Collect imports from all visible .cj files in the editor.
 */
function collectActiveCangjieImports(): string[] {
	const allImports: string[] = []

	for (const editor of vscode.window.visibleTextEditors) {
		if (editor.document.languageId === "cangjie" || editor.document.fileName.endsWith(".cj")) {
			const content = editor.document.getText()
			allImports.push(...extractImports(content))
		}
	}

	return [...new Set(allImports)]
}

/**
 * Collect symbol definitions from all visible .cj files for AI context.
 * Groups child definitions (functions inside classes) for readability.
 */
function collectActiveCangjieSymbols(): string | null {
	const MAX_DEFS = 30
	const fileSymbols: Array<{ fileName: string; defs: CangjieDef[] }> = []
	let totalDefs = 0

	for (const editor of vscode.window.visibleTextEditors) {
		if (!(editor.document.languageId === "cangjie" || editor.document.fileName.endsWith(".cj"))) {
			continue
		}
		const content = editor.document.getText()
		const defs = parseCangjieDefinitions(content).filter(
			(d: CangjieDef) => d.kind !== "import" && d.kind !== "package",
		)
		if (defs.length === 0) continue
		fileSymbols.push({ fileName: path.basename(editor.document.fileName), defs })
		totalDefs += defs.length
	}

	if (fileSymbols.length === 0) return null

	const lines: string[] = ["## 当前编辑文件的符号定义\n"]

	let remaining = MAX_DEFS
	for (const { fileName, defs } of fileSymbols) {
		lines.push(`**${fileName}**:`)

		const topLevel = totalDefs > MAX_DEFS
			? defs.filter((d) => ["class", "struct", "interface", "enum", "extend", "main"].includes(d.kind))
			: defs

		for (const def of topLevel) {
			if (remaining <= 0) break
			const span = def.endLine > def.startLine ? ` (${def.startLine + 1}-${def.endLine + 1} 行)` : ""

			const children = defs.filter(
				(d) => d !== def && d.startLine > def.startLine && d.endLine <= def.endLine && d.kind === "func",
			)

			if (children.length > 0) {
				const childNames = children.slice(0, 5).map((c) => c.name).join(", ")
				const suffix = children.length > 5 ? ` 等 ${children.length} 个方法` : ""
				lines.push(`- ${def.kind} ${def.name}${span}: 包含 ${childNames}${suffix}`)
			} else {
				lines.push(`- ${def.kind} ${def.name}${span}`)
			}
			remaining--
		}

		if (remaining <= 0) {
			lines.push(`- …（已省略，共 ${totalDefs} 个定义）`)
			break
		}
	}

	return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Cross-file symbol resolution via CangjieSymbolIndex
// ---------------------------------------------------------------------------

const MAX_IMPORT_SYMBOLS = 60
const MAX_SYMBOLS_PER_PACKAGE = 15

/**
 * Resolve local (non-stdlib) import paths to workspace symbols using
 * CangjieSymbolIndex. For each import like `import mylib.utils.*`, find
 * the corresponding directory under src/ and return its public symbols.
 */
function resolveImportedSymbols(
	imports: string[],
	cwd: string,
	projectInfo: CjpmProjectInfo | null,
): string | null {
	const symbolIndex = CangjieSymbolIndex.getInstance()
	if (!symbolIndex || symbolIndex.symbolCount === 0) return null

	const localImports = imports.filter((imp) => !imp.startsWith("std."))
	if (localImports.length === 0) return null

	const rootName = projectInfo?.name || ""
	const srcDir = projectInfo?.srcDir || "src"

	const sections: string[] = []
	let totalSymbols = 0

	for (const imp of localImports) {
		if (totalSymbols >= MAX_IMPORT_SYMBOLS) break

		const dirPath = resolveImportToDirectory(imp, cwd, rootName, srcDir, projectInfo)
		if (!dirPath) continue

		const symbols = symbolIndex.getSymbolsByDirectory(dirPath)
		if (symbols.length === 0) continue

		const publicSymbols = symbols.slice(0, MAX_SYMBOLS_PER_PACKAGE)
		const lines = formatSymbolEntries(publicSymbols, cwd)
		if (lines.length === 0) continue

		sections.push(`**${imp}** (${path.relative(cwd, dirPath).replace(/\\/g, "/")}/):\n${lines.join("\n")}`)
		totalSymbols += publicSymbols.length
	}

	if (sections.length === 0) return null

	return `## 已导入的工作区模块符号\n\n以下是当前文件 import 的本地包中的符号定义，可直接在代码中引用：\n\n${sections.join("\n\n")}`
}

/**
 * Map an import path like "mylib.utils.http" to the corresponding directory
 * on disk. Tries several strategies:
 *  1. Strip root package name and map remaining segments to src/ subdirs
 *  2. For workspace projects, check if the first segment matches a member name
 */
function resolveImportToDirectory(
	importPath: string,
	cwd: string,
	rootName: string,
	srcDir: string,
	projectInfo: CjpmProjectInfo | null,
): string | null {
	const segments = importPath.split(".")

	if (projectInfo?.isWorkspace && projectInfo.members) {
		const memberMatch = projectInfo.members.find((m) => m.name === segments[0])
		if (memberMatch) {
			const memberCwd = path.join(cwd, memberMatch.path)
			const subPath = segments.slice(1).join(path.sep)
			const candidate = subPath
				? path.join(memberCwd, "src", subPath)
				: path.join(memberCwd, "src")
			if (fs.existsSync(candidate)) return candidate
		}
	}

	if (rootName && segments[0] === rootName) {
		const subPath = segments.slice(1).join(path.sep)
		const candidate = subPath
			? path.join(cwd, srcDir, subPath)
			: path.join(cwd, srcDir)
		if (fs.existsSync(candidate)) return candidate
	}

	const directPath = segments.join(path.sep)
	const candidate = path.join(cwd, srcDir, directPath)
	if (fs.existsSync(candidate)) return candidate

	return null
}

function formatSymbolEntries(symbols: SymbolEntry[], cwd: string): string[] {
	const lines: string[] = []
	const grouped = new Map<string, SymbolEntry[]>()

	for (const sym of symbols) {
		const relFile = path.relative(cwd, sym.filePath).replace(/\\/g, "/")
		if (!grouped.has(relFile)) grouped.set(relFile, [])
		grouped.get(relFile)!.push(sym)
	}

	for (const [file, syms] of grouped) {
		for (const sym of syms) {
			const sig = sym.signature ? `: \`${sym.signature}\`` : ""
			lines.push(`- ${sym.kind} **${sym.name}**${sig} _(${file}:${sym.startLine + 1})_`)
		}
	}

	return lines
}

// ---------------------------------------------------------------------------
// Source-level package declaration verification
// ---------------------------------------------------------------------------

/**
 * Read actual `package` declarations from .cj source files and compare
 * with directory-inferred package names. Report mismatches so the AI
 * can generate correct package declarations.
 */
function verifyPackageDeclarations(
	root: PackageNode,
	cwd: string,
	srcDir: string,
): string | null {
	const mismatches: string[] = []
	const MAX_CHECKS = 50
	let checked = 0

	function walk(node: PackageNode): void {
		if (checked >= MAX_CHECKS) return

		for (const fileName of node.sourceFiles) {
			if (checked >= MAX_CHECKS) return
			checked++

			const filePath = path.join(cwd, node.dirPath, fileName)
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const match = content.match(PACKAGE_DECL_REGEX)
				const declaredPkg = match ? match[1] : null
				const expectedPkg = node.packageName

				if (declaredPkg && declaredPkg !== expectedPkg) {
					const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
					mismatches.push(
						`- ${relPath}: 声明 \`package ${declaredPkg}\`，但目录推导应为 \`package ${expectedPkg}\``,
					)
				} else if (!declaredPkg && node.packageName.includes(".")) {
					const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
					mismatches.push(
						`- ${relPath}: **缺少 package 声明**，应声明 \`package ${expectedPkg}\``,
					)
				}
			} catch {
				// skip unreadable files
			}
		}

		for (const child of node.children) {
			walk(child)
		}
	}

	walk(root)

	if (mismatches.length === 0) return null

	return (
		`## ⚠ 包声明不一致\n\n` +
		`以下文件的 \`package\` 声明与目录结构不匹配，**生成代码时请使用正确的包名**：\n\n` +
		mismatches.join("\n") +
		`\n\n规则: 文件所在目录相对于 ${srcDir}/ 的路径决定包名（如 ${srcDir}/network/http/ → package <root>.network.http）`
	)
}

// ---------------------------------------------------------------------------
// Workspace cross-module symbol summary
// ---------------------------------------------------------------------------

/**
 * For workspace projects, generate a summary of public symbols in each
 * member module so the AI knows what's available across modules.
 */
function buildWorkspaceSymbolSummary(
	info: CjpmProjectInfo,
	cwd: string,
): string | null {
	if (!info.isWorkspace || !info.members || info.members.length === 0) return null

	const symbolIndex = CangjieSymbolIndex.getInstance()
	if (!symbolIndex || symbolIndex.symbolCount === 0) return null

	const MAX_SYMBOLS_PER_MODULE = 20
	const moduleSections: string[] = []

	for (const member of info.members) {
		const memberSrcDir = path.join(cwd, member.path, "src")
		if (!fs.existsSync(memberSrcDir)) continue

		const symbols = symbolIndex.getSymbolsByDirectory(memberSrcDir)
		if (symbols.length === 0) continue

		const topLevel = symbols
			.filter((s) => ["class", "struct", "interface", "enum", "func", "type"].includes(s.kind))
			.slice(0, MAX_SYMBOLS_PER_MODULE)

		if (topLevel.length === 0) continue

		const lines = topLevel.map((s) => {
			const sig = s.signature ? `: \`${s.signature}\`` : ""
			return `  - ${s.kind} **${s.name}**${sig}`
		})

		const suffix = symbols.length > MAX_SYMBOLS_PER_MODULE
			? `\n  - _…共 ${symbols.length} 个符号_`
			: ""

		moduleSections.push(`- **${member.name}** (${member.outputType}):\n${lines.join("\n")}${suffix}`)
	}

	if (moduleSections.length === 0) return null

	return (
		`## 工作区各模块公共符号\n\n` +
		`以下是各模块的主要类型和函数定义，跨模块引用时需确保目标符号为 public 并在 cjpm.toml 中声明依赖：\n\n` +
		moduleSections.join("\n\n")
	)
}

/**
 * Collect current cjlint/cjc diagnostics from VS Code.
 */
function collectCangjieDiagnostics(): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = []

	for (const [uri, diags] of vscode.languages.getDiagnostics()) {
		if (uri.fsPath.endsWith(".cj")) {
			diagnostics.push(...diags)
		}
	}

	return diagnostics
}

/**
 * Map diagnostic messages to error patterns and documentation.
 */
function mapDiagnosticsToDocContext(diagnostics: vscode.Diagnostic[]): string[] {
	const matchedCategories = new Set<string>()
	const sections: string[] = []

	for (const diag of diagnostics) {
		const msg = diag.message
		for (const pattern of CJC_ERROR_PATTERNS) {
			if (pattern.pattern.test(msg) && !matchedCategories.has(pattern.category)) {
				matchedCategories.add(pattern.category)
				const docPathsStr = pattern.docPaths.map((p) => `.roo/skills/cangjie-full-docs/${p}`).join(", ")
				sections.push(
					`- **${pattern.category}**: ${pattern.suggestion}\n  参考文档: ${docPathsStr}`,
				)
			}
		}
	}

	return sections
}

/**
 * Resolve the .roo/skills/cangjie-full-docs base path relative to the workspace.
 */
function resolveDocsBasePath(cwd: string): string {
	return path.join(cwd, ".roo", "skills", "cangjie-full-docs")
}

// ---------------------------------------------------------------------------
// cjpm.toml parsing
// ---------------------------------------------------------------------------

function splitTomlSections(content: string): Map<string, string> {
	const sections = new Map<string, string>()
	const lines = content.split("\n")
	let currentSection = ""
	let currentLines: string[] = []

	for (const line of lines) {
		const match = line.match(/^\s*\[([^\]]+)\]\s*$/)
		if (match) {
			if (currentSection) {
				sections.set(currentSection, currentLines.join("\n"))
			}
			currentSection = match[1].trim()
			currentLines = []
		} else {
			currentLines.push(line)
		}
	}

	if (currentSection) {
		sections.set(currentSection, currentLines.join("\n"))
	}

	return sections
}

function extractTomlString(section: string, key: string): string | undefined {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"`, "m")
	const match = section.match(re)
	return match ? match[1] : undefined
}

function extractTomlArray(section: string, key: string): string[] {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp(`^\\s*${escaped}\\s*=\\s*\\[([^\\]]*)\\]`, "ms")
	const match = section.match(re)
	if (!match) return []
	return match[1].match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) || []
}

function extractTomlInlineTables(section: string): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {}
	const re = /^\s*(\S+)\s*=\s*\{([^}]*)\}\s*$/gm
	let match
	while ((match = re.exec(section)) !== null) {
		const key = match[1].trim()
		const tableContent = match[2]
		const table: Record<string, string> = {}
		const kvRe = /([\w][\w-]*)\s*=\s*"([^"]*)"/g
		let kvMatch
		while ((kvMatch = kvRe.exec(tableContent)) !== null) {
			table[kvMatch[1]] = kvMatch[2]
		}
		result[key] = table
	}
	return result
}

function parseSingleModuleProject(sections: Map<string, string>): CjpmProjectInfo | null {
	const pkg = sections.get("package")
	if (!pkg) return null

	const name = extractTomlString(pkg, "name") || ""
	const version = extractTomlString(pkg, "version") || ""
	const outputType = extractTomlString(pkg, "output-type") || "executable"
	const srcDir = extractTomlString(pkg, "src-dir") || "src"

	let dependencies: CjpmProjectInfo["dependencies"]
	const deps = sections.get("dependencies")
	if (deps) {
		const tables = extractTomlInlineTables(deps)
		if (Object.keys(tables).length > 0) {
			dependencies = {}
			for (const [depName, t] of Object.entries(tables)) {
				dependencies[depName] = { path: t["path"], git: t["git"], tag: t["tag"], branch: t["branch"] }
			}
		}
	}

	return { name, version, outputType, isWorkspace: false, srcDir, dependencies }
}

function parseWorkspaceProject(sections: Map<string, string>, cwd: string): CjpmProjectInfo | null {
	const ws = sections.get("workspace")
	if (!ws) return null

	const memberPaths = extractTomlArray(ws, "members")
	const members: CjpmProjectInfo["members"] = []

	for (const mp of memberPaths.slice(0, MAX_WORKSPACE_MEMBERS)) {
		const memberToml = path.join(cwd, mp, "cjpm.toml")
		if (!fs.existsSync(memberToml)) continue
		try {
			const content = fs.readFileSync(memberToml, "utf-8")
			const ms = splitTomlSections(content)
			const pkg = ms.get("package")
			if (pkg) {
				members.push({
					name: extractTomlString(pkg, "name") || path.basename(mp),
					path: mp,
					outputType: extractTomlString(pkg, "output-type") || "static",
				})
			}
		} catch {
			/* skip unreadable member */
		}
	}

	let dependencies: CjpmProjectInfo["dependencies"]
	const deps = sections.get("dependencies")
	if (deps) {
		const tables = extractTomlInlineTables(deps)
		if (Object.keys(tables).length > 0) {
			dependencies = {}
			for (const [depName, t] of Object.entries(tables)) {
				dependencies[depName] = { path: t["path"], git: t["git"] }
			}
		}
	}

	return { name: "", version: "", outputType: "", isWorkspace: true, members, dependencies, srcDir: "src" }
}

function parseCjpmToml(cwd: string): CjpmProjectInfo | null {
	const tomlPath = path.join(cwd, "cjpm.toml")
	if (!fs.existsSync(tomlPath)) return null

	try {
		const content = fs.readFileSync(tomlPath, "utf-8")
		const sections = splitTomlSections(content)
		if (sections.has("workspace")) {
			return parseWorkspaceProject(sections, cwd)
		}
		if (sections.has("package")) {
			return parseSingleModuleProject(sections)
		}
	} catch {
		/* ignore parse errors */
	}

	return null
}

// ---------------------------------------------------------------------------
// Package hierarchy scanning
// ---------------------------------------------------------------------------

function scanPackageHierarchy(cwd: string, srcDir: string, rootPackageName?: string): PackageNode | null {
	const srcPath = path.join(cwd, srcDir)
	if (!fs.existsSync(srcPath)) return null

	let fileCount = 0
	const rootPkg = rootPackageName || "default"

	function scan(dir: string, depth: number, pkgName: string): PackageNode | null {
		if (depth > MAX_SCAN_DEPTH || fileCount > MAX_SCAN_FILES) return null

		let entries: fs.Dirent[]
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return null
		}

		const sourceFiles: string[] = []
		const testFiles: string[] = []
		let hasMain = false
		const childDirs: fs.Dirent[] = []

		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".cj")) {
				fileCount++
				if (entry.name.endsWith("_test.cj")) {
					testFiles.push(entry.name)
				} else {
					sourceFiles.push(entry.name)
					if (entry.name === "main.cj") hasMain = true
				}
			} else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "target") {
				childDirs.push(entry)
			}
		}

		const children: PackageNode[] = []
		for (const cd of childDirs) {
			const childNode = scan(path.join(dir, cd.name), depth + 1, `${pkgName}.${cd.name}`)
			if (childNode) children.push(childNode)
		}

		if (sourceFiles.length === 0 && testFiles.length === 0 && children.length === 0) return null

		return {
			packageName: pkgName,
			dirPath: path.relative(cwd, dir).replace(/\\/g, "/"),
			sourceFiles,
			testFiles,
			hasMain,
			children,
		}
	}

	return scan(srcPath, 0, rootPkg)
}

function countTreeFiles(node: PackageNode, testOnly: boolean): number {
	const count = testOnly ? node.testFiles.length : node.sourceFiles.length
	return count + node.children.reduce((sum, child) => sum + countTreeFiles(child, testOnly), 0)
}

// ---------------------------------------------------------------------------
// System prompt section formatters
// ---------------------------------------------------------------------------

function formatProjectInfoSection(info: CjpmProjectInfo): string {
	const lines: string[] = ["## 当前仓颉项目信息\n"]

	if (info.isWorkspace) {
		lines.push("项目类型: workspace（多模块工作区）")
		if (info.members && info.members.length > 0) {
			lines.push("\n工作区成员:")
			for (const m of info.members) {
				lines.push(`- ${m.name} (${m.outputType}) — ${m.path}`)
			}
		}
	} else {
		lines.push(`项目名: ${info.name} | 版本: ${info.version} | 类型: ${info.outputType}`)
	}

	if (info.dependencies && Object.keys(info.dependencies).length > 0) {
		lines.push("\n依赖:")
		for (const [name, dep] of Object.entries(info.dependencies)) {
			if (dep.path) {
				lines.push(`- ${name} (本地: ${dep.path})`)
			} else if (dep.git) {
				const ver = dep.tag || dep.branch || ""
				lines.push(`- ${name} (git: ${dep.git}${ver ? `, ${ver}` : ""})`)
			}
		}
	}

	return lines.join("\n")
}

function formatPackageTreeSection(root: PackageNode, info: CjpmProjectInfo): string {
	const lines: string[] = ["## 当前包结构\n"]

	function renderNode(node: PackageNode, indent: string, isLast: boolean): void {
		const connector = isLast ? "└── " : "├── "
		const files = [...node.sourceFiles, ...node.testFiles.map((f) => `${f} (测试)`)].join(", ")
		const mainTag = node.hasMain ? " ← 入口" : ""
		lines.push(`${indent}${connector}[${node.packageName}] ${files}${mainTag}`)

		const childIndent = indent + (isLast ? "    " : "│   ")
		node.children.forEach((child, i) => {
			renderNode(child, childIndent, i === node.children.length - 1)
		})
	}

	const rootFiles = [...root.sourceFiles, ...root.testFiles.map((f) => `${f} (测试)`)].join(", ")
	lines.push(`${root.dirPath}/`)
	if (rootFiles) {
		lines.push(`├── [${root.packageName}] ${rootFiles}${root.hasMain ? " ← 入口" : ""}`)
	}
	root.children.forEach((child, i) => {
		renderNode(child, "", i === root.children.length - 1)
	})

	lines.push(
		`\n包声明规则: 子包声明须与相对于 ${info.srcDir}/ 的目录路径匹配（如 ${info.srcDir}/network/http/ → package ${root.packageName}.network.http）`,
	)

	return lines.join("\n")
}

function formatWorkspaceModulesSection(info: CjpmProjectInfo, cwd: string): string | null {
	if (!info.members || info.members.length === 0) return null

	const lines: string[] = ["## 工作区模块结构\n"]

	for (const member of info.members) {
		const memberCwd = path.join(cwd, member.path)
		const pkgTree = scanPackageHierarchy(memberCwd, "src", member.name)
		if (pkgTree) {
			const srcCount = countTreeFiles(pkgTree, false)
			const testCount = countTreeFiles(pkgTree, true)
			lines.push(
				`- ${member.name} (${member.outputType}): ${srcCount} 源文件, ${testCount} 测试文件${pkgTree.hasMain ? ", 含 main" : ""}`,
			)
		} else {
			lines.push(`- ${member.name} (${member.outputType}): 未发现源文件`)
		}
	}

	lines.push("\n各模块包声明规则: 子包声明须与相对于 src/ 的目录路径匹配")

	return lines.join("\n")
}

function buildDependencyContext(info: CjpmProjectInfo, cwd: string): string | null {
	if (!info.isWorkspace || !info.members || info.members.length === 0) return null

	const lines: string[] = ["## 模块间依赖关系\n"]
	let hasDeps = false

	for (const member of info.members) {
		const memberToml = path.join(cwd, member.path, "cjpm.toml")
		if (!fs.existsSync(memberToml)) continue

		try {
			const content = fs.readFileSync(memberToml, "utf-8")
			const memberSections = splitTomlSections(content)
			const deps = memberSections.get("dependencies")
			if (!deps) continue

			const tables = extractTomlInlineTables(deps)
			const depNames = Object.keys(tables)
			if (depNames.length === 0) continue

			hasDeps = true
			const depList = depNames
				.map((d) => {
					const t = tables[d]
					if (t["path"]) return `${d} (本地: ${t["path"]})`
					if (t["git"]) return `${d} (git)`
					return d
				})
				.join(", ")
			lines.push(`- ${member.name} → ${depList}`)
		} catch {
			/* skip */
		}
	}

	if (!hasDeps) return null

	lines.push(
		"\n注意: 修改模块间的依赖关系时，须同步更新对应 cjpm.toml 中的 [dependencies]。使用 `cjpm check` 验证依赖无循环。",
	)

	return lines.join("\n")
}

/**
 * Generate the Cangjie context section for the system prompt.
 * Only included when mode is "cangjie".
 */
export function getCangjieContextSection(cwd: string, mode: string): string {
	if (mode !== "cangjie") return ""

	const docsBase = resolveDocsBasePath(cwd)
	const docsExist = fs.existsSync(docsBase)

	const sections: string[] = []

	// 0a. Project structure context (cjpm.toml)
	const projectInfo = parseCjpmToml(cwd)
	if (projectInfo) {
		sections.push(formatProjectInfoSection(projectInfo))
	}

	// 0b. Package hierarchy context + package declaration verification
	if (projectInfo && !projectInfo.isWorkspace) {
		const rootPkgName = projectInfo.name || undefined
		const pkgTree = scanPackageHierarchy(cwd, projectInfo.srcDir, rootPkgName)
		if (pkgTree) {
			sections.push(formatPackageTreeSection(pkgTree, projectInfo))

			const pkgMismatches = verifyPackageDeclarations(pkgTree, cwd, projectInfo.srcDir)
			if (pkgMismatches) sections.push(pkgMismatches)
		}
	} else if (projectInfo && projectInfo.isWorkspace) {
		const modulesSection = formatWorkspaceModulesSection(projectInfo, cwd)
		if (modulesSection) sections.push(modulesSection)

		// Verify package declarations for each workspace member
		for (const member of projectInfo.members || []) {
			const memberCwd = path.join(cwd, member.path)
			const memberTree = scanPackageHierarchy(memberCwd, "src", member.name)
			if (memberTree) {
				const pkgMismatches = verifyPackageDeclarations(memberTree, memberCwd, "src")
				if (pkgMismatches) sections.push(pkgMismatches)
			}
		}
	}

	// 0c. Dependency context (workspace only)
	if (projectInfo) {
		const depCtx = buildDependencyContext(projectInfo, cwd)
		if (depCtx) sections.push(depCtx)
	}

	// 0d. Active file symbol definitions
	const symbolSection = collectActiveCangjieSymbols()
	if (symbolSection) {
		sections.push(symbolSection)
	}

	// 0e. Cross-file symbol resolution via import analysis
	const imports = collectActiveCangjieImports()

	const importedSymbolsSection = resolveImportedSymbols(imports, cwd, projectInfo)
	if (importedSymbolsSection) {
		sections.push(importedSymbolsSection)
	}

	// 0f. Workspace cross-module symbol summary
	if (projectInfo?.isWorkspace) {
		const wsSymbols = buildWorkspaceSymbolSummary(projectInfo, cwd)
		if (wsSymbols) sections.push(wsSymbols)
	}

	// 1. Import-based documentation context
	if (imports.length > 0 && docsExist) {
		const docMappings = mapImportsToDocPaths(imports)
		if (docMappings.length > 0) {
			const importContext = docMappings
				.map((m) => {
					const paths = m.docPaths.map((p) => `.roo/skills/cangjie-full-docs/${p}`).join(", ")
					return `- \`${m.prefix}\`: ${m.summary} → ${paths}`
				})
				.join("\n")

			sections.push(
				`## 当前代码使用的标准库模块\n\n以下模块在当前编辑的 .cj 文件中被引用，对应文档路径可用于查阅 API 详情：\n\n${importContext}`,
			)
		}
	}

	// 2. Error/diagnostic context
	const diagnostics = collectCangjieDiagnostics()
	if (diagnostics.length > 0) {
		const errorSections = mapDiagnosticsToDocContext(diagnostics)
		if (errorSections.length > 0) {
			sections.push(
				`## 当前诊断错误与修复建议\n\n检测到以下编译/检查错误，建议参考对应文档修复：\n\n${errorSections.join("\n")}`,
			)
		}
	}

	// 3. Documentation index references
	if (docsExist) {
		sections.push(
			`## 仓颉文档检索指引\n\n` +
			`项目中包含完整的仓颉语言文档（.roo/skills/cangjie-full-docs/），按以下索引查阅：\n` +
			`- 语言特性索引: .roo/skills/cangjie-full-docs/kernel/index.md\n` +
			`- 标准库索引: .roo/skills/cangjie-full-docs/std.md\n` +
			`- 扩展标准库索引: .roo/skills/cangjie-full-docs/stdx.md\n` +
			`- 工具链索引: .roo/skills/cangjie-full-docs/tools/index.md\n\n` +
			`遇到不确定的 API 或语法时，优先通过索引文件定位并读取对应文档，确保给出准确信息。`,
		)
	}

	// 4. Common syntax pitfalls
	sections.push(SYNTAX_PITFALLS)

	// 5. Code review checklist
	sections.push(CODE_REVIEW_CHECKLIST)

	// 6. Structured editing context (cursor position, enclosing symbol, nearby code)
	const editingCtx = buildStructuredEditingContext()
	if (editingCtx) {
		sections.push(editingCtx)
	}

	if (sections.length === 0) return ""

	return `====

CANGJIE DEVELOPMENT CONTEXT

${sections.join("\n\n")}
`
}

/**
 * Extract file:line:col references from cjc error output and read surrounding
 * source lines to provide richer context for AI-assisted fixes.
 */
function extractErrorSourceContext(errorOutput: string, cwd: string): string[] {
	const locationRe = /==>\s+(.+?):(\d+):(\d+):/g
	const contextLines: string[] = []
	const seen = new Set<string>()
	const CONTEXT_RADIUS = 3
	let match: RegExpExecArray | null

	while ((match = locationRe.exec(errorOutput)) !== null) {
		const [, filePart, lineStr] = match
		const lineNum = parseInt(lineStr, 10) - 1
		const filePath = path.isAbsolute(filePart) ? filePart : path.resolve(cwd, filePart)
		const key = `${filePath}:${lineNum}`
		if (seen.has(key)) continue
		seen.add(key)

		try {
			if (!fs.existsSync(filePath)) continue
			const content = fs.readFileSync(filePath, "utf-8")
			const lines = content.split("\n")
			const start = Math.max(0, lineNum - CONTEXT_RADIUS)
			const end = Math.min(lines.length, lineNum + CONTEXT_RADIUS + 1)

			const snippet = lines
				.slice(start, end)
				.map((l, i) => {
					const num = start + i + 1
					const marker = num === lineNum + 1 ? " >>>" : "    "
					return `${marker} ${num}: ${l}`
				})
				.join("\n")

			const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
			contextLines.push(`文件: ${relPath} (第 ${lineNum + 1} 行)\n${snippet}`)
		} catch {
			// Skip unreadable files
		}

		if (contextLines.length >= 3) break
	}

	return contextLines
}

/**
 * Enhance a cjc/cjlint error message with documentation references and fix suggestions.
 * Called when terminal output contains compilation errors.
 */
export function enhanceCjcErrorOutput(errorOutput: string, cwd: string): string {
	const docsBase = resolveDocsBasePath(cwd)
	const docsExist = fs.existsSync(docsBase)

	const matchedSuggestions: string[] = []
	const seen = new Set<string>()

	for (const pattern of CJC_ERROR_PATTERNS) {
		if (pattern.pattern.test(errorOutput) && !seen.has(pattern.category)) {
			seen.add(pattern.category)
			const docPaths = docsExist
				? pattern.docPaths.map((p) => `.roo/skills/cangjie-full-docs/${p}`).join(", ")
				: ""
			const ref = docPaths ? ` (参考: ${docPaths})` : ""
			const directive = getErrorFixDirective(errorOutput)
			matchedSuggestions.push(`[${pattern.category}] ${pattern.suggestion}${ref}\n  AI 修复指令: ${directive}`)
		}
	}

	const sourceContexts = extractErrorSourceContext(errorOutput, cwd)

	if (matchedSuggestions.length === 0 && sourceContexts.length === 0) return ""

	const parts: string[] = []
	if (sourceContexts.length > 0) {
		parts.push(`出错位置源码:\n${sourceContexts.join("\n\n")}`)
	}
	if (matchedSuggestions.length > 0) {
		parts.push(matchedSuggestions.join("\n"))
	}

	return `\n\n<cangjie_error_hints>\n${parts.join("\n\n")}\n</cangjie_error_hints>`
}

// ---------------------------------------------------------------------------
// Error-classified AI fix directives
// ---------------------------------------------------------------------------

interface ErrorFixDirective {
	pattern: RegExp
	directive: string
}

const ERROR_FIX_DIRECTIVES: ErrorFixDirective[] = [
	{ pattern: /unused\s+(?:variable|import|parameter)/i, directive: "移除未使用的变量/导入/参数" },
	{ pattern: /(?:cannot find|undeclared|unresolved|not found|未找到符号)/i, directive: "检查是否缺少 import 语句或拼写错误。如果是标准库符号，添加正确的 import（如 `import std.collection.*`）" },
	{ pattern: /(?:type mismatch|incompatible types|类型不匹配)/i, directive: "使类型一致：修改变量类型、添加显式类型转换、或调整函数返回类型" },
	{ pattern: /(?:immutable|cannot assign|let.*reassign|不可变)/i, directive: "将 `let` 改为 `var`，或重构为不需要重新赋值的模式" },
	{ pattern: /(?:non-exhaustive|incomplete match|未穷尽)/i, directive: "为 match 表达式添加缺失的分支或 `case _ =>` 通配分支" },
	{ pattern: /(?:missing return|no return|缺少返回)/i, directive: "确保函数所有分支都有返回值，或在函数末尾添加返回语句" },
	{ pattern: /(?:not implement|missing implementation|未实现接口)/i, directive: "实现缺失的接口方法，确保方法签名完全匹配" },
	{ pattern: /(?:access.*denied|private|not accessible|访问权限)/i, directive: "检查访问修饰符，跨包使用需要 `public`" },
	{ pattern: /(?:cyclic dependency|循环依赖)/i, directive: "将共享类型抽取到独立包中以打破循环依赖" },
	{ pattern: /(?:duplicate.*definition|redefinition|重复定义)/i, directive: "移除重复定义，或为同名符号使用不同的名称" },
	{ pattern: /(?:syntax error|unexpected token|语法错误)/i, directive: "检查括号/花括号匹配，确保语句完整。注意仓颉不使用分号结尾" },
	{ pattern: /(?:override.*missing|must.*override)/i, directive: "在重写的方法前添加 `override` 关键字" },
	{ pattern: /(?:wrong number.*argument|too (?:many|few) argument|参数数量)/i, directive: "调整函数调用的参数数量或顺序以匹配函数声明" },
	{ pattern: /(?:constraint.*not satisfied|does not conform|泛型约束)/i, directive: "确保类型参数满足 where 子句中的约束" },
	{ pattern: /(?:mut function|mut.*let)/i, directive: "将 `let` 改为 `var` 以允许调用 mut 方法" },
	{ pattern: /(?:capture.*mutable|spawn.*var|并发.*可变)/i, directive: "使用 Mutex 或 AtomicReference 包装共享可变状态" },
]

/**
 * Given an error message, return a specific fix directive for the AI,
 * or a generic one if no pattern matches.
 */
export function getErrorFixDirective(errorMessage: string): string {
	for (const { pattern, directive } of ERROR_FIX_DIRECTIVES) {
		if (pattern.test(errorMessage)) {
			return directive
		}
	}
	return "分析错误原因并给出最小化修复方案"
}

// ---------------------------------------------------------------------------
// Structured AI editing context
// ---------------------------------------------------------------------------

/**
 * Build a structured editing context for the AI when the user is actively
 * editing a Cangjie file. Includes file info, current function, imports,
 * and recent diagnostics.
 */
export function buildStructuredEditingContext(): string | null {
	const editor = vscode.window.activeTextEditor
	if (!editor || (editor.document.languageId !== "cangjie" && !editor.document.fileName.endsWith(".cj"))) {
		return null
	}

	const doc = editor.document
	const cursorLine = editor.selection.active.line
	const content = doc.getText()
	const defs = parseCangjieDefinitions(content)

	const parts: string[] = []

	// File info
	const fileName = path.basename(doc.fileName)
	parts.push(`当前文件: ${fileName}`)

	// Imports
	const imports = extractImports(content)
	if (imports.length > 0) {
		parts.push(`已导入: ${imports.slice(0, 10).join(", ")}${imports.length > 10 ? " …" : ""}`)
	}

	// Current function/class context
	const enclosing = defs
		.filter((d: CangjieDef) => d.startLine <= cursorLine && d.endLine >= cursorLine && d.kind !== "import" && d.kind !== "package")
		.sort((a: CangjieDef, b: CangjieDef) => (b.startLine - a.startLine))

	if (enclosing.length > 0) {
		const innermost = enclosing[0]
		const sigLine = doc.lineAt(innermost.startLine).text.trim()
		parts.push(`正在编辑: ${innermost.kind} ${innermost.name} (第 ${innermost.startLine + 1} 行)`)
		parts.push(`签名: ${sigLine}`)
	}

	// Nearby code (±5 lines around cursor)
	const startLine = Math.max(0, cursorLine - 5)
	const endLine = Math.min(doc.lineCount - 1, cursorLine + 5)
	const nearbyLines: string[] = []
	for (let i = startLine; i <= endLine; i++) {
		const marker = i === cursorLine ? " >>>" : "    "
		nearbyLines.push(`${marker} ${i + 1}: ${doc.lineAt(i).text}`)
	}
	parts.push(`附近代码:\n${nearbyLines.join("\n")}`)

	// Active diagnostics for this file
	const diags = vscode.languages.getDiagnostics(doc.uri)
	const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
	if (errors.length > 0) {
		const errorSummary = errors.slice(0, 5).map((d) => {
			const directive = getErrorFixDirective(d.message)
			return `  - 第 ${d.range.start.line + 1} 行: ${d.message}\n    建议: ${directive}`
		}).join("\n")
		parts.push(`当前文件错误:\n${errorSummary}`)
	}

	return `## 当前编辑上下文\n\n${parts.join("\n")}`
}

// Re-export for testing
export {
	extractImports,
	mapImportsToDocPaths,
	CJC_ERROR_PATTERNS,
	STDLIB_DOC_MAP,
	parseCjpmToml,
	scanPackageHierarchy,
	resolveImportedSymbols,
	verifyPackageDeclarations,
	buildWorkspaceSymbolSummary,
}
