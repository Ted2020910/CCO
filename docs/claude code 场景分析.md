# Claude Code 请求分类决策树

核心原则：**分类是有状态的**，需要追踪 session 的请求上下文，不能仅凭单个请求的静态特征判断。

关键设计：Claude Code 每次请求都携带**完整消息历史**，因此 CCO 采用**全量同步**策略而非增量追加。

---

## 决策树

```
收到请求 (session_id, system, messages, tools)

Step 1: 先检测特殊请求（不依赖 session 是否存在）

前提条件（全部满足才进入 Step 1 检测）：
  a. tools 不为空（真正的压缩请求一定携带 tools，
     没有 tools 的辅助请求如命名、count_tokens 会碰巧携带相同消息历史）
  b. session 未处于压缩恢复等待状态（pending_compression_summary !== true）
     原因：压缩后 CC 发送的恢复请求中，最后一条 user message 可能回显压缩指令文本，
     如果不守卫会导致同一 session 连续触发两次压缩

检查 messages 最后一条消息（必须是 role === 'user'）的 **text block**（不含 tool_result）：
注意：只检查 text 类型的 block，不检查 tool_result，
否则读取包含压缩关键词的文件内容会导致误判。

├─ 包含 "Your task is to create a detailed summary of the conversation so far"
│   → 【上下文压缩】
│   → 请求阶段：
│     • session 已存在：不做额外操作（响应阶段处理）
│     • session 不存在（CCO 中途启动）：先创建 session，
│       用 messages[:-1]（压缩前的历史）初始化 current_messages + tool map + backfill
│   → 响应阶段：
│     1. 归档 (current_sys_prompt, current_messages, sub_agents, tools_call_result_map)
│        到 session_history_list
│     2. 清空主智能体全部当前状态：
│        current_sys_prompt = null, current_messages = [],
│        sub_agents = [], tools_call_result_map = {}
│     3. 设置恢复标记 session.pending_compression_summary = true
│     4. 持久化
│
└─ 其他（包括 SUGGESTION MODE）→ Step 2
   （suggestion 不再特殊处理，走正常分类流程，由全量同步保证下次请求覆盖）


Step 2: session 是否已存在？

├─ 不存在
│   ├─ 有 tools → 【新 session】创建 Session + Main_agent
│   └─ 无 tools → 【未分类】忽略
│
└─ 已存在 → Step 3


Step 3: tools 为空？

└─ tools 为空 → 非主智能体类辅助请求（命名等），忽略


Step 3.5: 压缩恢复状态？（仅当 session.pending_compression_summary === true 时）

├─ pending_compression_summary 为 true
│   → 【压缩恢复】分类为 main_agent
│   → 请求阶段：
│     1. 更新 main_agent.current_sys_prompt 为新的 system（压缩后 CC 会注入含摘要的新 sys_prompt）
│     2. 清除 session.pending_compression_summary 标记
│     3. 全量覆盖 messages + 重建 tool map + 补建子智能体（同正常主智能体）
│   → 响应阶段：同主智能体正常对话
│
└─ 不存在标记 → Step 4


Step 4: (sys_prompt, 第1条message（去除cache字段）) 匹配已有 agent？

├─ 匹配主智能体 → 【主智能体正常对话】
│   → 请求阶段：
│     1. 用请求中的 messages 全量覆盖 current_messages（去除 cache_control）
│     2. syncToolCallMap() 从完整 messages 全量重建 tools_call_result_map
│     3. backfillSubAgents() 为历史 Agent 调用补建占位子智能体
│   → 响应阶段：
│     1. 追加 assistant message 到 current_messages（临时，下次请求会全量覆盖）
│     2. 将响应中的 tool_use blocks 立即写入 tools_call_result_map
│        （确保子智能体请求到达时能在 Step 5 找到 pending 的 Agent 条目）
│     3. 对 Agent 工具调用，立即创建占位 SubAgent（有 prompt，messages 为空）
│     4. 持久化 Session 到磁盘
│
├─ 匹配某个子智能体 → 【子智能体继续对话】
│   → 处理逻辑同主智能体（全量覆盖 messages → 重建 tool map → 补建子智能体）
│
└─ 未匹配 → Step 5


Step 5: 是否存在未完成的 Agent 工具调用？

遍历 session 中所有 agent（主 + 子）的 tools_call_result_map，
查找满足以下条件的条目：
  a. tool_name == "Agent"
  b. is_finished == false
  c. arguments.prompt 是当前请求中首条 user message 文本内容的子串
     （通过 getFirstUserMessageText() 提取，即找到第一条 role==='user' 的消息）

├─ 找到匹配 → 【新子智能体】
│   → 先查找响应阶段已创建的占位 SubAgent（按 agent_id = tool_call_id 匹配）
│   → 如果找到占位节点 → 填充（更新 sys_prompt、tools，messages 全量覆盖）
│   → 如果没找到 → 创建新 SubAgent 挂载到父 agent（兼容 CCO 中途启动）
│   → 请求阶段：全量覆盖 messages + 重建 tool map
│   → 响应阶段：同主智能体
│
└─ 未找到 → 【未分类】不创建子智能体，忽略
```

