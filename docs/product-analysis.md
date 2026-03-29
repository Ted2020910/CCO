# CCO 产品分析文档
> Claude Code Observer — claude code 运行过程可视化，为**AI 工具研究者**：分析 Claude Code 的工具调用模式和提示词策略，并且将交互轨迹储存到本地 JSON 文件中，作为后续分析的基础。

### 1 产品形态

CCO 是一个**本地运行的 CLI + Web Dashboard 工具**：

```
用户侧（无需联网）          CCO（本地代理）          Anthropic API
                          ┌─────────────┐
Claude Code ─────────────▶│  localhost  │──────────▶ api.anthropic.com
                          │  :9527      │◀──────────
                          │  (代理层)   │
                          └──────┬──────┘
                                 │ 记录
                          ┌──────▼──────┐
                          │ ~/.cco/data │  (本地 JSON 文件)
                          └──────┬──────┘
                                 │ 可视化
                          ┌──────▼──────┐
                          │  Dashboard  │  http://localhost:9527
                          └─────────────┘
```

**关键特性：**
- ✅ 完全本地运行，API Key 不经过任何第三方
- ✅ 零侵入：不修改 Claude Code 本身，只改 `ANTHROPIC_BASE_URL`
- ✅ 开箱即用：单命令 `cco init` 启动

---

### 目标使用流程
1. 用户在任意命令行输入 cco dashboard 就可以打开前端界面
2. 用户新开一个session，然后输入 cco init --url https://对应的athropic的中转地址，然后CCO后台就会自己启动一个本地的代理,然后用户再输入claude，就可以打开claude code了
3. 请求的meta-data包含用户id，会话id，设备id等信息，用于在前端进行会话的可视化:  "metadata": {
    "user_id": "{\"device_id\":\"51e749237150cf25d1c72b40c44185c4df368da3a8b8752fb5bd53fe545f01f7\",\"account_uuid\":\"\",\"session_id\":\"a670867f-0dab-44b6-a462-6bb94ab34a52\"}"
  },
4. claude code向代理接口发送的所有请求，CCO都会拦截下来，对其进行分类处理，claude code 会发送多种请求
   1. 主agent正常调用的请求
   2. 为当前session生成标题的请求
   3. 子智能体的请求
   4. 对上下文进行压缩的请求
   5. 生成下一步引导的预测
  那么如何进行这些请求的分类呢？
  最直接的方式是：基于系统提示词，以及提示词构成来判断。
  具体的不同场景的提示词在文件夹 docs\claude code逆向结果
  
  ## 主agent
  包含最完整系统提示词，以及工具列表，也是用户在claude code的终端中看到的主要交互对象。

  ## 子智能体
  子智能体是主agent调用的工具，每个子智能体都有自己的系统提示词，以及部分的工具列表。通常会作为后台任务进行调用，这里需要分析如何在前端进行子智能体的可视化，如何判断请求是来自子agent

  ## 上下文压缩
  上下文压缩是主agent调用的工具，用于压缩当前会话的上下文，通常会作为后台任务进行调用，这里需要分析如何在前端进行上下文压缩的可视化，如何判断请求是来自上下文压缩工具

  ## 下一步引导预测
  下一步引导预测会使用主agent相同的系统提示词，但是会在最新的message中添加对下一步应道预测的引导

  # 出参处理
  所有的输出都按照anthropic标准格式进行返回，这里的难点在于需要如何进行出参处理：
  例如：如果模型并行调用工具，那么前端需要显示这个并行的过程
  同时工具调用结果也需要根据工具的id进行匹配

  # 因此需要设计前端的格式，来展示整个调用过程
  让我们分析这个数据格式
  session_id
  session_name
  main_agent_system_prompt
  main_agent_messages
  tools
  tool_call_result_map
  sub_agent_system_prompt_map
  sub_agent_system_prompt
  sub_agent_messages



---

## 3. 架构决策

### 3.1 为什么选择本地代理模式？

**对比方案：**

