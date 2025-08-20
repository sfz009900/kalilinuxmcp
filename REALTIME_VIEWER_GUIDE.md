# MCP实时命令输出查看器使用指南

## 概述

这个实时查看器解决了在Cursor等AI工具中执行长时间命令时看不到实时输出的问题。通过WebSocket技术，您可以在浏览器中实时监控命令执行进度。

## 快速开始

### 1. 启动实时查看器

**Windows用户：**
```bash
# 双击运行
start-realtime-viewer.bat

# 或者手动运行
cd realtime-viewer
npm install
npm start
```

**Linux/Mac用户：**
```bash
cd realtime-viewer
npm install
npm start
```

### 2. 打开Web界面

启动后，在浏览器中访问：
```
http://localhost:3000
```

### 3. 启用MCP服务器的实时推送

在Cursor或其他AI工具中，使用以下命令启用实时推送：

```
configure_realtime_viewer action=enable
```

或者配置自定义查看器URL：
```
configure_realtime_viewer action=configure viewer_url=http://localhost:3000
```

### 4. 执行命令并查看实时输出

现在当您执行交互式命令时，输出将实时显示在Web界面中：

```
start_interactive_command command="nmap -sS -O 192.168.1.1"
```

## 功能特性

### Web界面功能
- 📊 **会话列表** - 左侧显示所有活跃的命令会话
- 📺 **实时输出** - 右侧显示选中会话的实时命令输出
- 🔄 **自动滚动** - 可选的自动滚动到最新输出
- 🎨 **VS Code风格** - 深色主题，类似VS Code的界面
- 📱 **响应式设计** - 支持不同屏幕尺寸

### MCP工具命令

#### 查看实时推送状态
```
configure_realtime_viewer action=status
```

#### 启用实时推送
```
configure_realtime_viewer action=enable
```

#### 禁用实时推送
```
configure_realtime_viewer action=disable
```

#### 配置查看器URL
```
configure_realtime_viewer action=configure viewer_url=http://localhost:3000
```

## 使用场景

### 1. 网络扫描
```
start_interactive_command command="nmap -sS -p- 192.168.1.0/24"
```
在Web界面中实时查看扫描进度和结果。

### 2. 漏洞扫描
```
start_interactive_command command="nikto -h http://target.com"
```
实时监控漏洞扫描的发现过程。

### 3. 密码破解
```
start_interactive_command command="hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://192.168.1.100"
```
实时查看密码破解尝试的进度。

### 4. 数据库操作
```
start_interactive_command command="mysql -u root -p"
```
在Web界面中查看SQL查询的执行结果。

## 环境变量配置

您可以通过环境变量配置MCP服务器：

```bash
# 启用实时推送（默认禁用）
set REALTIME_PUSH_ENABLED=true

# 配置查看器URL（默认 http://localhost:3000）
set REALTIME_VIEWER_URL=http://localhost:8080

# 重新启动MCP服务器
npm run build
npm start
```

## 故障排除

### 1. 连接问题
- 确保实时查看器服务器正在运行（http://localhost:3000）
- 检查防火墙设置
- 确认端口3000未被其他程序占用

### 2. 输出不显示
- 确认已启用实时推送：`configure_realtime_viewer action=status`
- 检查MCP服务器日志中的错误信息
- 确认命令是通过`start_interactive_command`启动的

### 3. 性能问题
- 对于输出量很大的命令，系统会自动缓冲输出以减少网络请求
- 可以通过清空输出按钮清理界面
- 关闭不需要的会话以释放资源

## 技术架构

```
┌─────────────────┐    HTTP/WebSocket    ┌──────────────────┐
│   MCP Server    │ ──────────────────► │ Realtime Viewer  │
│                 │                      │                  │
│ - CommandExecutor│                      │ - Express Server │
│ - RealtimePusher │                      │ - WebSocket      │
│ - SSH Sessions  │                      │ - Web Interface  │
└─────────────────┘                      └──────────────────┘
        │                                          │
        │ SSH                                      │ Browser
        ▼                                          ▼
┌─────────────────┐                      ┌──────────────────┐
│   Kali Linux    │                      │   Web Browser    │
│                 │                      │                  │
│ - Security Tools│                      │ - Real-time UI   │
│ - Command Line  │                      │ - Session Mgmt   │
└─────────────────┘                      └──────────────────┘
```

## 安全注意事项

1. **本地使用** - 实时查看器默认只监听localhost，不对外网开放
2. **无认证** - 当前版本没有身份验证，请勿在生产环境使用
3. **敏感信息** - 命令输出可能包含敏感信息，请注意保护
4. **网络安全** - 如需远程访问，请配置适当的网络安全措施

## 更新日志

### v1.0.0
- 初始版本发布
- 支持实时命令输出显示
- WebSocket通信
- 多会话管理
- VS Code风格界面
