import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

const IMPORT_REGEX = /^\s*import\s+([\w.]+)\.\*?\s*$/gm
const FROM_IMPORT_REGEX = /^\s*from\s+([\w.]+)\s+import\s+/gm

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

### 项目结构
- 测试文件命名: xxx_test.cj
- 使用 @Test 标注测试类，@TestCase 标注测试方法
- 保持 cjpm.toml 中的依赖声明最新`

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

/**
 * Generate the Cangjie context section for the system prompt.
 * Only included when mode is "cangjie".
 */
export function getCangjieContextSection(cwd: string, mode: string): string {
	if (mode !== "cangjie") return ""

	const docsBase = resolveDocsBasePath(cwd)
	const docsExist = fs.existsSync(docsBase)

	const sections: string[] = []

	// 1. Import-based documentation context
	const imports = collectActiveCangjieImports()
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

	if (sections.length === 0) return ""

	return `====

CANGJIE DEVELOPMENT CONTEXT

${sections.join("\n\n")}
`
}

/**
 * Enhance a cjc/cjlint error message with documentation references and fix suggestions.
 * Called when terminal output contains compilation errors.
 */
export function enhanceCjcErrorOutput(errorOutput: string, cwd: string): string {
	const docsBase = resolveDocsBasePath(cwd)
	const docsExist = fs.existsSync(docsBase)
	if (!docsExist) return ""

	const matchedSuggestions: string[] = []
	const seen = new Set<string>()

	for (const pattern of CJC_ERROR_PATTERNS) {
		if (pattern.pattern.test(errorOutput) && !seen.has(pattern.category)) {
			seen.add(pattern.category)
			const docPaths = pattern.docPaths.map((p) => `.roo/skills/cangjie-full-docs/${p}`).join(", ")
			matchedSuggestions.push(
				`[${pattern.category}] ${pattern.suggestion} (参考: ${docPaths})`,
			)
		}
	}

	if (matchedSuggestions.length === 0) return ""

	return `\n\n<cangjie_error_hints>\n${matchedSuggestions.join("\n")}\n</cangjie_error_hints>`
}

// Re-export for testing
export { extractImports, mapImportsToDocPaths, CJC_ERROR_PATTERNS, STDLIB_DOC_MAP }