---

## 数据更新策略

### 请求阶段：全量同步

Claude Code 每次请求的 `messages` 字段包含**完整对话历史**，因此 CCO 不做增量追加，
而是每次请求时：

1. **全量覆盖 current_messages**：`agent.current_messages = cleanMessages`
   - `cleanMessages` = 请求 messages 去除所有 `cache_control` 字段后的副本
   - 同时记录 `agent._synced_message_count = cleanMessages.length`
     （HEAD_MATCH 只比较这么多条，忽略响应阶段 append 的 assistant）
2. **全量重建 tools_call_result_map**：`syncToolCallMap(agent, cleanMessages)`
   - 第一遍扫描所有 assistant 消息中的 `tool_use` blocks → 建立条目（is_finished: false）
   - 第二遍扫描所有 user 消息中的 `tool_result` blocks → 匹配并标记完成
   - 直接替换整个 map，不做增量合并
   - 重建后同步子智能体完成状态：扫描 `tool_name === 'Agent'` 且 `is_finished === true` 的条目，
     调用 `markSubAgentFinished()` 更新对应 SubAgent 的 `is_finished`
3. **补建历史子智能体**：`backfillSubAgents(agent)`
   - 扫描 `tools_call_result_map` 中所有 `tool_name === 'Agent'` 的条目
   - 如果 `sub_agents` 中没有对应 `agent_id` 的节点，创建占位 SubAgent
   - 占位 SubAgent 的 `agent_id` = tool_call_id（与正常创建的子智能体一致）
   - 填充 `prompt`（从 arguments 提取）和 `is_finished`（从 ToolCallEntry 同步）
   - 用途：应对 CCO 中途启动，历史 Agent 调用没有被实时追踪的情况

### 响应阶段：临时追加 + 占位创建 + 压缩归档 + 持久化

**普通对话（main_agent / sub_agent）：**

1. **追加 assistant message**：将本轮响应追加到 `current_messages` 末尾
   - 目的：在下一次请求到来前，dashboard 能查看到最新的完整对话
   - 下一次请求到来时会被全量覆盖，不会产生重复
2. **立即记录 tool_use**：将响应中的 `tool_use` blocks 写入 `tools_call_result_map`
   - 目的：子智能体的请求可能在下一次主请求之前到达，需要能在 Step 4 找到 pending 条目
   - 下次 `syncToolCallMap()` 全量重建时会覆盖
3. **立即创建占位子智能体**：对于 `name === 'Agent'` 的 tool_use，立即创建占位 SubAgent
   - 占位节点有 `prompt`（从 Agent 工具参数提取），`agent_id` = tool_call_id
   - `current_messages` 为空、`tools` 为空、`current_sys_prompt` 为 null、`is_finished` 为 false
   - 目的：Dashboard 能第一时间看到子智能体节点，无需等待子智能体首次请求

