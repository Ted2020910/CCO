import express from 'express';
export function createServer(port) {
    const app = express();
    // 解析 JSON 请求体
    app.use(express.json());
    // 测试路由
    app.get('/', (req, res) => {
        res.json({ message: 'CCO Server Running' });
    });
    // 启动服务器
    const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
    return server;
}
