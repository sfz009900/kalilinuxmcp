目前只是个玩具,只支持执行可以返回的命令,如burp suite和metasploit等不能进行界面和命令交互,metasploit倒是可以叫ai agent直接执行不进入命令交互模式,有时间弄得的哥们可以拿去加强一下 😜

# kalilinuxmcp

kali linux mcp,pentest,penetration test

# 更新:
20250401更新: 新增简单的交互式处理
![image](https://github.com/user-attachments/assets/45d7c2f5-2228-4e2b-9a1c-a8e74a4fa82c)
![image](https://github.com/user-attachments/assets/832a4ef4-d393-4636-8e15-8b165e337d5b)
![image](https://github.com/user-attachments/assets/0e74d4ee-ceca-48d2-869a-efe93097b303)


# 如何安装:

# 1: 首先要用ssh-keygen -t rsa做一个私钥和公钥,替换公钥到Dockerfile的,替换私钥到"C:\Users\[Username]\.ssh\\kali000",这里自行去src\index.ts里搜索"kali000"替换路径

`'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCsoJo7WJIHDQgmEdKwm6IqS61xaGWa/OVVMCrMwcVh13xvYbAD7wdMufzNhWRxSso3SKvTHbQjIszvYQgkVFjRPiJW5vGCU0847CX0zZytGLnKpKWDZ5ccShMPlIxVuy2+WUQlKNL7f+w59PMX+3BLcikhtwk0xwG7tpS4kAtXHlrwt1B1vFj3CoF8rBofGJAahOuPvruRh9i1i73i5JJHJFeDdJVfNnY5/8HnBvtWtJzbsbmlyaTODfrDCeYZ32zxDZdsPVEls3RDsfgUadyC71mpXloJ8JTiUU37H5DY+xtIuz3XICwA7DsVm9jiKaSR96DZyogYxx+UKdrDsIH4JQwBNs3RDCX+t7ivKj75KkhhrW2X2h90EOjwQPQOhuVU2FtMXbWlfbZL5UwXGgA7Efe3N0ZzrKac+RGM6vY/jsnESgZaTayF/N/BysMpjI18xy6Y12CyPXVYsvF3v04d2XR1Fs5rduERjpot7o9N+i5FcoTfUb5WP5nVU9X0b2s= hack004@DESKTOP-H4HRI73'`

# 2:因为是国内环境,docker里我加了使用主机的socks5代理,自行搜索来替换"192.168.31.110",还有dns服务器也强制用dns2socks转到了本地127.0.0.1使用socks5代理,可自行去Dockerfile里替换或者去掉

# 3:原始使用的"booyaabes/kali-linux-full"镜像,但是里面软件版本有点老,自行选择是否要执行以下操作更新(主要需要更新很久!)

```1:进入docker容器后执行:
1:wget -q -O - https://archive.kali.org/archive-key.asc | gpg --import 
2:curl -fsSL https://archive.kali.org/archive-key.asc | sudo gpg --dearmor -o /usr/share/keyrings/kali-archive-keyring.gpg 
3:sudo apt update && sudo apt full-upgrade -y 
4:(下载更新最新版kali linux的所有工具,注意很大很慢)sudo apt install kali-linux-everything -y 
5:如果只需更新单独的软件,就无需执行4因为要很久,例如sudo apt install wpscan 
6:我自己倒是完成了最新更新,但是容器太大了几十G就不传了,需要的自行操作就行了```
```

# 4:(编译MCP),先npm install后直接npm run build,得到build目录,核心是index.js

# 5:(编译Docker镜像),

```
1:编译镜像:"docker build -t kali-pentest-mcp ."
2:部署镜像:"docker run --name kali-container -d --privileged -p 2222:22 kali-pentest-mcp"
```
# 6:安装MCP:

```
"kali-pentest-mcp-server": {
  "command": "node",
  "args": ["D:/kalimcp/build/index.js"],
  "env": {}
}
```

# 注意事项:

1: 每次重启docker后记得刷新MCP,因为可能SSH连接会断开

# 参考项目:

> https://github.com/weidwonder/terminal-mcp-server

# 效果展示:

# 1:Lab: Blind SQL injection with out-of-band data exfiltration

![image](https://github.com/user-attachments/assets/a16a30f4-e699-4c89-ae2f-f8cc8dda4905)

![image](https://github.com/user-attachments/assets/172499c2-7392-4302-8396-bce8e73f43e3)

![image](https://github.com/user-attachments/assets/0c2faf26-e7e7-4788-a882-4d8c36f3f80b)

![image](https://github.com/user-attachments/assets/7cc362dc-c94c-499c-a272-1130ccf35b1b)

# 2:command injection:

![image](https://github.com/user-attachments/assets/f1e75047-5c83-4206-95a4-28ce9fe82427)

![image](https://github.com/user-attachments/assets/76aaee67-2af0-4167-97bb-946ebf36e0aa)

![image](https://github.com/user-attachments/assets/2bfd3929-1d80-4dd5-94c8-26ed00f4fbce)

![image](https://github.com/user-attachments/assets/221acee6-297e-481b-813c-077bcc2df25b)

# 3:Lab: Web shell upload via Content-Type restriction bypass

![image](https://github.com/user-attachments/assets/fcf30b5b-48b2-4cf9-a56a-e81277134942)

![image](https://github.com/user-attachments/assets/c6c6a60a-18a0-4087-b869-1d08f37b6ea8)

![image](https://github.com/user-attachments/assets/7fdd4c2b-30fd-4a5b-b473-e76617036be4)

![image](https://github.com/user-attachments/assets/fa3d0ccc-7000-481a-92a9-f1a6f2370bc1)

![image](https://github.com/user-attachments/assets/5d7c2678-a168-43f6-943a-8fb978d3f2c8)



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

