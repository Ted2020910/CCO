import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { interceptRequest, setSessionManager } from './interceptor.js';
import { createApiRouter } from '../api/routes.js';
import { SessionManager } from '../session/index.js';
import { loadAllSessions } from '../storage/session-store.js';
import { readConfig } from '../storage/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(port: number): ReturnType<typeof express.application.listen> {
  const app = express();

  // ── 创建 SessionManager 并注入到 Interceptor ────────────────────────────────
  const sessionManager = new SessionManager();

  // 从持久化文件加载已有 Sessions
  try {
    const sessions = loadAllSessions();
    for (const session of sessions) {
      sessionManager.loadSession(session);
    }
    if (sessions.length > 0) {
      console.log(`[CCO] Loaded ${sessions.length} sessions from disk`);
    }
  } catch (err) {
    console.error('[CCO] Failed to load sessions:', err);
  }

  setSessionManager(sessionManager);

  // ── 基础中间件 ───────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '50mb' }));

  // ── 健康检查 ─────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', port });
  });

  // ── REST API（给 Dashboard 用） ─────────────────────────────────────────────
  app.use('/api', createApiRouter(sessionManager));

  // ── 代理路由：/proxy/* ────────────────────────────────────────────────────
  const proxyRouter = express.Router();
  const config = readConfig();

  proxyRouter.post('{*path}', async (req, res) => {
    // 从 metadata 中提取 session_id
    let sessionId = 'unknown';
    try {
      const metadata = req.body?.metadata;
      if (metadata?.user_id) {
        const parsed = JSON.parse(metadata.user_id);
        sessionId = parsed.session_id || 'unknown';
      }
    } catch {
      // 如果解析失败，使用 unknown
    }

    const rawPath = (req.params as Record<string, unknown>).path;
    const apiPath = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath ?? '');
    const cleanPath = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath;

    const targetUrl = `${config.apiBaseUrl}/${cleanPath}`;

    console.log(`[CCO] ${new Date().toISOString()} | session=${sessionId.slice(0, 8)}... | ${cleanPath}`);

    await interceptRequest(req, res, sessionId, targetUrl);
  });

  app.use('/proxy', proxyRouter);

  // ── 托管 React Dashboard 静态文件 ──────────────────────────────────────────
  const dashboardDist = path.join(__dirname, '../../dashboard/dist');
  app.use(express.static(dashboardDist));

  // SPA fallback
  app.get('{*path}', (_req, res) => {
    const indexPath = path.join(dashboardDist, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(200).json({
          message: 'CCO Server Running',
          dashboard: `http://localhost:${port}`,
          proxy: `http://localhost:${port}/proxy/<session-id>`,
          api: `http://localhost:${port}/api`,
        });
      }
    });
  });

  const server = app.listen(port, () => {
    console.log(`\n🟢 CCO Server running:`);
    console.log(`   Dashboard : http://localhost:${port}`);
    console.log(`   API       : http://localhost:${port}/api`);
    console.log(`   Proxy URL : http://localhost:${port}/proxy/<session-id>\n`);
  });

  return server;
}
