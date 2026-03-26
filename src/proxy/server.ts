import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { interceptRequest } from './interceptor.js';
import { createApiRouter } from '../api/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(port: number): ReturnType<typeof express.application.listen> {
  const app = express();

  // ── 基础中间件 ───────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '50mb' }));

  // ── 健康检查 ─────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', port });
  });

  // ── REST API（给 Dashboard 用） ───────────────────────────────────────────────
  app.use('/api', createApiRouter());

  // ── 代理路由：/proxy/:sessionId/* ────────────────────────────────────────────
  // 使用 express.Router 挂载通配路由，避免 Express 5 通配符问题
  const proxyRouter = express.Router();

  proxyRouter.post('/:sessionId/*', async (req, res) => {
    const { sessionId } = req.params;

    // 获取 :sessionId 之后的路径部分
    const afterSessionId = (req.params as unknown as Record<string, string | string[]>)[0] ?? '';
    const rawPath = afterSessionId;
    const apiPath = (Array.isArray(rawPath) ? rawPath[0] : rawPath) ?? '';
    const cleanPath = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath;

    const targetUrl = `https://api.anthropic.com/${cleanPath}`;

    console.log(`[CCO] ${new Date().toISOString()} | session=${sessionId.slice(0, 8)}... | ${cleanPath}`);

    await interceptRequest(req, res, sessionId, targetUrl);
  });

  app.use('/proxy', proxyRouter);

  // ── 托管 React Dashboard 静态文件 ────────────────────────────────────────────
  const dashboardDist = path.join(__dirname, '../../dashboard/dist');
  app.use(express.static(dashboardDist));

  // SPA fallback：所有未匹配路由返回 index.html
  app.get('*', (_req, res) => {
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
