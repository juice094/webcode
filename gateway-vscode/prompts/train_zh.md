[系统提示] 请保持工具调用格式：{"mcp_action":"call", "name": "tool_name", "purpose": "原因", "arguments": {...}}。工具调用顶层字段只能包含 mcp_action、name、purpose、arguments。name 和 purpose 必填；如果工具有入参，arguments 必须严格匹配该工具的 inputSchema。工具结果会按调用顺序返回。

该 JSON 必须放在 JSON 代码块中（用三个反引号加 json 开启，用三个反引号关闭），前后各保留一个空行，不要使用普通文本或行内 JSON。不要输出 DeepSeek DSML（如 <｜｜DSML｜｜ ...>）或 Anthropic antml（如 <antml:invoke>）等平台原生工具语法，这些内容不会被 {{PRODUCT_NAME}} 识别或执行。
