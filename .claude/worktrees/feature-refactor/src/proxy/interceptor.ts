import type { Request, Response } from 'express';
import { generateId, todayString } from '../shared/utils.js';
import { calculateCost } from '../shared/pricing.js';
import { saveRecord } from '../storage/sessions.js';
import type { RequestRecord, TokenUsage } from '../shared/types.js';

/**
 * 拦截请求：创建初始记录 → 转发 → 合并响应 → 计算费用 → 持久化
 */
export async function interceptRequest(
  req: Request,
  res: Response,
  sessionId: string,
  targetUrl: string,
): Promise<void> {
  const id        = generateId();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // 解析目标 endpoint（去掉 baseUrl 前缀）
  const endpoint = targetUrl.replace('https://api.anthropic.com/', '');
  const model: string = req.body?.model ?? 'unknown';

  // ── 创建 pending 记录 ──────────────────────────────────────────────────────
  const record: RequestRecord = {
    id,
    sessionId,
    timestamp,
    model,
    endpoint,
    request: req.body ?? {},
    status: 'pending',
  };
  saveRecord(record);

  // ── 构造转发请求头 ─────────────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01',
  };
  if (req.headers['authorization']) {
    headers['authorization'] = req.headers['authorization'] as string;
  }
  if (req.headers['x-api-key']) {
    headers['x-api-key'] = req.headers['x-api-key'] as string;
  }
  // 透传缓存控制头
  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'] as string;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method:  'POST',
      headers,
      body:    JSON.stringify(req.body),
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      // 跳过 content-encoding（fetch 已解压）
      if (key.toLowerCase() !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });

    if (contentType.includes('text/event-stream')) {
      // ── 流式响应 ────────────────────────────────────────────────────────────
      await handleStreamResponse(upstream, res, record, startTime);
    } else {
      // ── 普通 JSON 响应 ───────────────────────────────────────────────────────
      await handleJsonResponse(upstream, res, record, startTime);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    record.status    = 'error';
    record.error     = error;
    record.duration_ms = Date.now() - startTime;
    saveRecord(record);

    if (!res.headersSent) {
      res.status(502).json({ error: 'Upstream request failed', detail: error });
    }
  }
}

// ─── 流式响应处理 ─────────────────────────────────────────────────────────────

async function handleStreamResponse(
  upstream: globalThis.Response,
  res: Response,
  record: RequestRecord,
  startTime: number,
): Promise<void> {
  if (!upstream.body) throw new Error('No response body for streaming');

  const reader  = upstream.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      chunks.push(chunk);
      res.write(chunk);
    }
    res.end();
  } finally {
    // 解析 SSE 并提取 usage
    const fullText = chunks.join('');
    const { response, usage } = parseSSEResponse(fullText);

    record.response    = response;
    record.usage       = usage;
    record.status      = upstream.ok ? 'completed' : 'error';
    record.duration_ms = Date.now() - startTime;
    if (usage) record.cost = calculateCost(record.model, usage);

    saveRecord(record);
  }
}

// ─── 非流式响应处理 ───────────────────────────────────────────────────────────

async function handleJsonResponse(
  upstream: globalThis.Response,
  res: Response,
  record: RequestRecord,
  startTime: number,
): Promise<void> {
  const data = await upstream.json() as Record<string, unknown>;
  res.json(data);

  const usage = data['usage'] as TokenUsage | undefined;
  record.response    = data;
  record.usage       = usage;
  record.status      = upstream.ok ? 'completed' : 'error';
  record.duration_ms = Date.now() - startTime;
  if (usage) record.cost = calculateCost(record.model, usage);

  saveRecord(record);
}

// ─── SSE 解析 ─────────────────────────────────────────────────────────────────

interface ParsedSSE {
  response: Record<string, unknown>;
  usage?: TokenUsage;
}

function parseSSEResponse(raw: string): ParsedSSE {
  const lines  = raw.split('\n');
  const events: Record<string, unknown>[] = [];

  for (const line of lines) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch { /* ignore malformed */ }
  }

  // 在事件中找 message_stop（携带最终 usage）
  const stopEvent = events.find(e => e['type'] === 'message_stop');
  const usageData = (stopEvent?.['usage'] ?? events
    .find(e => e['type'] === 'message_delta')?.['usage']) as TokenUsage | undefined;

  // 提取文本内容
  const contentBlocks: Record<string, unknown>[] = [];
  for (const evt of events) {
    if (evt['type'] === 'content_block_start') {
      contentBlocks.push(evt['content_block'] as Record<string, unknown>);
    }
    if (evt['type'] === 'content_block_delta') {
      const last = contentBlocks[contentBlocks.length - 1];
      if (last && (evt['delta'] as Record<string, unknown>)?.['type'] === 'text_delta') {
        last['text'] = ((last['text'] as string) ?? '') +
          ((evt['delta'] as Record<string, unknown>)?.['text'] as string ?? '');
      }
    }
  }

  // 提取 message_start 的基础信息
  const msgStart = events.find(e => e['type'] === 'message_start');
  const message  = (msgStart?.['message'] ?? {}) as Record<string, unknown>;

  return {
    response: { ...message, content: contentBlocks },
    usage: usageData,
  };
}
