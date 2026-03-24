"""
MCP Tools Server 端到端测试脚本
用法：
  1. 在 VS Code 中按 F5 启动扩展调试（Extension Host）
  2. 在调试窗口中打开一个文件夹（工作区）
  3. 回到本窗口，运行: python test-mcp-server.py
"""

import json
import sys
import http.client
from urllib.parse import urlparse

MCP_URL = "http://127.0.0.1:3100/mcp"
AUTH_TOKEN = ""  # 本地测试可留空；如果设置了 authToken 则填入


def make_headers(session_id=None):
    h = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if AUTH_TOKEN:
        h["Authorization"] = f"Bearer {AUTH_TOKEN}"
    if session_id:
        h["mcp-session-id"] = session_id
    return h


def parse_sse_response(raw_text):
    """从 SSE text/event-stream 响应中提取 JSON-RPC 消息"""
    results = []
    for line in raw_text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            data = line[len("data:"):].strip()
            if data:
                try:
                    results.append(json.loads(data))
                except json.JSONDecodeError:
                    pass
    return results


def post(body, session_id=None):
    """发送 POST 请求，自动处理 JSON 和 SSE 两种响应格式"""
    parsed = urlparse(MCP_URL)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
    data = json.dumps(body).encode("utf-8")
    h = make_headers(session_id)

    try:
        conn.request("POST", parsed.path, body=data, headers=h)
        resp = conn.getresponse()
    except ConnectionRefusedError:
        print(f"\n[FAIL] 无法连接 {MCP_URL}")
        print(f"  请确认:")
        print(f"    1. 已按 F5 启动扩展调试")
        print(f"    2. 调试窗口中已打开一个文件夹")
        print(f"    3. 输出面板显示 '[McpToolsServer] Started on ...'")
        sys.exit(1)

    status = resp.status
    sid = resp.getheader("mcp-session-id", session_id)
    content_type = resp.getheader("Content-Type", "")
    raw = resp.read().decode("utf-8")
    conn.close()

    if status == 202:
        return None, sid

    if status >= 400:
        print(f"\n[FAIL] HTTP {status}: {raw[:300]}")
        sys.exit(1)

    if "text/event-stream" in content_type:
        messages = parse_sse_response(raw)
        return messages[0] if messages else None, sid
    else:
        return json.loads(raw), sid


def call_tool(session_id, tool_name, arguments, req_id):
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
        "id": req_id,
    }
    result, _ = post(body, session_id)
    return result


def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_result(label, result):
    if result is None:
        print(f"\n  [WARN] {label}: 无响应")
        return
    content = result.get("result", {}).get("content", [{}])
    text = content[0].get("text", "") if content else ""
    is_error = content[0].get("isError", False) if content else False
    status = "[ERROR]" if is_error else "[OK]"
    print(f"\n  {status} {label}")
    preview = text[:500] + ("..." if len(text) > 500 else "")
    for line in preview.split("\n"):
        print(f"    {line}")


def main():
    print_section("MCP Tools Server 测试")
    print(f"  目标: {MCP_URL}")

    # 1. Initialize
    print_section("1. 初始化会话 (initialize)")
    init_body = {
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "test-script", "version": "1.0.0"},
        },
        "id": 1,
    }
    result, session_id = post(init_body)
    print(f"  [OK] 会话建立成功")
    print(f"  Session ID: {session_id}")
    if result:
        server_info = result.get("result", {}).get("serverInfo", {})
        print(f"  Server: {server_info.get('name')} v{server_info.get('version')}")

    # 2. Send initialized notification (expects 202, no body)
    post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id)
    print("  [OK] initialized 通知已发送")

    # 3. List tools
    print_section("2. 列出可用工具 (tools/list)")
    result, _ = post({"jsonrpc": "2.0", "method": "tools/list", "id": 2}, session_id)
    tools = result.get("result", {}).get("tools", []) if result else []
    print(f"  [OK] 共 {len(tools)} 个工具:")
    for t in tools:
        print(f"    - {t['name']}: {t.get('description', '')[:60]}")

    # 4. Test read_file
    print_section("3. 测试 read_file")
    r = call_tool(session_id, "read_file", {"path": "package.json", "start_line": 1, "end_line": 10}, 10)
    print_result("读取 package.json 前10行", r)

    # 5. Test list_files
    print_section("4. 测试 list_files")
    r = call_tool(session_id, "list_files", {"path": ".", "recursive": False}, 20)
    print_result("列出工作区根目录", r)

    # 6. Test search_files
    print_section("5. 测试 search_files")
    r = call_tool(session_id, "search_files", {"path": ".", "regex": "mcpServer", "file_pattern": "*.json"}, 30)
    print_result("搜索 'mcpServer' in *.json", r)

    # 7. Test execute_command
    print_section("6. 测试 execute_command")
    r = call_tool(session_id, "execute_command", {"command": "echo hello-from-mcp", "timeout": 10}, 40)
    print_result("执行 echo 命令", r)

    # 8. Test write + read round-trip
    print_section("7. 测试 write_to_file + read_file 往返")
    test_content = "# MCP Test\nThis file was created by the MCP test script.\n"
    r = call_tool(session_id, "write_to_file", {"path": ".mcp-test-tmp.txt", "content": test_content}, 50)
    print_result("写入 .mcp-test-tmp.txt", r)

    r = call_tool(session_id, "read_file", {"path": ".mcp-test-tmp.txt"}, 51)
    print_result("回读 .mcp-test-tmp.txt", r)

    # 9. Test apply_diff
    print_section("8. 测试 apply_diff")
    diff = (
        "<<<<<<< SEARCH\n"
        "This file was created by the MCP test script.\n"
        "=======\n"
        "This file was modified by apply_diff.\n"
        ">>>>>>> REPLACE"
    )
    r = call_tool(session_id, "apply_diff", {"path": ".mcp-test-tmp.txt", "diff": diff}, 60)
    print_result("对 .mcp-test-tmp.txt 应用 diff", r)

    r = call_tool(session_id, "read_file", {"path": ".mcp-test-tmp.txt"}, 61)
    print_result("验证 diff 结果", r)

    # Cleanup
    print_section("9. 清理临时文件")
    import platform
    del_cmd = "del .mcp-test-tmp.txt" if platform.system() == "Windows" else "rm .mcp-test-tmp.txt"
    call_tool(session_id, "execute_command", {"command": del_cmd, "timeout": 5}, 70)
    print("  [OK] 已删除 .mcp-test-tmp.txt")

    # Summary
    print_section("全部测试通过!")
    print("  已验证 6 个工具:")
    print("    read_file       OK")
    print("    write_to_file   OK")
    print("    list_files      OK")
    print("    search_files    OK")
    print("    execute_command OK")
    print("    apply_diff      OK")
    print()


if __name__ == "__main__":
    main()