| 方案 | 优点 | 缺点 |
|---|---|---|
| **本地代理（当前）** | 零延迟、安全、无外部依赖 | 需要本地运行服务 |
| Claude Code Hooks | 官方支持，可读取输出 | 无法获取 token 用量 |
| 修改 Claude Code 源码 | 深度集成 | 难以维护，版本耦合 |
| 云端代理 | 跨设备同步 | API Key 安全风险 |

**结论**：本地代理是安全性和功能性的最佳平衡点。

### 3.2 为什么选择 JSON 文件而非数据库？

- **零依赖**：用户无需安装 SQLite 或其他数据库
- **可读性**：调试时可直接打开文件查看
- **可迁移**：直接拷贝目录即可备份/迁移数据
- **足够快**：单用户场景下，每天数百条记录，JSON 读写完全满足需求

> 未来如需支持大量历史数据查询，可以无缝迁移到 SQLite（存储层已封装，只需替换实现）。

### 3.3 架构层次划分

```
┌─────────────────────────────────────────┐
│  CLI 层 (src/cli/)                       │  用户入口
│  commander 命令 + 用户友好的输出          │
├─────────────────────────────────────────┤
│  Proxy 层 (src/proxy/)                   │  核心功能
│  Express 服务器 + 拦截器 + 转发器          │
├─────────────────────────────────────────┤
│  API 层 (src/api/)                       │  数据接口
│  REST 接口，供 Dashboard 消费             │
├─────────────────────────────────────────┤
│  Storage 层 (src/storage/)               │  数据持久化
│  JSON 文件读写 + 统计计算                  │
├─────────────────────────────────────────┤
│  Shared 层 (src/shared/)                 │  公共基础
│  类型定义 + 定价计算 + 工具函数             │
└─────────────────────────────────────────┘
```

---

## 4. 接入方式

### 4.1 基本接入

```bash
# 1. 安装
npm install -g cco

# 2. 启动代理服务
cco init

# 3. 按提示在项目中配置（自动生成）
# 在 .claude/settings.local.json 中添加：
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:9527/proxy/<session-id>"
  }
}

# 4. 正常使用 Claude Code，CCO 自动在后台记录
```

### 4.2 Session 设计

`session-id` 是一个 UUID，作用是**标识一次 Claude Code 工作会话**。

- 每次运行 `cco init` 生成新的 session-id
- 同一个 session-id 下的所有 API 调用被归组
- 多个项目可以用不同的 session-id 隔离

---

## 5. 费用计算模型

CCO 基于 Anthropic 官方定价表计算费用，支持：

- **标准 token**：输入/输出分别计费
- **缓存 token**：缓存写入和缓存命中分别计费（价格不同）
- **自动匹配模型**：通过模型名称前缀模糊匹配，兼容带日期后缀的版本号

```
费用 = 输入Token × 输入单价
     + 输出Token × 输出单价
     + 缓存写入Token × 缓存写入单价（可选）
     + 缓存读取Token × 缓存读取单价（可选）
```

---

## 6. 未来路线图

### v1.1 — 体验优化
- [ ] 实时 Dashboard 刷新（Server-Sent Events）
- [ ] `cco status` 终端表格展示
- [ ] 自动打开浏览器（`cco init --open`）

### v1.2 — 数据增强
- [ ] 工具调用统计（各工具调用次数/费用占比）
- [ ] 请求内容搜索
- [ ] 导出 CSV/JSON 报表

### v2.0 — 多用户 / 团队
- [ ] 多 session 对比视图
- [ ] 费用预算告警
- [ ] 项目标签管理
- [ ] 可选云端同步

---

## 7. 技术栈总览

| 层次 | 技术 | 版本 |
|---|---|---|
| 运行时 | Node.js | ≥ 18 |
| 语言 | TypeScript | 5.7 |
| CLI 框架 | Commander.js | 14 |
| HTTP 服务 | Express | 5 |
| 终端颜色 | Chalk | 5 |
| 前端框架 | React + Vite | 18 + 6 |
| 图表库 | Recharts | 2 |
| 路由 | React Router | 6 |
| 数据存储 | JSON 文件 | — |
