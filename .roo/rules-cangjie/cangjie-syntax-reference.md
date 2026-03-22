# 仓颉语法速查手册

本文件在 Cangjie Dev 模式下自动注入 AI 上下文，提供完整的仓颉语言语法参考。

## 1. 基础类型

```
整数:   Int8  Int16  Int32  Int64  IntNative  UInt8  UInt16  UInt32  UInt64  UIntNative
浮点:   Float16  Float32  Float64
布尔:   Bool (true / false)
字符:   Rune ('A', '\n', '\u{1F600}')
字符串: String ("hello", "interpolation: ${expr}")
单元:   Unit (无返回值)
底类型: Nothing (永不返回, 如 throw)
```

## 2. 复合类型

```
元组:     (Int64, String, Bool)          // 访问: t[0], t[1]
数组:     Array<Int64>([1, 2, 3])        // 字面量: [1, 2, 3]
Option:   ?Int64                         // Some(42) 或 None
函数类型: (Int64, String) -> Bool
VArray:   VArray<Int64, $3>              // 固定长度值类型数组(FFI用)
```

## 3. 变量声明

```cangjie
let x: Int64 = 42          // 不可变绑定(优先使用)
var y: Int64 = 0            // 可变绑定
const Z: Int64 = 100        // 编译期常量
let z = 42                  // 类型推断
```

## 4. 函数声明

```cangjie
// 基本函数
func add(a: Int64, b: Int64): Int64 { return a + b }

// 命名参数(调用时必须带名)
func connect(host!: String, port!: Int64 = 8080): Unit { ... }
// 调用: connect(host: "localhost", port: 3000)

// 泛型函数 + where 约束
func max<T>(a: T, b: T): T where T <: Comparable<T> { ... }

// Lambda 表达式
let f = { a: Int64, b: Int64 => a + b }
let g: (Int64) -> Int64 = { x => x * 2 }

// main 函数(程序入口, 必须返回 Int64)
main(): Int64 {
    println("Hello")
    return 0
}
```

## 5. 类型声明

### struct (值类型, 优先使用)

```cangjie
struct Point {
    let x: Float64
    let y: Float64

    public init(x: Float64, y: Float64) {
        this.x = x; this.y = y
    }

    public func distanceTo(other: Point): Float64 { ... }
    public mut func reset(): Unit { this = Point(0.0, 0.0) }
}
```

注意: struct 不能继承, 不能自引用(递归), mut 方法只能在 var 绑定上调用

### class (引用类型)

```cangjie
abstract class Shape {
    private let color: String
    public init(color: String) { this.color = color }
    public open func area(): Float64     // 可被子类 override
    public func describe(): String { ... }
}

class Circle <: Shape {
    let radius: Float64
    public init(radius: Float64) { super("red"); this.radius = radius }
    public override func area(): Float64 { 3.14159 * radius * radius }
}
```

修饰符: public / protected / private / internal / open / abstract / static / sealed

### interface

```cangjie
interface Printable {
    func display(): String
    func debugInfo(): String { "default impl" }   // 可有默认实现
}

class Foo <: Printable {
    public func display(): String { "Foo" }
    // debugInfo 使用默认实现
}
```

### enum

```cangjie
enum Color {
    Red | Green | Blue                              // 无参构造器
    Custom(r: Int64, g: Int64, b: Int64)            // 有参构造器

    public func isCustom(): Bool {
        match (this) {
            case Custom(_, _, _) => true
            case _ => false
        }
    }
}
let c = Color.Red
let c2 = Color.Custom(255, 128, 0)
```

### type alias

```cangjie
type StringList = ArrayList<String>
type Handler = (String) -> Unit
```

## 6. 泛型

```cangjie
class Container<T> {
    var items: ArrayList<T> = ArrayList<T>()
    public func add(item: T): Unit { items.append(item) }
}

// 泛型约束
class SortedList<T> where T <: Comparable<T> { ... }

// 多约束
func process<T>(x: T): Unit where T <: Printable & Hashable { ... }
```

