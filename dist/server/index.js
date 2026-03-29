import express from 'express';
import { proxyRequest } from './proxy.js';
export function createServer(port) {
    const app = express();
    app.use(express.json());
    // 测试路由
    app.get('/', (req, res) => {
        res.json({ message: 'CCO Server Running' });
    });
    // 代理路由 - 使用中间件方式避开通配符问题
    app.use('/proxy/:uuid', async (req, res, next) => {
        if (req.method !== 'POST') {
            return next();
        }
        const { uuid } = req.params;
        // req.path 是 /proxy/:uuid 之后的路径
        const apiPath = req.path.startsWith('/') ? req.path.slice(1) : req.path;
        const targetUrl = `https://api.anthropic.com/${apiPath}`;
        console.log(`[Proxy] ${uuid} -> ${targetUrl}`);
        try {
            await proxyRequest(req, res, targetUrl);
        }
        catch (error) {
            console.error('[Proxy Error]', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Proxy failed' });
            }
        }
    });
    const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
    return server;
}
