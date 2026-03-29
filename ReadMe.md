# CCO - Claude Code Observer

CCO 是一个轻量级的本地代理服务，用于监控 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的 API 调用，实时追踪 Token 用量、会话结构和子智能体调用链。

## Features

- **透明代理** — 零侵入接入，Claude Code 无感知
- **会话追踪** — 自动识别主会话、子智能体、上下文压缩等请求类型
- **实时 Dashboard** — 可视化展示会话列表、对话历史、智能体调用树
- **本地存储** — 所有数据以 JSON 文件存储在本地，不上传任何信息
- **可配置** — 端口、API 地址、数据目录均可自定义

## Quick Start

### 1. 安装依赖

```bash
npm install
```

### 2. 构建项目

```bash
# 构建后端
npm run build

# 构建 Dashboard 前端
npm run build:dashboard

# 或一次性全部构建
npm run build:all
```

### 3. 启动服务

```bash
# 开发模式（直接运行 TypeScript）
npm run dev

# 生产模式（运行编译后的 JS）
npm start

# 或使用 CLI
cco init
```

### 4. 接入 Claude Code

在你的项目中创建或编辑 `.claude/settings.local.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:9527/proxy"
  }
}
```

然后正常使用 Claude Code 即可，所有请求会经过 CCO 代理转发。

## CLI Commands

```bash
cco init [options]    # 初始化并启动代理服务
cco status            # 查看服务运行状态
cco open              # 在浏览器中打开 Dashboard
```

### `cco init` Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | 指定服务端口 | `9527` |
| `-u, --url <url>` | 指定 Anthropic API 地址（支持中转） | `https://api.anthropic.com` |
| `-d, --data <path>` | 指定数据存储目录 | `./data`（项目根目录下） |

### Examples

```bash
# 默认配置启动
cco init

# 自定义端口
cco init -p 8080

# 使用 API 中转服务
cco init -u https://your-proxy.com

# 自定义数据存储位置
cco init -d /home/user/.cco-data

# 组合使用
cco init -p 8080 -u https://your-proxy.com -d ~/cco-data
```

## Configuration

配置文件保存在数据目录下的 `config.json`，首次启动时自动生成：

```json
{
  "version": "1.0.0",
  "port": 9527,
  "dataDir": "/path/to/data",
  "sessionsDir": "/path/to/data/sessions",
  "apiBaseUrl": "https://api.anthropic.com",
  "logLevel": "info"
}
```

### Data Directory

数据目录结构：

```
data/
  config.json          # 服务配置
  sessions/            # 会话数据
    {session_id}.json  # 每个会话一个 JSON 文件
```

默认存储在项目根目录的 `./data` 下，可通过 `-d` 参数自定义。

## Architecture

```
Claude Code  ──>  CCO Proxy (Express)  ──>  Anthropic API
                       │
                  ┌────┴────┐
                  │         │
             Classifier   Storage
             (分类引擎)   (JSON 持久化)
                  │
            SessionManager
            (内存会话管理)
                  │
              Dashboard
              (React SPA)
```

### Request Classification

CCO 自动识别以下请求类型：

| Type | Description |
|------|-------------|
| `main_agent` | 主会话请求 |
| `sub_agent_new` | 新建子智能体 |
| `sub_agent_continue` | 子智能体后续请求 |
| `compression` | 上下文压缩 |
| `unclassified` | 辅助请求（如 count_tokens、命名） |

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `http://localhost:9527` | Dashboard 页面 |
| `http://localhost:9527/api` | REST API（供 Dashboard 使用） |
| `http://localhost:9527/proxy/*` | 代理转发（Claude Code 请求入口） |
| `http://localhost:9527/health` | 健康检查 |

## Development

### Project Structure

```
src/
  cli/              # CLI 入口与命令
    index.ts        # Commander 注册
    commands/
      init.ts       # 初始化并启动服务
      status.ts     # 查看服务状态
      open.ts       # 打开 Dashboard
  proxy/
    server.ts       # Express 服务器
    interceptor.ts  # 请求/响应拦截
  session/
    manager.ts      # 内存会话管理
    classifier.ts   # 请求分类引擎
  storage/
    config.ts       # 配置读写
    session-store.ts # 会话持久化
  shared/
    types.ts        # 类型定义
    utils.ts        # 工具函数
dashboard/          # React + Vite 前端
```

### Scripts

```bash
npm run dev             # 开发模式运行
npm run build           # 编译 TypeScript
npm run build:dashboard # 构建 Dashboard
npm run build:all       # 全部构建
npm start               # 生产模式运行
```

## Tech Stack

- **Backend**: Node.js + Express 5 + TypeScript
- **Frontend**: React + Vite
- **CLI**: Commander.js + Chalk
- **Storage**: JSON file-based (no database)

## License

ISC
