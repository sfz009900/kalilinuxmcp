#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  CallToolRequest
} from "@modelcontextprotocol/sdk/types.js";
import { CommandExecutor, InteractiveSession } from "./executor.js";

// 启用调试模式
process.env.DEBUG = 'true';

// 全局日志函数，确保所有日志都通过stderr输出
export const log = {
  debug: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true') {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.error(`[WARN] ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};

// Kali Linux 渗透测试环境配置
const KALI_CONFIG = {
  host: "localhost",  // 本地Kali主机
  port: 2222,         // SSH端口，改为2222端口
  username: "root",   // Kali默认用户名
  privateKeyPath: "C:\\Users\\hack004\\.ssh\\kali000" // 私钥文件路径
};

const commandExecutor = new CommandExecutor();

// 存储活跃的交互式会话
const activeSessions: Map<string, InteractiveSession> = new Map();

// 创建服务器
function createServer() {
  const server = new Server(
    {
      name: "kali-pentest-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "execute_command",
          description: "(无需交互式比如ping 127.0.0.1)在Kali Linux渗透测试环境中执行命令。支持所有Kali Linux内置的安全测试工具和常规Linux命令。",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "要在Kali Linux环境中执行的命令。可以是任何安全测试、漏洞扫描、密码破解等渗透测试命令。"
              }
            },
            required: ["command"]
          }
        },
        {
          name: "start_interactive_command",
          description: "(需要交互式比如mysql -u root -p)在Kali Linux环境中启动一个交互式命令，并返回会话ID。交互式命令可以接收用户输入。",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "要在Kali Linux环境中执行的交互式命令。"
              }
            },
            required: ["command"]
          }
        },
        {
          name: "send_input_to_command",
          description: "向正在运行的交互式命令发送用户输入。",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "交互式会话ID。"
              },
              input: {
                type: "string",
                description: "发送给命令的输入文本。"
              },
              end_line: {
                type: "boolean",
                description: "是否在输入后添加换行符。默认为true。"
              }
            },
            required: ["session_id", "input"]
          }
        },
        {
          name: "get_command_output",
          description: "获取交互式命令的最新输出。",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "交互式会话ID。"
              }
            },
            required: ["session_id"]
          }
        },
        {
          name: "close_interactive_command",
          description: "关闭交互式命令会话。",
          inputSchema: {
            type: "object", 
            properties: {
              session_id: {
                type: "string",
                description: "交互式会话ID。"
              }
            },
            required: ["session_id"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    try {
      const toolName = request.params.name;
      
      // 确保已连接
      if (!commandExecutor.isConnected) {
        await commandExecutor.connect({
          host: KALI_CONFIG.host,
          port: KALI_CONFIG.port,
          username: KALI_CONFIG.username,
          privateKeyPath: KALI_CONFIG.privateKeyPath
        });
      }
      
      // 根据工具名称处理不同的请求
      switch (toolName) {
        // 执行非交互式命令
        case "execute_command": {
          const command = String(request.params.arguments?.command);
          if (!command) {
            throw new McpError(ErrorCode.InvalidParams, "命令是必需的");
          }
          const env = {};
          const timeout = 30000000;

          try {
            log.info(`准备执行命令: ${command}`);
            
            // 执行命令
            const result = await commandExecutor.executeCommand(command, {
              timeout: timeout,
              env: env as Record<string, string>
            });
            
            log.info("命令执行成功");
            
            return {
              content: [{
                type: "text",
                text: `命令输出:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
              }]
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`命令执行失败: ${errorMessage}`);
            throw new McpError(
              ErrorCode.InternalError,
              `无法执行Kali Linux命令: ${errorMessage}`
            );
          }
        }
        
        // 启动交互式命令
        case "start_interactive_command": {
          const command = String(request.params.arguments?.command);
          if (!command) {
            throw new McpError(ErrorCode.InvalidParams, "命令是必需的");
          }
          
          try {
            log.info(`准备启动交互式命令: ${command}`);
            
            // 创建交互式会话
            const session = await commandExecutor.createInteractiveSession(command);
            activeSessions.set(session.sessionId, session);
            
            // 等待初始输出
            const initialOutput = await new Promise<string>((resolve) => {
              setTimeout(() => {
                resolve(session.stdout);
              }, 500); // 等待500ms以收集初始输出
            });
            
            log.info(`交互式会话已创建，ID: ${session.sessionId}`);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  session_id: session.sessionId,
                  initial_output: initialOutput
                })
              }]
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`创建交互式会话失败: ${errorMessage}`);
            throw new McpError(
              ErrorCode.InternalError,
              `无法创建交互式会话: ${errorMessage}`
            );
          }
        }
        
        // 向命令发送输入
        case "send_input_to_command": {
          const sessionId = String(request.params.arguments?.session_id);
          const input = String(request.params.arguments?.input);
          const endLine = request.params.arguments?.end_line !== false; // 默认为true
          
          if (!sessionId || input === undefined) {
            throw new McpError(ErrorCode.InvalidParams, "会话ID和输入是必需的");
          }
          
          const session = activeSessions.get(sessionId);
          if (!session) {
            throw new McpError(ErrorCode.InvalidParams, `找不到会话ID: ${sessionId}`);
          }
          
          try {
            log.info(`向会话 ${sessionId} 发送输入: ${input}`);
            
            // 记录输入前的输出长度
            const beforeLength = session.stdout.length;
            
            // 发送输入，根据需要添加换行符
            session.write(endLine ? `${input}\n` : input);
            
            // 等待新输出
            const newOutput = await new Promise<string>((resolve) => {
              setTimeout(() => {
                const newText = session.stdout.substring(beforeLength);
                resolve(newText);
              }, 500); // 等待500ms以收集新输出
            });
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  new_output: newOutput
                })
              }]
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`向会话发送输入失败: ${errorMessage}`);
            throw new McpError(
              ErrorCode.InternalError,
              `无法发送输入到会话: ${errorMessage}`
            );
          }
        }
        
        // 获取命令输出
        case "get_command_output": {
          const sessionId = String(request.params.arguments?.session_id);
          
          if (!sessionId) {
            throw new McpError(ErrorCode.InvalidParams, "会话ID是必需的");
          }
          
          const session = activeSessions.get(sessionId);
          if (!session) {
            throw new McpError(ErrorCode.InvalidParams, `找不到会话ID: ${sessionId}`);
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "success",
                stdout: session.stdout,
                stderr: session.stderr
              })
            }]
          };
        }
        
        // 关闭交互式命令
        case "close_interactive_command": {
          const sessionId = String(request.params.arguments?.session_id);
          
          if (!sessionId) {
            throw new McpError(ErrorCode.InvalidParams, "会话ID是必需的");
          }
          
          const session = activeSessions.get(sessionId);
          if (!session) {
            throw new McpError(ErrorCode.InvalidParams, `找不到会话ID: ${sessionId}`);
          }
          
          try {
            log.info(`关闭会话 ${sessionId}`);
            session.close();
            activeSessions.delete(sessionId);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  message: "会话已关闭",
                  final_stdout: session.stdout,
                  final_stderr: session.stderr
                })
              }]
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`关闭会话失败: ${errorMessage}`);
            throw new McpError(
              ErrorCode.InternalError,
              `无法关闭会话: ${errorMessage}`
            );
          }
        }
        
        default:
          throw new McpError(ErrorCode.MethodNotFound, "未知工具");
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return server;
}

async function main() {
  try {
    // 使用标准输入输出
    const server = createServer();
    
    // 设置MCP错误处理程序
    server.onerror = (error: any) => {
      log.error(`MCP错误: ${error.message}`);
    };

    // 测试SSH连接
    try {
      log.info("=== 测试与Kali Linux的SSH连接 ===");
      log.info(`配置: ${KALI_CONFIG.username}@${KALI_CONFIG.host}:${KALI_CONFIG.port}`);
      
      // 连接并测试一个简单命令
      await commandExecutor.connect({
        host: KALI_CONFIG.host,
        port: KALI_CONFIG.port,
        username: KALI_CONFIG.username,
        privateKeyPath: KALI_CONFIG.privateKeyPath
      });
      
      const testResult = await commandExecutor.executeCommand("echo '连接测试成功'", { timeout: 10000 });
      log.info(`SSH连接测试成功! 输出: ${testResult.stdout}`);
      
      // 执行ls -al命令
      log.info(`=== 执行测试命令: ls -al ===`);
      const lsResult = await commandExecutor.executeCommand("ls -al", { timeout: 10000 });
      log.info(`命令执行结果: \n${lsResult.stdout}`);
      
      log.info(`=== SSH连接测试完成 ===`);
    } catch (error) {
      log.error(`=== SSH连接测试失败 ===`);
      log.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
      
      // 提供排查建议
      log.error("排查建议:");
      log.error("1. 确认SSH服务已启动 - 在Kali终端中运行: sudo service ssh start");
      log.error("2. 检查连接信息 - 主机、端口、用户名和私钥路径");
      log.error("3. 尝试手动SSH连接 - 运行: ssh root@localhost -p 2222");
      log.error("4. 检查Kali Linux中的SSH配置 - /etc/ssh/sshd_config");
      log.error(`=== 继续启动服务器，但命令可能无法执行 ===`);
    }
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("Kali Linux渗透测试MCP服务器运行在stdio上");

    // 处理进程退出
    process.on('SIGINT', async () => {
      log.info("关闭服务器...");
      // 关闭所有活跃会话
      for (const [sessionId, session] of activeSessions.entries()) {
        log.info(`关闭会话 ${sessionId}`);
        session.close();
      }
      await commandExecutor.disconnect();
      process.exit(0);
    });
  } catch (error) {
    log.error("服务器错误:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  log.error("服务器错误:", error);
  process.exit(1);
});
