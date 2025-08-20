# 在Augment中使用MCP实时输出查看器

## 步骤1：启动实时查看器
```bash
# 在项目根目录运行
start-realtime-viewer.bat

# 或者手动启动
cd realtime-viewer
npm start
```

## 步骤2：执行命令并查看实时输出
🎉 **实时推送已默认启用！** 无需额外配置，直接执行命令即可。
现在当您在Augment中执行命令时，输出会实时显示在浏览器中：

### 🎯 推荐：使用execute_command（更简单）
```
execute_command command="nmap -Pn -sS -sV 39.107.25.121"
```

```
execute_command command="nikto -h http://example.com"
```

```
execute_command command="hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://192.168.1.100"
```

### 🔄 或者使用start_interactive_command（需要交互）
```
start_interactive_command command="nmap -sS -p 1-1000 192.168.1.1"
```

```
start_interactive_command command="nikto -h http://example.com"
```

```
start_interactive_command command="hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://192.168.1.100"
```

## 步骤4：在浏览器中监控
1. 打开 http://localhost:3000
2. 左侧会显示新的会话
3. 点击会话查看实时输出
4. 输出会自动滚动显示最新内容

## 环境变量配置（可选）

如果需要自定义查看器URL，可以设置环境变量：
```bash
set REALTIME_VIEWER_URL=http://localhost:8080
```
然后重新启动MCP服务器。

## 工作流程示例

1. **启动查看器**：运行 `start-realtime-viewer.bat`
2. **打开浏览器**：访问 http://localhost:3000
3. **直接执行命令**：`execute_command command="你的命令"`
4. **实时监控**：在浏览器中查看输出进度
5. **继续执行**：所有命令都会自动显示实时输出

## 故障排除

### 问题1：实时推送不工作
- 确认查看器正在运行（http://localhost:3000 可访问）
- 重新构建MCP服务器：`npm run build`
- 重启Augment中的MCP连接

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
2. **实时推送默认启用**：无需手动配置，所有命令都支持实时推送
3. **两种命令都支持**：
   - `execute_command` - 推荐使用，自动管理会话
   - `start_interactive_command` - 支持交互式输入
4. **本地使用**：默认只监听localhost，安全但仅限本机访问
5. **会话管理**：可以同时监控多个命令会话
6. **自动清理**：会话结束后会自动标记为完成状态
