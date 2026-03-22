---
description: "初始化一个新的仓颉项目"
argument-hint: "[项目名] [--type=executable|static|dynamic]"
mode: cangjie
---

1. 确认仓颉工具链已安装：

    ```bash
    cjpm --version
    ```

    如果命令不存在，提示用户安装仓颉语言工具链。

2. 解析用户提供的参数：
    - 如果提供了项目名，使用 `--name` 指定
    - 如果未指定类型，默认使用 `executable`
    - 如果用户要求工作区项目，使用 `--workspace`

3. 创建项目目录（如果项目名不是当前目录）：

    ```bash
    mkdir <project_name>
    cd <project_name>
    ```

4. 初始化项目：

    ```bash
    cjpm init --name <project_name> --type=<type>
    ```

5. 确认项目创建成功，列出生成的文件：

    ```bash
    ls -la
    cat cjpm.toml
    ```

6. 如果是可执行项目，展示 `src/main.cj` 内容并说明入口点结构。

7. 提示用户下一步操作：
    - `cjpm build` — 构建项目
    - `cjpm run` — 运行项目
    - `cjpm test` — 运行测试
    - 编辑 `cjpm.toml` 添加依赖
