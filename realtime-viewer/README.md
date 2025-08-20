# MCP实时命令输出查看器

这是一个用于实时查看MCP服务器命令执行输出的Web应用。当在Cursor等AI工具中执行长时间命令时，可以通过这个查看器实时监控命令的执行进度。

## 功能特性

- 🔄 **实时输出显示** - 通过WebSocket实时接收和显示命令输出
- 📱 **多会话管理** - 支持同时监控多个命令执行会话
- 🎨 **现代化界面** - 类似VS Code的深色主题界面
- 📜 **自动滚动** - 可选的自动滚动到最新输出
- 🔍 **会话状态** - 清晰显示每个会话的运行状态
- 💾 **输出保存** - 保留完整的命令输出历史

## 安装和运行

1. 安装依赖：
```bash
cd realtime-viewer
npm install
```

2. 启动服务器：
```bash
npm start
```

3. 打开浏览器访问：
```
http://localhost:3000
```

## API接口

### 开始新会话
```http
POST /api/session/start
Content-Type: application/json

{
  "sessionId": "unique-session-id",
  "command": "执行的命令"
}
```

### 发送输出数据
```http
POST /api/session/output
Content-Type: application/json

{
  "sessionId": "session-id",
  "output": "命令输出内容",
  "isComplete": false
}
```

### 结束会话
```http
POST /api/session/end
Content-Type: application/json

{
  "sessionId": "session-id"
}
```

### 获取所有会话
```http
GET /api/sessions
```

### 获取特定会话详情
```http
GET /api/session/{sessionId}
```

## 使用方法

1. 启动实时查看器服务
2. 修改MCP服务器以发送输出到查看器
3. 在浏览器中打开查看器界面
4. 执行命令时，输出将实时显示在界面中

## 配置

默认端口：3000
可通过环境变量 `PORT` 修改：
```bash
PORT=8080 npm start
```

## 开发模式

使用文件监听模式运行：
```bash
npm run dev
```

## 技术栈

- **后端**: Node.js + Express + WebSocket
- **前端**: 原生HTML/CSS/JavaScript
- **通信**: WebSocket + REST API
- **样式**: VS Code风格的深色主题
