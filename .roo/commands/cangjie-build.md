---
description: "构建仓颉项目"
argument-hint: "[--debug] [--verbose] [--lint] [--clean]"
mode: cangjie
---

1. 确认当前目录包含 `cjpm.toml`：

    ```bash
    ls cjpm.toml
    ```

    如果不存在，提示用户先运行 `/cangjie-init` 或切换到正确的项目目录。

2. 解析构建选项：
    - `--debug` 或 `-g`：Debug 模式构建
    - `--verbose` 或 `-V`：显示详细编译日志
    - `--lint` 或 `-l`：同时运行静态分析
    - `--clean`：先清理再构建

3. 如果指定了 `--clean`，先执行清理：

    ```bash
    cjpm clean
    ```

4. 执行构建：

    ```bash
    # Release 构建（默认）
    cjpm build

    # Debug 构建
    cjpm build -g -V

    # 带 lint 的构建
    cjpm build -l -V
    ```

5. 分析构建结果：
    - **成功**：报告构建产物路径（`target/release/bin/` 或 `target/debug/bin/`）
    - **失败**：仔细分析编译器错误输出，定位问题文件和行号，提出修复建议

6. 如果构建失败，参考 `cangjie-coding` 规则中的"常见编译错误处理"表格诊断问题。

7. 构建成功后提示用户：
    - `cjpm run` — 运行程序
    - `cjpm test` — 运行测试