**压缩响应（compression）：**

4. **归档当前状态**：将 `(current_sys_prompt, current_messages, sub_agents, tools_call_result_map)` 存入 `session_history_list`
5. **清空主智能体全部当前状态**：
   - `current_sys_prompt = null`（压缩后 CC 会发送全新的 sys_prompt，旧的无法匹配）
   - `current_messages = []`
   - `sub_agents = []`
   - `tools_call_result_map = {}`
6. **设置恢复标记**：`session.pending_compression_summary = true`
   - 下一个请求到达时，分类器 Step 3.5 检测到此标记，直接分类为 main_agent

**所有类型（除 unclassified）：**

7. **更新 stats**：`total_requests++`，`models_used[model]++`
8. **更新 timestamp**：`session.updated_at = now`
9. **持久化**：`saveSession(session)` 同步写入 `~/.cco/sessions/{id}.json`

---

## 数据模型

```typescript
interface Session {
  session_id: string;
  session_name: string;         // 首条 user message 最后一个 text block，截断为最多 10 个字符
  main_agent: MainAgent;
  created_at: string;
  updated_at: string;
  stats: SessionStats;
  pending_compression_summary?: boolean;  // 压缩后待恢复标记（true 表示下一个请求应恢复为主智能体）
}

interface SessionStats {
  total_requests: number;
  models_used: Record<string, number>;
}

interface MainAgent extends AgentBase {
  session_history_list: SessionHistoryEntry[];  // 压缩归档
  sub_agents: SubAgent[];
}

interface SubAgent extends AgentBase {
  // agent_id 直接使用父 agent 的 tool_call_id（tools_call_result_map 的 key）
  // 这样 tool_result.tool_use_id === sub_agent.agent_id，天然关联
  prompt: string;               // Agent 工具调用的 prompt 参数，用于身份辨识
  is_finished: boolean;         // 该子智能体是否已完成任务（由父 agent 的 tool_result 驱动）
  sub_agents: SubAgent[];       // general-purpose 子智能体可再调 Agent
}

interface AgentBase {
  agent_id: string;
  current_sys_prompt: unknown;
  current_messages: AnthropicMessage[];
  tools: unknown[];
  tools_call_result_map: Record<string, ToolCallEntry>;
  _synced_message_count?: number;   // 全量同步时的消息数量，HEAD_MATCH 只比较这么多条
                                     // 避免 SSE 重建的 assistant 与 CC 发送版本不一致导致匹配失败
}

interface ToolCallEntry {
  tool_name: string;
  arguments: Record<string, unknown>;
  is_finished: boolean;
  result: unknown;
}
```

---

## Agent 匹配算法

### HEAD_MATCH 策略

比较 `sys_prompt` + **第 1 条消息**（`HEAD_MATCH_COUNT = 1`）即可唯一确定 agent。

**关键**：比较时只使用 `_synced_message_count` 条消息（全量同步时的数量），
忽略响应阶段 append 的 assistant 消息。因为 SSE 重建的 assistant 消息可能与
CC 下次发送的版本不一致（thinking block 的 signature、JSON key 顺序等差异）。

```
matchesAgent(agent, sysPrompt, messageHistory):
  1. deepEqualIgnoreCache(agent.current_sys_prompt, sysPrompt) 必须为 true
  2. syncedLen = agent._synced_message_count ?? stored.length
  3. 如果双方 messages 都为空 → 匹配（新建 session 首次请求）
  4. 如果一方为空一方不为空 → 仍然匹配（agent 刚创建或压缩后清空了）
  5. 比较 min(syncedLen, incomingLen, 1) 条消息，deepEqualIgnoreCache
```

