# CCO Compression Flow - Analysis

## QUESTION 1: Session Interface and Compression State

### Session Interface (src/shared/types.ts, 81-88)
- session_id: string
- session_name: string (max 10 chars from first user message)
- main_agent: MainAgent
- created_at: string (ISO 8601)
- updated_at: string (ISO 8601)  
- stats: SessionStats

NO compression_state field on Session itself.

### MainAgent (src/shared/types.ts, 58-61)
- session_history_list: SessionHistoryEntry[] (THIS is where compression archives go)
- sub_agents: SubAgent[]
- Plus AgentBase fields

### SessionHistoryEntry (src/shared/types.ts, 63-67)
- sys_prompt: unknown (old prompt)
- messages: AnthropicMessage[] (old messages)
- archived_at: string (ISO 8601 timestamp)

Used to archive old context during compression.

### ClassificationType (src/shared/types.ts, 145-151)
'main_agent' | 'compression' | 'suggestion' | 'sub_agent_new' | 'sub_agent_continue' | 'unclassified'

### Classification Interface (src/shared/types.ts, 153-158)
- type: ClassificationType
- agent?: AgentBase (the matched agent for continue scenarios)
- parentAgent?: AgentBase (for sub_agent_new)
- toolCallId?: string (for sub_agent_new)

When type='compression', agent is set to session.main_agent.

---

## QUESTION 2: Compression Classification (Step 2)

### Detection Location (src/session/classifier.ts, 62-71)

```
if (lastMessage) {
  const lastText = getFullMessageText(lastMessage);

  if (lastText.includes('[SUGGESTION MODE: Suggest what the user might naturally type next')) {
    return { type: 'suggestion' };
  }

  if (lastText.includes('Your task is to create a detailed summary of the conversation so far')) {
    return { type: 'compression', agent: session.main_agent };
  }
}
```

**HOW IT WORKS**:
1. Gets the last message from request
2. Extracts all text from it
3. Checks if it contains the compression prompt string
4. Returns Classification with type='compression' and agent=session.main_agent

This happens BEFORE step 3 (agent matching), so compression bypasses normal agent matching.

### Classification Interface
When compression is detected:
```
{
  type: 'compression',
  agent: session.main_agent
}
```

---

## QUESTION 3: How processResponseClassification Handles Compression

### Location (src/proxy/interceptor.ts, 324-386)

For compression type responses:

1. **Line 337-339**: Stats updated
   - if (type !== 'suggestion' && type !== 'unclassified')
   - Since type='compression', this is TRUE
   - sessionManager.updateStats(session, model) is called
   - total_requests++, models_used[model]++

2. **Line 342**: Timestamp updated
   - sessionManager.touch(session)
   - session.updated_at = now

3. **Line 346-351**: Message appending
   - Condition: if (activeAgent && responseContent.length > 0 && type !== 'suggestion' && type !== 'unclassified')
   - type='compression' passes the check
   - BUT activeAgent is NULL (never set for compression in processRequestClassification)
   - So this block is skipped!

4. **Line 353-377**: Tool use handling
   - Skipped because activeAgent is null

5. **Line 381-385**: Session persisted to disk
   - saveSession(session) is called

### What Data is Available

responseContent: AnthropicContentBlock[]
- For compression, expects: [{ type: 'text', text: '<analysis>...<summary>...</summary>' }]
- compression prompt says "Do NOT use any tools", so no tool_use blocks

The full summary (with <analysis> and <summary> tags) is in responseContent[0].text

---

## QUESTION 4: What Does handleCompression Do?

### Function (src/session/manager.ts, 227-246)

```
handleCompression(mainAgent: MainAgent, newSysPrompt: unknown): void {
  // Archive current (sys_prompt, messages)
  const archiveEntry: SessionHistoryEntry = {
    sys_prompt: mainAgent.current_sys_prompt,
    messages: [...mainAgent.current_messages],
    archived_at: new Date().toISOString(),
  };
  mainAgent.session_history_list.push(archiveEntry);

  // Update system prompt
  mainAgent.current_sys_prompt = newSysPrompt;

  // Clear current messages
  mainAgent.current_messages = [];
}
```

**WHAT IT DOES**:
1. Creates SessionHistoryEntry with old prompt + messages
2. Pushes to session_history_list (archiving)
3. Updates current_sys_prompt to newSysPrompt (compressed version)
4. Clears current_messages to empty array

### Is It Ever Called?

NO. It's dead code.

Searched the entire codebase:
- interceptor.ts: Does not call handleCompression()
- No other file calls it
- Never invoked

This is explicitly documented in docs/claude code 场景分析.md line 277:
"| handleCompression() | manager.ts | 已定义但从未被 interceptor 调用，压缩归档流程未生效 |"

Translation: "Defined but never called by interceptor, compression archival flow not implemented"

---

## QUESTION 5: SSE Response Parser and Summary Text

### parseSSEResponse() (src/proxy/interceptor.ts, 490-571)

For compression responses (streaming SSE):

1. Parse SSE events from raw stream
2. Build blockMap from content_block_start events
3. Accumulate text deltas:
   ```
   if (deltaType === 'text_delta' && block.type === 'text') {
     block.text = (block.text ?? '') + (delta['text'] as string ?? '');
   }
   ```
4. On content_block_stop, push block to contentBlocks
5. Return contentBlocks array

### For Compression Specifically

- Single content block of type 'text'
- text field contains full summary including <analysis> and <summary> tags
- Each SSE delta is concatenated into one block

Result:
```
contentBlocks: [
  {
    type: 'text',
    text: '<analysis>\n... full analysis ...\n</analysis>\n\n<summary>\n... full summary ...\n</summary>'
  }
]
```

### Will Summary be in contentBlocks as Text Block?

YES. Single text block containing the entire summary.

Compression prompt says: "Do NOT use any tools. You MUST respond with ONLY the <summary>...</summary> block"

So no tool_use blocks, just text.

---

## QUESTION 6: Other References to Compression/Compact/Summary

### Found In:

1. src/shared/types.ts
   - Line 59: session_history_list: SessionHistoryEntry[]
   - Line 105: compression_count?: number; (in SessionSummary)

2. src/session/classifier.ts
   - Line 33 comment: "压缩指令 → compression"
   - Lines 69-71: Detection logic

3. src/proxy/interceptor.ts
   - Used by compression detection in classification

4. src/session/manager.ts
   - Lines 227-246: handleCompression() function
   - Line 227 comment: "// ── 上下文压缩 ──"

5. src/api/routes.ts
   - Line 129: compression_count: session.main_agent.session_history_list.length,

6. dashboard/src/types/index.ts
   - Line 85: compression_count?: number;

7. docs/claude code 场景分析.md
   - Lines 31-37: Compression flow spec
   - Line 277: TODO item

8. docs/claude code逆向结果/压缩上下文的提示词.md
   - Full compression prompt text

---

## KEY FINDINGS SUMMARY

1. **Session has NO compression state field** - uses session_history_list indirectly

2. **Compression Classification works** - detects "Your task is to create a detailed summary..." prompt

3. **responseProcessing happens but incomplete**:
   - Stats are updated
   - Timestamp updated
   - Session persisted
   - BUT summary NOT appended to messages (activeAgent=null)
   - AND handleCompression() never called

4. **Summary IS in contentBlocks as text block** - YES, single text block with <analysis> and <summary> tags

5. **handleCompression() is dead code** - defined but never called

6. **8 files mention compression** - but mostly type definitions and one dead function

The flow is: Request detected -> Response parsed -> Stats updated -> Saved
But NOT: Archive old state -> Update prompt -> Clear messages
