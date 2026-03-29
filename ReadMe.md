# CCO - Claude Code Observer

**[English](#english) | [中文](#中文)**

---

<a id="english"></a>

## English

### What is CCO?

CCO is a lightweight local proxy service designed to help you **observe and understand how Claude Code actually behaves** behind the scenes.

When you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), it makes a series of API calls to Anthropic — spawning sub-agents, compressing context, calling tools — but all of this happens invisibly. CCO sits between Claude Code and the Anthropic API, transparently intercepting every request and response, so you can see:

- **How Claude Code structures its conversations** — when it starts new sessions, how it manages message history
- **When and why sub-agents are spawned** — what triggers them, what prompts they receive, how they nest
- **How context compression works** — when Claude Code decides to compress, what gets archived
- **Token usage patterns** — how many tokens each request consumes, cache hit rates, model distribution
- **The full agent call tree** — a visual map of main agent → sub-agents → nested sub-agents

This gives you transparency into Claude Code's decision-making process, helping you understand its behavior patterns, optimize your usage, and debug unexpected outcomes.

### Features

- **Transparent Proxy** — zero-intrusion integration, Claude Code is completely unaware
- **Session Tracking** — automatically identifies main sessions, sub-agents, context compression, and other request types
- **Real-time Dashboard** — visualizes session list, conversation history, and agent call tree
- **Local Storage** — all data stored as JSON files locally, nothing is uploaded
- **Configurable** — port, API endpoint, and data directory are all customizable

### Quick Start

#### 1. Install Dependencies

```bash
npm install
```

#### 2. Build

```bash
# Build backend
npm run build

# Build Dashboard frontend
npm run build:dashboard

# Or build everything at once
npm run build:all
```

#### 3. Start the Service

```bash
# Development mode (runs TypeScript directly)
npm run dev

# Production mode (runs compiled JS)
npm start

# Or use the CLI
cco init
```

#### 4. Connect Claude Code

Create or edit `.claude/settings.local.json` in your project:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:9527/proxy"
  }
}
```

Then use Claude Code as usual — all requests will be transparently proxied through CCO.

### CLI Commands

```bash
cco init [options]    # Initialize and start the proxy service
cco status            # Check service status
cco open              # Open Dashboard in browser
```

#### `cco init` Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Service port | `9527` |
| `-u, --url <url>` | Anthropic API endpoint (supports relay/proxy) | `https://api.anthropic.com` |
| `-d, --data <path>` | Data storage directory | `./data` (under project root) |

#### Examples

```bash
# Start with default settings
cco init

# Custom port
cco init -p 8080

# Use an API relay service
cco init -u https://your-proxy.com

# Custom data storage location
cco init -d /home/user/.cco-data

# Combined options
cco init -p 8080 -u https://your-proxy.com -d ~/cco-data
```

### Configuration

The config file is stored as `config.json` inside the data directory, auto-generated on first launch:

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

#### Data Directory

```
data/
  config.json          # Service configuration
  sessions/            # Session data
    {session_id}.json  # One JSON file per session
```

Default location is `./data` under the project root. Customize with the `-d` flag.

### Architecture

```
Claude Code  ──>  CCO Proxy (Express)  ──>  Anthropic API
                       │
                  ┌────┴────┐
                  │         │
             Classifier   Storage
          (Classification  (JSON persistence)
              Engine)
                  │
            SessionManager
         (In-memory session
              management)
                  │
              Dashboard
            (React SPA)
```

### Request Classification

CCO automatically identifies the following request types:

| Type | Description |
|------|-------------|
| `main_agent` | Main session request |
| `sub_agent_new` | New sub-agent spawned |
| `sub_agent_continue` | Sub-agent follow-up request |
| `compression` | Context compression |
| `unclassified` | Auxiliary requests (e.g., count_tokens, naming) |

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `http://localhost:9527` | Dashboard UI |
| `http://localhost:9527/api` | REST API (used by Dashboard) |
| `http://localhost:9527/proxy/*` | Proxy forwarding (Claude Code request entry) |
| `http://localhost:9527/health` | Health check |

### Development

#### Project Structure

```
src/
  cli/              # CLI entry and commands
    index.ts        # Commander registration
    commands/
      init.ts       # Initialize and start service
      status.ts     # Check service status
      open.ts       # Open Dashboard
  proxy/
    server.ts       # Express server
    interceptor.ts  # Request/response interception
  session/
    manager.ts      # In-memory session management
    classifier.ts   # Request classification engine
  storage/
    config.ts       # Configuration read/write
    session-store.ts # Session persistence
  shared/
    types.ts        # Type definitions
    utils.ts        # Utility functions
dashboard/          # React + Vite frontend
```

