# Anthropic Messages API 完整出入参格式

---

## 一、入参格式（Request）

### 1.1 完整字段说明

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 4096,
  "stream": true,
  "temperature": 1.0,

  "system": "你是一个助手",

  "messages": [...],

  "tools": [...],
  "tool_choice": {...},

  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },

  "output_config": {
    "effort": "high"
  },

  "metadata": {
    "user_id": "user_123"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名称，如 `claude-opus-4-6`、`claude-sonnet-4-6` |
| `max_tokens` | int | ✅ | 最大输出 token 数 |
| `messages` | array | ✅ | 对话历史，见下文 |
| `system` | string \| array | ❌ | 系统提示词，可以是字符串或内容块数组 |
| `stream` | bool | ❌ | 是否流式输出，默认 false |
| `temperature` | float | ❌ | 采样温度，范围 0~1，默认 1.0 |
| `tools` | array | ❌ | 可用工具定义，见下文 |
| `tool_choice` | object | ❌ | 工具调用策略，`auto`/`any`/`tool` |
| `thinking` | object | ❌ | 思考配置，见下文 |
| `output_config` | object | ❌ | 输出配置，如 `effort` 等级 |
| `metadata` | object | ❌ | 请求元数据，如 `user_id` |

---

### 1.2 messages 字段

每条消息的结构：

```json
{
  "role": "user | assistant",
  "content": "字符串" 或 [内容块数组]
}
```

**content 可以是字符串（简写）：**

```json
{"role": "user", "content": "你好"}
```

**content 也可以是内容块数组（完整格式）：**

#### text 块

```json
{
  "type": "text",
  "text": "用户或助手的文本内容"
}
```

#### image 块（仅 user 消息）

```json
{
  "type": "image",
  "source": {
    "type": "url",
    "url": "https://example.com/image.jpg"
  }
}
```

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "iVBORw0KGgo..."
  }
}
```

#### thinking 块（仅 assistant 消息，历史记录中携带）

```json
{
  "type": "thinking",
  "thinking": "让我先分析一下这个问题..."
}
```

#### tool_use 块（仅 assistant 消息）

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835uuxy",
  "name": "get_weather",
  "input": {
    "city": "北京"
  }
}
```

#### tool_result 块（仅 user 消息，紧随含 tool_use 的 assistant 消息）

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01A09q90qw90lq917835uuxy",
  "content": "北京今天晴，气温25°C"
}
```

`content` 也可以是数组（多模态结果）：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01A09q90qw90lq917835uuxy",
  "content": [
    {"type": "text", "text": "查询结果如下"},
    {"type": "image", "source": {"type": "url", "url": "..."}}
  ]
}
```

---

### 1.3 system 字段

**字符串形式：**

```json
"system": "你是一个有帮助的助手。"
```

**数组形式（支持 cache_control）：**

```json
"system": [
  {
    "type": "text",
    "text": "你是一个有帮助的助手。",
    "cache_control": {"type": "ephemeral"}
  },
  {
    "type": "text",
    "text": "额外的系统指令。"
  }
]
```

---

### 1.4 tools 字段

```json
"tools": [
  {
    "name": "get_weather",
    "description": "获取指定城市的当前天气",
    "input_schema": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "城市名称"
        },
        "unit": {
          "type": "string",
          "enum": ["celsius", "fahrenheit"],
          "description": "温度单位"
        }
      },
      "required": ["city"]
    }
  }
]
```

---

### 1.5 thinking 字段

```json
"thinking": {
  "type": "enabled",
  "budget_tokens": 10000
}
```

| type 值 | 说明 |
|---------|------|
| `enabled` | 强制开启思考 |
| `disabled` | 强制关闭思考 |
| `adaptive` | 模型自动决定是否思考 |

---

### 1.6 完整入参示例（含工具调用历史）

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 4096,
  "stream": true,
  "temperature": 1.0,
  "system": "你是一个天气助手。",
  "thinking": {
    "type": "enabled",
    "budget_tokens": 5000
  },
  "tools": [
    {
      "name": "get_weather",
      "description": "获取天气",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": {"type": "string"}
        },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "北京今天天气怎么样？"
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "用户想知道北京的天气，我需要调用 get_weather 工具。"
        },
        {
          "type": "text",
          "text": "我来帮你查询一下。"
        },
        {
          "type": "tool_use",
          "id": "toolu_01A09q90qw90lq917835uuxy",
          "name": "get_weather",
          "input": {"city": "北京"}
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01A09q90qw90lq917835uuxy",
          "content": "北京今天晴，气温25°C，微风。"
        }
      ]
    }
  ]
}
```

---

## 二、非流式出参格式（Response）

### 2.1 基础结构

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "content": [...],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 200,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

| 字段 | 说明 |
|------|------|
| `id` | 消息唯一 ID，格式为 `msg_xxx` |
| `type` | 固定为 `"message"` |
| `role` | 固定为 `"assistant"` |
| `model` | 实际使用的模型名 |
| `stop_reason` | 停止原因，见下表 |
| `stop_sequence` | 触发停止的序列，通常为 null |
| `content` | 内容块数组 |
| `usage` | Token 使用统计 |

**stop_reason 取值：**

| 值 | 含义 |
|----|------|
| `end_turn` | 模型正常结束 |
| `max_tokens` | 达到 max_tokens 限制 |
| `tool_use` | 模型调用了工具，等待结果 |
| `stop_sequence` | 触发了自定义停止序列 |

---

### 2.2 纯文本响应

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "content": [
    {
      "type": "text",
      "text": "北京今天天气晴好，气温约25°C，适合外出。"
    }
  ],
  "usage": {
    "input_tokens": 25,
    "output_tokens": 20
  }
}
```

