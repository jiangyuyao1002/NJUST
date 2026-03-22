# 仓颉语法详细参考 (Cangjie Syntax Detail)

当 `.roo/rules-cangjie/cangjie-syntax-reference.md` 速查手册不够详细时，使用本 Skill 获取完整的语法规则和代码示例。

---

## 1. 程序结构与入口

```cangjie
package my_app           // 包声明，必须在文件首行

import std.collection.*  // 导入
import std.io.{File, Path}

// 顶层变量
let APP_VERSION = "1.0.0"

// 顶层函数
func helper(): Unit { ... }

// main 入口
main(): Int64 {
    println("Hello, Cangjie!")
    return 0
}
```

规则:
- 每个 .cj 文件必须有 `package` 声明
- `main()` 函数签名固定为 `main(): Int64`
- `main()` 必须在包的某个文件中定义一次
- 顶层可以有 `let`/`var`/`const`/`func`/`class`/`struct`/`enum`/`interface`/`extend`/`type` 声明

---

## 2. 变量与常量详细规则

```cangjie
// 不可变绑定 (优先使用)
let x = 42                  // 类型推断为 Int64
let y: Float64 = 3.14       // 显式类型
let s = "hello"             // String 类型

// 可变绑定
var count = 0
count = count + 1           // OK
count += 1                  // OK

// 编译期常量
const MAX = 100             // 编译期确定
const PI: Float64 = 3.14159

// 解构绑定
let (a, b, c) = (1, "two", true)
let (first, _, last) = (1, 2, 3)  // _ 忽略元素
```

规则:
- `let` 绑定后不能重新赋值
- `var` 可重新赋值，但类型不变
- `const` 值必须是编译期可求值的字面量或常量表达式
- 类型推断适用于 `let`/`var`/`const`
- 不支持 `var x: Int64` 不赋初值（必须初始化）

---

## 3. 函数详细语法

### 3.1 普通函数

```cangjie
// 参数和返回值类型必须显式标注
func add(a: Int64, b: Int64): Int64 {
    return a + b
}

// 最后一个表达式作为返回值
func multiply(a: Int64, b: Int64): Int64 {
    a * b   // 隐式返回
}

// 无返回值函数
func greet(name: String): Unit {
    println("Hello, ${name}!")
}

// Unit 返回类型可省略
func greet2(name: String) {
    println("Hello, ${name}!")
}
```

### 3.2 命名参数

```cangjie
// 用 ! 标记命名参数
func connect(host!: String, port!: Int64 = 8080, timeout!: Int64 = 30): Unit {
    println("Connecting to ${host}:${port}")
}

// 调用时必须带参数名
connect(host: "localhost", port: 3000)
connect(host: "example.com")  // port 和 timeout 使用默认值
connect(host: "example.com", timeout: 60, port: 443)  // 顺序可变
```

### 3.3 函数重载

```cangjie
func format(v: Int64): String { "${v}" }
func format(v: Float64): String { "${v}" }
func format(v: String): String { v }
```

### 3.4 Lambda 表达式

```cangjie
// 完整形式
let add = { a: Int64, b: Int64 => a + b }

// 类型推断
let nums = [1, 2, 3]
let doubled = nums.map { x => x * 2 }

// 多行 lambda
let process = { x: Int64 =>
    let y = x * 2
    y + 1
}

// 尾随 lambda (最后一个参数是函数类型时)
list.filter { x => x > 0 }
list.forEach { item =>
    println(item)
}
```

### 3.5 运算符重载

```cangjie
struct Vec2 {
    let x: Float64
    let y: Float64

    operator func +(rhs: Vec2): Vec2 {
        Vec2(x + rhs.x, y + rhs.y)
    }

    operator func ==(rhs: Vec2): Bool {
        x == rhs.x && y == rhs.y
    }
}
```

---

## 4. struct 详细语法

```cangjie
struct Point {
    // 成员变量
    let x: Float64          // 不可变
    var label: String       // 可变

    // 构造函数
    public init(x: Float64, label: String) {
        this.x = x
        this.label = label
    }

    // 便利构造函数
    public init(x: Float64) {
        this(x, "default")  // 委托到另一个 init
    }

    // 普通方法
    public func distanceTo(other: Point): Float64 {
        let dx = this.x - other.x
        (dx * dx).sqrt()
    }

    // mut 方法 (修改 struct 自身)
    public mut func setLabel(newLabel: String): Unit {
        label = newLabel
    }

    // 静态方法
    public static func origin(): Point {
        Point(0.0, "origin")
    }
}

// 使用
let p1 = Point(1.0, "A")      // let 绑定
var p2 = Point(2.0, "B")      // var 绑定
p2.setLabel("B2")              // OK: var 可调用 mut 方法
// p1.setLabel("A2")           // 错误: let 不能调用 mut 方法
let p3 = Point.origin()       // 静态方法调用
```

