# 仓颉语言编码规则

## 1. 项目文件模板

### 1.1 可执行项目 main.cj

```cangjie
package my_app

import std.console.*

main(): Int64 {
    println("Hello, Cangjie!")
    return 0
}
```

### 1.2 库项目入口

```cangjie
package my_lib

public func greet(name: String): String {
    return "Hello, ${name}!"
}
```

### 1.3 测试文件模板 (xxx_test.cj)

```cangjie
package my_app

import std.unittest.*
import std.unittest.testmacro.*

@Test
class MyTest {
    @TestCase
    func testBasic() {
        @Assert(1 + 1 == 2)
    }

    @TestCase
    func testString() {
        let s = "hello"
        @Assert(s.size == 5)
    }
}
```

---

## 2. 常用语言模式

### 2.1 错误处理

```cangjie
try {
    let result = riskyOperation()
    println(result)
} catch (e: FileNotFoundException) {
    println("文件未找到: ${e.message}")
} catch (e: Exception) {
    println("未知错误: ${e.message}")
} finally {
    cleanup()
}
```

### 2.2 Option 类型

```cangjie
func findUser(id: Int64): ?User {
    if (id > 0) {
        return Some(User(id))
    }
    return None
}

let user = findUser(1) ?? defaultUser
```

### 2.3 模式匹配

```cangjie
match (value) {
    case 0 => println("zero")
    case n where n > 0 => println("positive: ${n}")
    case _ => println("negative")
}
```

### 2.4 并发

```cangjie
import std.sync.*
import std.time.*

let future = spawn {
    // 异步任务
    heavyComputation()
}
let result = future.get()
```

---

## 3. cjpm.toml 常用配置模板

### 3.1 基本可执行项目

```toml
[package]
cjc-version = "0.55.3"
name = "my_app"
version = "1.0.0"
output-type = "executable"
src-dir = "src"
target-dir = "target"

[profile.build]
incremental = true
```

### 3.2 带依赖的项目

```toml
[package]
cjc-version = "0.55.3"
name = "my_app"
version = "1.0.0"
output-type = "executable"

[dependencies]
my_lib = { path = "./my_lib" }

[test-dependencies]
mock_lib = { path = "./mock_lib" }

[profile.test]
timeout-each = "30s"
parallel = "4"
```

### 3.3 工作区项目

```toml
[workspace]
members = ["app", "lib_core", "lib_utils"]
build-members = ["app"]
test-members = ["app", "lib_core"]
```

---

## 4. 仓颉文件类型识别

| 扩展名 | 说明 |
|---------|------|
| `.cj` | 仓颉源代码文件 |
| `_test.cj` | 仓颉测试文件 |
| `cjpm.toml` | 项目配置文件 |
| `cjpm.lock` | 依赖锁定文件（不要手动编辑） |
| `cangjie-format.toml` | cjfmt 格式化配置 |
| `build.cj` | 构建脚本（钩子） |

---

## 5. 常见编译错误处理

| 错误类型 | 常见原因 | 解决方案 |
|----------|----------|----------|
| 未找到符号 | 缺少 import 或包依赖 | 检查 import 语句和 cjpm.toml 依赖 |
| 类型不匹配 | 赋值或传参类型错误 | 检查类型声明和转换 |
| 循环依赖 | 包之间互相引用 | 使用 `cjpm check` 查看依赖关系，重构 |
| let 变量赋值 | 尝试修改不可变变量 | 改用 `var` 声明 |
| mut 函数限制 | let 变量调用 mut 函数 | 改用 `var` 声明变量 |
| 递归结构体 | struct 直接或间接自引用 | 改用 class（引用类型）或 Option 包装 |