---

### 2.3 含思考过程的响应

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "content": [
    {
      "type": "thinking",
      "thinking": "用户问的是北京天气，工具返回了晴天25°C的结果，我来整理一下回答..."
    },
    {
      "type": "text",
      "text": "北京今天天气晴好，气温约25°C，微风，非常适合外出活动。"
    }
  ],
  "usage": {
    "input_tokens": 150,
    "output_tokens": 300
  }
}
```

---

### 2.4 工具调用响应

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "content": [
    {
      "type": "thinking",
      "thinking": "需要调用 get_weather 工具来获取北京天气。"
    },
    {
      "type": "text",
      "text": "我来帮你查询北京的天气。"
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835uuxy",
      "name": "get_weather",
      "input": {
        "city": "北京"
      }
    }
  ],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 80
  }
}
```

---

## 三、流式出参格式（Streaming Response）

流式响应基于 **Server-Sent Events (SSE)** 协议，每个事件格式为：

```
event: <事件类型>
data: <JSON 数据>

```

### 3.1 事件序列总览

```
message_start          ← 消息开始（携带基础信息）
  content_block_start  ← 内容块开始（thinking/text/tool_use）
    content_block_delta  ← 内容增量（可多次）
  content_block_stop   ← 内容块结束
  content_block_start  ← 下一个内容块开始（如有）
    content_block_delta
  content_block_stop
message_delta          ← 消息元数据更新（stop_reason/usage）
message_stop           ← 消息结束
```

---

### 3.2 message_start

```
event: message_start
data: {
  "type": "message_start",
  "message": {
    "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-4-6",
    "content": [],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 150,
      "output_tokens": 0
    }
  }
}
```

---

### 3.3 thinking 内容块的流式事件

**content_block_start（index=0，首个 thinking 块）：**

```
event: content_block_start
data: {
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "thinking",
    "thinking": ""
  }
}
```

**content_block_delta（thinking 增量）：**

```
event: content_block_delta
data: {
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "thinking_delta",
    "thinking": "让我分析一下这个问题..."
  }
}
```

**content_block_stop：**

```
event: content_block_stop
data: {
  "type": "content_block_stop",
  "index": 0
}
```

---

### 3.4 text 内容块的流式事件

**content_block_start（index=1）：**

```
event: content_block_start
data: {
  "type": "content_block_start",
  "index": 1,
  "content_block": {
    "type": "text",
    "text": ""
  }
}
```

**content_block_delta（文本增量）：**

```
event: content_block_delta
data: {
  "type": "content_block_delta",
  "index": 1,
  "delta": {
    "type": "text_delta",
    "text": "北京今天天气晴好"
  }
}
```

**content_block_stop：**

```
event: content_block_stop
data: {
  "type": "content_block_stop",
  "index": 1
}
```

---

### 3.5 tool_use 内容块的流式事件

**content_block_start（index=2）：**

```
event: content_block_start
data: {
  "type": "content_block_start",
  "index": 2,
  "content_block": {
    "type": "tool_use",
    "id": "toolu_01A09q90qw90lq917835uuxy",
    "name": "get_weather",
    "input": {}
  }
}
```

**content_block_delta（工具参数 JSON 增量）：**

```
event: content_block_delta
data: {
  "type": "content_block_delta",
  "index": 2,
  "delta": {
    "type": "input_json_delta",
    "partial_json": "{\"city\""
  }
}
```

```
event: content_block_delta
data: {
  "type": "content_block_delta",
  "index": 2,
  "delta": {
    "type": "input_json_delta",
    "partial_json": ": \"北京\"}"
  }
}
```

**content_block_stop：**

```
event: content_block_stop
data: {
  "type": "content_block_stop",
  "index": 2
}
```

---

### 3.6 message_delta

```
event: message_delta
data: {
  "type": "message_delta",
  "delta": {
    "stop_reason": "tool_use",
    "stop_sequence": null
  },
  "usage": {
    "output_tokens": 120
  }
}
```

---

### 3.7 message_stop

```
event: message_stop
data: {
  "type": "message_stop"
}
```

---

### 3.8 完整流式响应示例（含 thinking + text + tool_use）

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":150,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"用户想知道北京天气，需要调用工具获取。"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"我来帮你查询一下。"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_01A09q90qw90lq917835uuxy","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"city\": \"北京\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":80}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 四、delta 类型汇总

| delta.type | 所属内容块 | 携带字段 | 说明 |
|-----------|-----------|---------|------|
| `thinking_delta` | thinking | `thinking` | 思考过程增量 |
| `text_delta` | text | `text` | 文本增量 |
| `input_json_delta` | tool_use | `partial_json` | 工具参数 JSON 增量（需拼接） |

---

## 五、content_block_start 中各类型的初始值

| 类型 | 初始结构 |
|------|---------|
| `text` | `{"type": "text", "text": ""}` |
| `thinking` | `{"type": "thinking", "thinking": ""}` |
| `tool_use` | `{"type": "tool_use", "id": "...", "name": "...", "input": {}}` |

> **注意**：tool_use 的 `input` 在流式中始终为空对象 `{}`，完整 JSON 通过 `input_json_delta` 的 `partial_json` 字段逐步拼接而来。