#### Scripts

```bash
npm run dev             # Development mode
npm run build           # Compile TypeScript
npm run build:dashboard # Build Dashboard
npm run build:all       # Build everything
npm start               # Production mode
```

### Tech Stack

- **Backend**: Node.js + Express 5 + TypeScript
- **Frontend**: React + Vite
- **CLI**: Commander.js + Chalk
- **Storage**: JSON file-based (no database)

### License

ISC

---

<a id="中文"></a>

## 中文

### CCO 是什么？

CCO 是一个轻量级的本地代理服务，旨在帮助你**观察和理解 Claude Code 在幕后的真实行为模式**。

当你使用 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 时，它会向 Anthropic 发起一系列 API 调用 — 创建子智能体、压缩上下文、调用工具 — 但这一切都是不可见的。CCO 位于 Claude Code 和 Anthropic API 之间，透明地拦截每一个请求和响应，让你能够看到：

- **Claude Code 如何组织对话** — 何时开始新会话、如何管理消息历史
- **子智能体何时被创建以及为什么** — 什么触发了它们、它们收到了什么提示词、如何嵌套
- **上下文压缩如何工作** — Claude Code 何时决定压缩、什么内容被归档
- **Token 使用模式** — 每个请求消耗多少 Token、缓存命中率、模型分布
- **完整的智能体调用树** — 主智能体 → 子智能体 → 嵌套子智能体的可视化地图

这让你对 Claude Code 的决策过程拥有透明的观察能力，帮助你理解它的行为模式、优化使用方式、以及调试意外结果。

### 功能特性

- **透明代理** — 零侵入接入，Claude Code 无感知
- **会话追踪** — 自动识别主会话、子智能体、上下文压缩等请求类型
- **实时 Dashboard** — 可视化展示会话列表、对话历史、智能体调用树
- **本地存储** — 所有数据以 JSON 文件存储在本地，不上传任何信息
- **可配置** — 端口、API 地址、数据目录均可自定义

### 快速开始

#### 1. 安装依赖

```bash
npm install
```

#### 2. 构建项目

```bash
# 构建后端
npm run build

# 构建 Dashboard 前端
npm run build:dashboard

# 或一次性全部构建
npm run build:all
```

#### 3. 启动服务

```bash
# 开发模式（直接运行 TypeScript）
npm run dev

# 生产模式（运行编译后的 JS）
npm start

# 或使用 CLI
cco init
```

#### 4. 接入 Claude Code

在你的项目中创建或编辑 `.claude/settings.local.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:9527/proxy"
  }
}
```

然后正常使用 Claude Code 即可，所有请求会经过 CCO 代理透明转发。

### CLI 命令

```bash
cco init [options]    # 初始化并启动代理服务
cco status            # 查看服务运行状态
cco open              # 在浏览器中打开 Dashboard
```

#### `cco init` 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 指定服务端口 | `9527` |
| `-u, --url <url>` | 指定 Anthropic API 地址（支持中转） | `https://api.anthropic.com` |
| `-d, --data <path>` | 指定数据存储目录 | `./data`（项目根目录下） |

#### 示例

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

### 配置

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

#### 数据目录结构

```
data/
  config.json          # 服务配置
  sessions/            # 会话数据
    {session_id}.json  # 每个会话一个 JSON 文件
```

默认存储在项目根目录的 `./data` 下，可通过 `-d` 参数自定义。

### 架构

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

### 请求分类

CCO 自动识别以下请求类型：

| 类型 | 说明 |
|------|------|
| `main_agent` | 主会话请求 |
| `sub_agent_new` | 新建子智能体 |
| `sub_agent_continue` | 子智能体后续请求 |
| `compression` | 上下文压缩 |
| `unclassified` | 辅助请求（如 count_tokens、命名） |

### 端点

| 端点 | 说明 |
|------|------|
| `http://localhost:9527` | Dashboard 页面 |
| `http://localhost:9527/api` | REST API（供 Dashboard 使用） |
| `http://localhost:9527/proxy/*` | 代理转发（Claude Code 请求入口） |
| `http://localhost:9527/health` | 健康检查 |

### 开发

#### 项目结构

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

#### 脚本

```bash
npm run dev             # 开发模式运行
npm run build           # 编译 TypeScript
npm run build:dashboard # 构建 Dashboard
npm run build:all       # 全部构建
npm start               # 生产模式运行
```

### 技术栈

- **后端**: Node.js + Express 5 + TypeScript
- **前端**: React + Vite
- **CLI**: Commander.js + Chalk
- **存储**: 基于 JSON 文件（无数据库）

### 许可证

ISC