## 7. 扩展(extend)

```cangjie
// 直接扩展
extend String {
    public func reversed(): String { ... }
}

// 接口扩展
extend Int64 <: Printable {
    public func display(): String { "${this}" }
}
```

## 8. 控制流

```cangjie
// if-else (是表达式, 有返回值)
let max = if (a > b) { a } else { b }

// match (模式匹配, 替代 switch)
match (value) {
    case 0 => println("zero")
    case n where n > 0 => println("positive: ${n}")
    case _ => println("negative")
}

// for-in
for (i in 0..10) { ... }          // 0 到 9 (左闭右开)
for (i in 0..=10) { ... }         // 0 到 10 (左闭右闭)
for (i in 0..10 : 2) { ... }      // 步长 2
for ((k, v) in map) { ... }       // 解构迭代

// while
while (cond) { ... }
do { ... } while (cond)           // 至少执行一次

// break / continue 可带标签
@label for (...) { break @label }
```

## 9. 错误处理

```cangjie
// try-catch-finally
try {
    riskyOperation()
} catch (e: IOException) {
    println("IO error: ${e.message}")
} catch (e: Exception) {
    println("Error: ${e.message}")
} finally {
    cleanup()
}

// try-with-resources (自动关闭 Resource)
try (file = openFile("data.txt")) {
    file.read()
}   // 自动调用 file.close()

// 自定义异常
class AppError <: Exception {
    public init(msg: String) { super(msg) }
}
throw AppError("something went wrong")

// Option 处理
let v: ?Int64 = findValue()
let result = v ?? 0                // 合并运算符
let name = user?.profile?.name     // 可选链
let x = opt.getOrThrow()           // None 时抛 NoneValueException
```

## 10. 并发

```cangjie
import std.sync.*

// 创建协程
let future = spawn { heavyWork() }
let result = future.get()         // 阻塞等待结果

// 互斥锁
let mutex = Mutex()
mutex.lock()
try { sharedData++ } finally { mutex.unlock() }

// synchronized 块
let obj = Object()
synchronized (obj) { sharedData++ }
```

## 11. 包与导入

```cangjie
package my_app.utils               // 包声明(每个文件顶部)

import std.collection.*            // 导入包中所有公开成员
import std.io.{InputStream, OutputStream}  // 选择性导入

// 访问修饰符
// public    - 所有包可见
// internal  - 同模块内可见(默认)
// protected - 子类可见
// private   - 当前作用域可见
```

## 12. 属性(prop)

```cangjie
class Temperature {
    private var _celsius: Float64

    public prop celsius: Float64 {
        get() { _celsius }
        set(value) { _celsius = value }
    }

    public prop fahrenheit: Float64 {
        get() { _celsius * 9.0 / 5.0 + 32.0 }
    }
}
```

## 13. 操作符优先级(从高到低)

```
0  @         宏调用
1  . [] ()   成员访问/索引/调用
2  ++ -- ?   自增自减/可选链
3  ! -       逻辑非/一元负号
4  **        幂运算(右结合)
5  * / %     乘除取模
6  + -       加减
7  << >>     位移
8  .. ..=    区间
9  < <= > >= is as   比较/类型检查
10 == !=     判等
11 &         按位与
12 ^         按位异或
13 |         按位或
14 &&        逻辑与
15 ||        逻辑或
16 ??        合并运算符(右结合)
17 |> ~>     管道/组合
18 = += -= *= /= 等  赋值
```

## 14. 关键字速查

```
声明:  func class struct enum interface extend type let var const prop
修饰:  public private protected internal open abstract static sealed mut override redef
控制:  if else match case for in while do break continue return
异常:  try catch finally throw
类型:  Bool Int8-64 UInt8-64 Float16-64 Rune String Unit Nothing
其他:  import package main init this super is as where true false spawn synchronized unsafe foreign macro quote
```