struct 规则:
- 值类型，赋值时拷贝
- 不支持继承（不能用 `<:` 继承其他 struct 或 class）
- 可以实现 interface（用 `<:` 语法）
- 不能包含自身类型的成员（递归成员）
- mut 方法只能在 var 绑定上调用
- 所有成员必须在 init 中初始化

---

## 5. class 详细语法

```cangjie
// 抽象类
abstract class Animal {
    private var _name: String

    public init(name: String) {
        _name = name
    }

    // 属性
    public prop name: String {
        get() { _name }
    }

    // open 方法可被子类重写
    public open func speak(): String {
        "..."
    }

    // 抽象方法（子类必须实现）
    public func move(): String
}

// 继承
class Dog <: Animal {
    private let breed: String

    public init(name: String, breed: String) {
        super(name)             // 调用父类构造
        this.breed = breed
    }

    public override func speak(): String {
        "Woof!"
    }

    public func move(): String {
        "${name} runs"
    }
}

// sealed 类（限制继承范围到同一包）
sealed class Result {}
class Success <: Result { let value: String }
class Failure <: Result { let error: String }
```

class 规则:
- 引用类型，赋值时引用
- 单继承 `<:`, 可同时实现多个 interface
- `open` 方法可被 override, 非 open 不可重写
- `abstract` 方法没有方法体，子类必须实现
- `sealed` 限制所有子类必须在同一包内定义
- 构造函数中必须先调用 `super(...)` 再初始化自身成员

---

## 6. interface 详细语法

```cangjie
interface Stringifiable {
    // 抽象方法
    func stringify(): String

    // 默认实现
    func debug(): String {
        "Debug: ${stringify()}"
    }
}

interface Comparable<T> {
    operator func <(other: T): Bool
    operator func >(other: T): Bool {
        other < this   // 利用 < 实现默认 >
    }
}

// 实现接口
class Score <: Stringifiable & Comparable<Score> {
    let value: Int64

    public init(value: Int64) { this.value = value }

    public func stringify(): String { "${value}" }

    public operator func <(other: Score): Bool {
        this.value < other.value
    }
}
```

interface 规则:
- 不能有成员变量
- 方法可以有默认实现
- 一个类型可以实现多个接口（`<: A & B & C`）
- 接口可以继承其他接口

---

## 7. enum 详细语法

```cangjie
// 简单枚举
enum Direction {
    North | South | East | West
}

// 带关联值的枚举
enum Shape {
    Circle(radius: Float64)
    Rectangle(width: Float64, height: Float64)
    Point

    public func area(): Float64 {
        match (this) {
            case Circle(r) => 3.14159 * r * r
            case Rectangle(w, h) => w * h
            case Point => 0.0
        }
    }
}

// 泛型枚举
enum Result<T, E> {
    Ok(value: T)
    Err(error: E)
}

// 使用
let s = Shape.Circle(5.0)
let d = Direction.North
let r: Result<String, String> = Result.Ok("success")
```

enum 规则:
- 构造器名首字母大写
- 构造器之间用 `|` 分隔或换行
- 可以有方法和属性
- match 必须穷尽所有构造器

---

## 8. 模式匹配详细语法

```cangjie
// match 表达式 (有返回值)
let desc = match (value) {
    case 0 => "zero"
    case n where n > 0 && n < 10 => "small positive"
    case n where n >= 10 => "large: ${n}"
    case _ => "negative"
}

// 枚举匹配
match (shape) {
    case Shape.Circle(r) where r > 0.0 => println("circle radius ${r}")
    case Shape.Rectangle(w, h) => println("${w} x ${h}")
    case _ => println("other")
}

// 元组匹配
match ((x, y)) {
    case (0, 0) => "origin"
    case (_, 0) => "on x-axis"
    case (0, _) => "on y-axis"
    case (a, b) => "point (${a}, ${b})"
}

// 类型匹配
match (obj) {
    case s: String => println("string: ${s}")
    case n: Int64 => println("int: ${n}")
    case _ => println("other")
}

// if-let (解构 Option)
let opt: ?Int64 = Some(42)
if (let Some(v) = opt) {
    println("has value: ${v}")
}
```

