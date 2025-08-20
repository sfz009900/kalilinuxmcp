# 🚀 MCP实时输出查看器 - 简单使用指南

## 快速开始（只需2步）

### 1️⃣ 启动实时查看器
```bash
# 双击运行
start-realtime-viewer.bat

# 或手动启动
cd realtime-viewer
npm start
```

### 2️⃣ 打开浏览器
访问：http://localhost:3000

## ✨ 就这么简单！

现在在Augment中执行任何命令，输出都会实时显示在浏览器中：

```bash
execute_command command="nmap -Pn -sS 39.107.25.121"
```

```bash
execute_command command="nikto -h http://example.com"
```

```bash
start_interactive_command command="msfconsole"
```

## 🎯 特性

- ✅ **默认启用** - 无需配置，开箱即用
- ✅ **实时显示** - 命令输出实时推送到浏览器
- ✅ **多会话** - 同时监控多个命令
- ✅ **自动滚动** - 自动跟随最新输出
- ✅ **VS Code风格** - 现代化深色界面

## 🔧 故障排除

**问题：浏览器中看不到输出**
- 确认实时查看器正在运行（http://localhost:3000 能访问）
- 重新构建MCP：`npm run build`

**问题：端口冲突**
- 设置环境变量：`set REALTIME_VIEWER_URL=http://localhost:8080`
- 修改查看器端口：在 `realtime-viewer/server.js` 中修改 PORT

## 📁 项目结构

```
terminal-mcp-server/
├── realtime-viewer/          # 实时查看器Web应用
│   ├── server.js             # 服务器
│   ├── public/index.html     # Web界面
│   └── package.json
├── src/                      # MCP服务器源码
├── start-realtime-viewer.bat # 启动脚本
└── SIMPLE_USAGE.md          # 本文件
```

## 🎉 享受实时监控的乐趣！

不再需要在Cursor中等待长时间命令，现在可以在浏览器中舒适地监控所有渗透测试工具的执行进度！
