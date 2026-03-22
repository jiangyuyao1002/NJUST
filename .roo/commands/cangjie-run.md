---
description: "构建并运行仓颉项目"
argument-hint: "[--args \"参数\"] [--debug] [--skip-build]"
mode: cangjie
---

1. 确认当前目录包含 `cjpm.toml`：

    ```bash
    ls cjpm.toml
    ```

2. 确认项目 output-type 为 executable：

    ```bash
    grep output-type cjpm.toml
    ```

    如果不是 executable 类型，提示用户此命令仅适用于可执行项目。

3. 解析运行选项：
    - `--args "..."` 或 `--run-args "..."`：传递程序参数
    - `--debug` 或 `-g`：Debug 模式构建运行
    - `--skip-build`：跳过构建直接运行

4. 执行构建并运行：

    ```bash
    # 默认运行
    cjpm run

    # 带参数运行
    cjpm run --run-args "arg1 arg2"

    # Debug 模式
    cjpm run -g

    # 跳过构建
    cjpm run --skip-build
    ```

5. 分析运行结果：
    - **编译错误**：分析错误并提出修复建议
    - **运行时异常**：分析异常栈信息，定位问题代码
    - **正常输出**：展示程序输出结果

6. 如果程序崩溃或抛出异常，提示用户可以用 Debug 模式进一步调试：
    - `cjpm build -g` 然后 `cjdb ./target/debug/bin/<name>` 启动调试器
