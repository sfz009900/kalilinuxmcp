import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// 启用CORS
app.use(cors());
app.use(express.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 存储活跃的会话和连接
const sessions = new Map(); // sessionId -> { output: string, clients: Set<WebSocket> }
const clients = new Set(); // 所有连接的WebSocket客户端

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    clients.add(ws);
    
    // 发送当前所有会话的状态
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
        sessionId: id,
        output: data.output,
        lastUpdate: data.lastUpdate
    }));
    
    ws.send(JSON.stringify({
        type: 'session_list',
        sessions: sessionList
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('收到消息:', data);
            
            switch (data.type) {
                case 'subscribe_session':
                    // 订阅特定会话
                    const sessionId = data.sessionId;
                    if (sessions.has(sessionId)) {
                        sessions.get(sessionId).clients.add(ws);
                        // 发送该会话的完整输出
                        ws.send(JSON.stringify({
                            type: 'session_output',
                            sessionId: sessionId,
                            output: sessions.get(sessionId).output,
                            isComplete: false
                        }));
                    }
                    break;
                    
                case 'unsubscribe_session':
                    // 取消订阅特定会话
                    const unsubSessionId = data.sessionId;
                    if (sessions.has(unsubSessionId)) {
                        sessions.get(unsubSessionId).clients.delete(ws);
                    }
                    break;
            }
        } catch (error) {
            console.error('处理WebSocket消息错误:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('WebSocket连接关闭');
        clients.delete(ws);
        // 从所有会话中移除该客户端
        sessions.forEach(session => {
            session.clients.delete(ws);
        });
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

// REST API端点 - 接收MCP服务器的输出
app.post('/api/session/start', (req, res) => {
    const { sessionId, command } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: '缺少sessionId' });
    }
    
    // 创建新会话
    sessions.set(sessionId, {
        output: '',
        command: command || '',
        clients: new Set(),
        lastUpdate: new Date().toISOString(),
        isActive: true
    });
    
    console.log(`新会话开始: ${sessionId}, 命令: ${command}`);
    
    // 通知所有客户端有新会话
    const sessionData = {
        sessionId,
        command,
        lastUpdate: sessions.get(sessionId).lastUpdate
    };
    
    clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(JSON.stringify({
                type: 'new_session',
                session: sessionData
            }));
        }
    });
    
    res.json({ success: true, sessionId });
});

app.post('/api/session/output', (req, res) => {
    const { sessionId, output, isComplete = false } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: '缺少sessionId' });
    }
    
    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: '会话不存在' });
    }
    
    // 更新会话输出
    const session = sessions.get(sessionId);
    session.output += output || '';
    session.lastUpdate = new Date().toISOString();
    session.isActive = !isComplete;
    
    console.log(`会话 ${sessionId} 输出更新, 长度: ${output?.length || 0}, 完成: ${isComplete}`);
    
    // 发送给订阅该会话的客户端
    session.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(JSON.stringify({
                type: 'session_output',
                sessionId,
                output: output || '',
                fullOutput: session.output,
                isComplete,
                lastUpdate: session.lastUpdate
            }));
        }
    });
    
    res.json({ success: true });
});

app.post('/api/session/end', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: '缺少sessionId' });
    }
    
    if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        session.isActive = false;
        session.lastUpdate = new Date().toISOString();
        
        console.log(`会话结束: ${sessionId}`);
        
        // 通知订阅的客户端
        session.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify({
                    type: 'session_ended',
                    sessionId,
                    lastUpdate: session.lastUpdate
                }));
            }
        });
    }
    
    res.json({ success: true });
});

// 获取所有会话
app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
        sessionId: id,
        command: data.command,
        outputLength: data.output.length,
        lastUpdate: data.lastUpdate,
        isActive: data.isActive
    }));
    
    res.json({ sessions: sessionList });
});

// 获取特定会话的完整输出
app.get('/api/session/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    
    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: '会话不存在' });
    }
    
    const session = sessions.get(sessionId);
    res.json({
        sessionId,
        command: session.command,
        output: session.output,
        lastUpdate: session.lastUpdate,
        isActive: session.isActive
    });
});

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`MCP实时输出查看器运行在 http://localhost:${PORT}`);
    console.log('WebSocket服务器已启动');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});
