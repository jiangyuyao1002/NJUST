---
description: "对仓颉项目进行完整的代码质量检查（格式化 + lint + 构建 + 测试）"
argument-hint: "[--fix] [--lint-only] [--fmt-only]"
mode: cangjie
---

1. 确认当前目录包含 `cjpm.toml`：

    ```bash
    ls cjpm.toml
    ```

2. 解析检查选项：
    - `--fix`：自动修复格式问题
    - `--lint-only`：仅运行 lint
    - `--fmt-only`：仅运行格式化
    - 无参数：运行完整检查流程

3. **步骤 1 — 代码格式化**（除非 `--lint-only`）：

    ```bash
    # 检查格式（不修改文件）
    cjfmt --check src/

    # 自动格式化（如果指定 --fix）
    cjfmt -f src/
    ```

    报告格式化修改了哪些文件。如果 `--fmt-only`，到此结束。

4. **步骤 2 — 依赖检查**：

    ```bash
    cjpm check
    ```

    确认包依赖关系正确，无循环依赖。

5. **步骤 3 — 编译 + 静态分析**（除非 `--fmt-only`）：

    ```bash
    cjpm build -l -V
    ```

    `-l` 会同时运行 cjlint 静态分析。如果 `--lint-only`，到此结束。

6. **步骤 4 — 运行测试**：

    ```bash
    cjpm test -V
    ```

7. **汇总报告**：

    ```
    ✓ 格式化检查: 通过 / N 个文件已格式化
    ✓ 依赖检查:   通过 / 发现问题
    ✓ 编译检查:   通过 / 失败
    ✓ Lint 检查:  通过 / N 个警告
    ✓ 测试:       N 通过 / M 失败
    ```

    对每个失败项提供详细分析和修复建议。

8. 如果所有检查通过，提示项目状态良好，可以提交代码。
