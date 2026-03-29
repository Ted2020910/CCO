export async function proxyRequest(req, res, targetUrl) {
    try {
        const requestBody = req.body;
        const headers = {};
        if (req.headers.authorization) {
            headers['authorization'] = req.headers.authorization;
        }
        headers['content-type'] = 'application/json';
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });
        // 复制响应头
        const contentType = response.headers.get('content-type') || '';
        res.status(response.status);
        response.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        // 处理流式响应
        if (contentType.includes('text/event-stream')) {
            if (!response.body) {
                throw new Error('No response body');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        }
        else {
            // 处理普通 JSON 响应
            const data = await response.json();
            res.json(data);
        }
    }
    catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy error' });
        }
    }
}