设计考量：
- sys_prompt 区分主智能体与各子智能体（CC 为每个 agent 生成独立 system）
- 第 1 条消息是对话的起始"指纹"，整个会话生命周期内不变
- 比较更多消息反而引入风险（SSE 重建的 assistant 可能与 CC 版本不一致）

### deepEqualIgnoreCache

Claude Code 会动态给消息 block 加 `cache_control` 字段，同一条消息在不同请求中位置不同，
所以比较时通过 JSON.stringify 的 replacer 忽略 `cache_control`。

---

## 子智能体关联示例

主智能体响应中包含 Agent 工具调用：
```json
{
  "type": "tool_use",
  "id": "toolu_abc123",
  "name": "Agent",
  "input": {
    "description": "搜索代码库",
    "prompt": "请详细分析和说明：如何配置自定义 Agent",
    "subagent_type": "claude-code-guide"
  }
}
```

响应阶段立即写入 tools_call_result_map：
```json
{
  "toolu_abc123": {
    "tool_name": "Agent",
    "arguments": {
      "prompt": "请详细分析和说明：如何配置自定义 Agent",
      "subagent_type": "claude-code-guide"
    },
    "is_finished": false,
    "result": null
  }
}
```

随后收到一个新请求，sys_prompt + messages[:-1] 不匹配任何已有 agent：
```json
{
  "role": "user",
  "content": "<system-reminder>...注入内容...</system-reminder>\n\n请详细分析和说明：如何配置自定义 Agent..."
}
```

匹配逻辑（Step 4）：
```
getFirstUserMessageText(messages) → 提取首条 user 消息的完整文本

遍历所有 agent 的 tools_call_result_map:
  "toolu_abc123".tool_name == "Agent"       ✓
  "toolu_abc123".is_finished == false        ✓
  firstUserMessageText.includes(
    "toolu_abc123".arguments.prompt          ✓
  )
  ("请详细分析和说明..." 是 user content 的子串)

→ 匹配成功，创建 Sub_agent
  agent_id = "toolu_abc123"（直接使用 tool_call_id）
```

---

## 场景汇总

| 场景 | 判定条件 | 请求阶段 | 响应阶段 |
|------|---------|---------|---------|
| 新 session 首次请求 | session 不存在 + 有 tools | 创建 Session + MainAgent，全量同步 messages 和 tool map | 追加 assistant msg，记录 tool_use，持久化 |
| 建议下一步（suggestion） | 最后消息含 `[SUGGESTION MODE...]`，但不特殊处理 | 走正常分类流程（通常匹配主智能体），全量同步 | 同主智能体正常对话（下次请求全量覆盖） |
| 上下文压缩（session 已存在） | 最后消息含压缩指令 + 有 tools + 非压缩恢复等待状态 | 不做额外操作 | 归档全部状态 → 清空 sys_prompt/messages/sub_agents/tool_map → 设置 pending_compression_summary = true |
| 上下文压缩（CCO 中途启动） | 最后消息含压缩指令 + 有 tools + session 不存在 | 创建 session，用 messages[:-1] 初始化历史 + tool map + backfill | 同上 |
| 压缩恢复 | pending_compression_summary === true | 更新 sys_prompt + 清除 pending 标记 + 全量同步 | 同主智能体正常对话 |
| 辅助请求（命名等） | tools 为空 | 忽略 | — |
| 主智能体正常对话 | sys_prompt + messages[:-1] 匹配主智能体 | 全量覆盖 messages，重建 tool map，补建子智能体 | 追加 assistant msg，记录 tool_use，持久化 |
| 子智能体(继续) | sys_prompt + messages[:-1] 匹配已有子智能体 | 同主智能体 | 同主智能体 |
| 子智能体(新) | 不匹配 + 存在 pending Agent 调用 + prompt 匹配 | 查找已有占位节点并填充，或创建新 SubAgent，全量同步 | 同主智能体 |
| 未分类 | 以上均不满足 | 忽略 | — |

---

## 已知待实现 / 死代码

（当前无死代码）
