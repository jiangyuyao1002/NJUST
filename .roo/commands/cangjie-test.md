---
description: "运行仓颉项目的单元测试"
argument-hint: "[包路径...] [--filter \"模式\"] [--verbose]"
mode: cangjie
---

1. 确认当前目录包含 `cjpm.toml`：

    ```bash
    ls cjpm.toml
    ```

2. 查找项目中的测试文件：

    ```bash
    # 列出所有测试文件
    find src -name "*_test.cj" 2>/dev/null || dir /s /b src\*_test.cj
    ```

    如果没有测试文件，提示用户创建测试文件（命名为 `xxx_test.cj`）并提供测试模板。

3. 解析测试选项：
    - 包路径：指定要测试的包（如 `src src/utils`）
    - `--filter "MyTest*.*"`：按名称过滤测试
    - `--verbose` / `-V`：显示详细输出
    - `--parallel N`：并行执行测试
    - `--timeout-each Ns`：单测超时时间

4. 执行测试：

    ```bash
    # 运行所有测试
    cjpm test -V

    # 测试指定包
    cjpm test src/utils -V

    # 过滤运行
    cjpm test --filter "MyTest*.*" -V

    # 并行执行
    cjpm test --parallel 4 -V

    # 生成测试报告
    cjpm test --report-path test-report --report-format json -V
    ```

5. 分析测试结果：
    - **全部通过**：报告通过的测试数量和耗时
    - **部分失败**：列出失败的测试用例，分析断言失败的原因，提出修复建议
    - **编译错误**：分析测试代码的编译问题

6. 如果需要 Mock 测试，提示用户：
    - 在 `cjpm.toml` 中设置 `[profile.test.build] mock = "on"`
    - 使用 `cjpm test --mock`

7. 如果需要代码覆盖率：
    - `cjpm build --coverage` 编译
    - `cjpm test` 运行测试
    - `cjcov` 生成覆盖率报告