---

## 9. 泛型详细语法

```cangjie
// 泛型类
class Stack<T> {
    private var items = ArrayList<T>()

    public func push(item: T): Unit { items.append(item) }
    public func pop(): ?T {
        if (items.size == 0) { return None }
        let last = items[items.size - 1]
        items.remove(items.size - 1)
        return Some(last)
    }
}

// 泛型函数
func swap<T>(a: T, b: T): (T, T) { (b, a) }

// where 约束
func findMax<T>(items: Array<T>): ?T where T <: Comparable<T> {
    if (items.size == 0) { return None }
    var max = items[0]
    for (i in 1..items.size) {
        if (items[i] > max) { max = items[i] }
    }
    return Some(max)
}

// 多约束
func printAndCompare<T>(a: T, b: T): Bool where T <: Stringifiable & Comparable<T> {
    println("${a.stringify()} vs ${b.stringify()}")
    a < b
}

// 泛型接口
interface Container<T> {
    func get(index: Int64): T
    func set(index: Int64, value: T): Unit
    prop size: Int64 { get() }
}
```

---

## 10. 扩展(extend)详细语法

```cangjie
// 直接扩展: 为现有类型添加方法
extend String {
    public func wordCount(): Int64 {
        this.split(" ").size
    }

    public func isPalindrome(): Bool {
        let chars = this.toArray()
        var i = 0
        var j = chars.size - 1
        while (i < j) {
            if (chars[i] != chars[j]) { return false }
            i += 1
            j -= 1
        }
        true
    }
}

// 接口扩展: 让现有类型实现新接口
extend Int64 <: Stringifiable {
    public func stringify(): String { "${this}" }
}

// 泛型扩展
extend Array<T> where T <: Comparable<T> {
    public func sorted(): Array<T> { ... }
}
```

extend 规则:
- 不能添加存储属性（成员变量）
- 可以添加方法、计算属性、接口实现
- 扩展的方法与原始方法同等优先级
- 接口扩展使用 `extend Type <: Interface` 语法

---

## 11. 集合类型详细用法

```cangjie
import std.collection.*

// Array (固定长度)
let arr = [1, 2, 3, 4, 5]
let first = arr[0]              // 下标访问
let len = arr.size              // 长度

// ArrayList (动态数组)
var list = ArrayList<String>()
list.append("a")
list.append("b")
list.insert(0, "first")
list.remove(1)
let item = list[0]

// HashMap
var map = HashMap<String, Int64>()
map["key"] = 42
let v: ?Int64 = map["key"]     // 返回 Option
map.remove("key")
for ((k, v) in map) { println("${k}: ${v}") }

// HashSet
var set = HashSet<Int64>()
set.put(1)
set.put(2)
let contains = set.contains(1)  // true
set.remove(1)
```

---

## 12. 并发详细语法

```cangjie
import std.sync.*

// 基本 spawn
let future = spawn {
    let result = heavyCompute()
    result
}
let value = future.get()       // 阻塞等待

// 多协程
let futures = ArrayList<Future<Int64>>()
for (i in 0..10) {
    let f = spawn {
        compute(i)
    }
    futures.append(f)
}
for (f in futures) {
    println(f.get())
}

// Mutex 保护共享状态
class Counter {
    private var count = 0
    private let mutex = Mutex()

    public func increment(): Unit {
        mutex.lock()
        try { count += 1 } finally { mutex.unlock() }
    }

    public func get(): Int64 {
        mutex.lock()
        try { return count } finally { mutex.unlock() }
    }
}

// synchronized
let lock = Object()
synchronized (lock) {
    // 临界区
}
```

---

## 13. FFI (C 互操作)

```cangjie
// 声明外部 C 函数
foreign func puts(s: CString): Int32

// 使用 unsafe 调用
main(): Int64 {
    unsafe {
        let cs = CString("Hello from C")
        puts(cs)
    }
    return 0
}

// C 结构体映射
@C
struct CPoint {
    var x: Float64
    var y: Float64
}
```

FFI 规则:
- `foreign func` 声明外部 C 函数
- 调用 foreign 函数必须在 `unsafe` 块内
- 使用 `CString`/`CPointer`/`VArray` 等 FFI 类型
- `@C` 标注确保 struct 与 C 布局兼容
