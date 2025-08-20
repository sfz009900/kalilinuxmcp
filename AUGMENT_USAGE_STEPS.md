# 在Augment中使用MCP实时输出查看器

## 步骤1：启动实时查看器
```bash
# 在项目根目录运行
start-realtime-viewer.bat

# 或者手动启动
cd realtime-viewer
npm start
```

## 步骤2：在Augment中启用实时推送
在Augment的对话中输入以下命令：

```
configure_realtime_viewer action=enable
```

您会看到类似这样的响应：
```json
{
  "status": "success",
  "message": "实时推送已启用",
  "config": {
    "enabled": true,
    "activeSessionCount": 0,
    "viewerUrl": "http://localhost:3000"
  }
}
```

## 步骤3：执行命令并查看实时输出
现在当您在Augment中执行交互式命令时，输出会实时显示在浏览器中：

### 示例1：网络扫描
```
start_interactive_command command="nmap -sS -p 1-1000 192.168.1.1"
```

### 示例2：漏洞扫描
```
start_interactive_command command="nikto -h http://example.com"
```

### 示例3：密码破解
```
start_interactive_command command="hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://192.168.1.100"
```

## 步骤4：在浏览器中监控
1. 打开 http://localhost:3000
2. 左侧会显示新的会话
3. 点击会话查看实时输出
4. 输出会自动滚动显示最新内容

## 常用MCP命令

### 查看实时推送状态
```
configure_realtime_viewer action=status
```

### 禁用实时推送
```
configure_realtime_viewer action=disable
```

### 重新启用实时推送
```
configure_realtime_viewer action=enable
```

### 配置自定义查看器URL（如果使用不同端口）
```
configure_realtime_viewer action=configure viewer_url=http://localhost:8080
```

## 工作流程示例

1. **启动查看器**：运行 `start-realtime-viewer.bat`
2. **打开浏览器**：访问 http://localhost:3000
3. **在Augment中启用**：`configure_realtime_viewer action=enable`
4. **执行命令**：`start_interactive_command command="你的命令"`
5. **实时监控**：在浏览器中查看输出进度
6. **继续交互**：使用 `send_input_to_command` 发送输入
7. **结束会话**：使用 `close_interactive_command` 或命令自然结束

## 故障排除

### 问题1：实时推送不工作
- 确认查看器正在运行（http://localhost:3000 可访问）
- 检查是否已启用：`configure_realtime_viewer action=status`
- 重新启用：`configure_realtime_viewer action=enable`

### 问题2：端口冲突
- 修改查看器端口：在 `realtime-viewer/server.js` 中修改 PORT
- 或设置环境变量：`set PORT=8080`
- 然后配置MCP：`configure_realtime_viewer action=configure viewer_url=http://localhost:8080`

### 问题3：连接问题
- 检查防火墙设置
- 确认没有其他程序占用端口3000
- 查看查看器控制台日志

## 注意事项

1. **必须先启动查看器**：MCP服务器需要查看器运行才能推送数据
2. **仅对交互式命令有效**：只有通过 `start_interactive_command` 启动的命令才会推送输出
3. **本地使用**：默认只监听localhost，安全但仅限本机访问
4. **会话管理**：可以同时监控多个命令会话
5. **自动清理**：会话结束后会自动标记为完成状态
