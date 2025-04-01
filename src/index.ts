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
import { CommandExecutor, InteractiveSession, stripAnsiCodes } from "./executor.js";
import { EventEmitter } from 'events';
import { ClientChannel, ConnectConfig, ExecOptions } from 'ssh2';

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

// 添加全局变量存储当前命令
(global as any).currentInteractiveCommand = '';

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
          description: "(自行判断是AI输入还是用户手动输入)向正在运行的交互式命令发送用户输入。",
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
          let command = String(request.params.arguments?.command);
          if (!command) {
            throw new McpError(ErrorCode.InvalidParams, "命令是必需的");
          }

          // 存储当前命令到全局变量
          (global as any).currentInteractiveCommand = command;

          // 如果是 msfconsole，添加 -q 参数
          if (command.trim() === 'msfconsole') {
            command = 'msfconsole -q';
            log.info("检测到 msfconsole，自动添加 -q 参数启动。");
          }
          
          try {
            log.info(`准备启动交互式命令: ${command}`);
            
            // 显式设置pty选项，特别是对msfconsole这类特殊终端程序
            const ptyOptions = {
              waitForPrompt: true,    // 等待提示符后再返回
              maxWaitTime: command.includes('msfconsole') ? 3000000 : 30000,   // msfconsole等待更长时间(2分钟)，其他命令30秒
              forcePty: command.includes('msfconsole'), // 为msfconsole强制分配PTY
              term: "xterm-256color",  // 设置终端类型
              cols: 100,               // 设置列数
              rows: 40                 // 设置行数
            };
            
            // 对于msfconsole特别提示用户可能需要等待较长时间
            if (command.includes('msfconsole')) {
              log.info(`正在启动msfconsole，这可能需要1-2分钟时间，请耐心等待...`);
            }
            
            // 创建交互式会话
            const session = await commandExecutor.createInteractiveSession(command, ptyOptions);
            
            activeSessions.set(session.sessionId, session);
            
            // 显示实时输出信息
            log.info(`交互式会话已创建并等待提示符，ID: ${session.sessionId}`);
            
            // 添加对msfconsole会话的特别提示
            let responseMessage: any = {
              status: "success",
              session_id: session.sessionId,
              initial_output: session.stdout,
              waiting_for_input: session.isWaitingForInput
            };
            
            log.info(`输入状态: ${session.isWaitingForInput ? '等待输入' : '不等待输入'}`);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify(responseMessage)
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
            
            // 等待新输出或新的输入提示符
            const newOutput = await new Promise<{ output: string; waitingForInput: boolean }>((resolve) => {
              // 创建一个等待输入状态变化的处理器
              const inputStateHandler = (waiting: boolean) => {
                const newText = session.stdout.substring(beforeLength);
                resolve({ output: newText, waitingForInput: waiting });
              };
              
              // 先等待1秒，看是否有新输出
              setTimeout(() => {
                const newText = session.stdout.substring(beforeLength);
                
                if (newText.length > 0) {
                  // 有新输出，检查是否在等待输入
                  resolve({ output: newText, waitingForInput: session.isWaitingForInput });
                  return;
                }
                
                // 如果没有新输出，开始监听输入状态变化
                session.once('input-state-change', inputStateHandler);
                
                // 再次等待2秒
                setTimeout(() => {
                  // 移除监听器
                  session.removeListener('input-state-change', inputStateHandler);
                  // 无论如何返回当前状态
                  resolve({ 
                    output: session.stdout.substring(beforeLength),
                    waitingForInput: session.isWaitingForInput
                  });
                }, 2000);
              }, 1000);
            });
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  new_output: stripAnsiCodes(newOutput.output),
                  waiting_for_input: newOutput.waitingForInput
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
          
          // 增加上次获取输出的时间记录
          if (!(session as any).lastOutputFetch) {
            (session as any).lastOutputFetch = 0;
            (session as any).lastOutputLength = 0;
          }
          
          // 检查是否有新输出
          const now = Date.now();
          const timeSinceLastFetch = now - (session as any).lastOutputFetch;
          const hasNewOutput = session.stdout.length > (session as any).lastOutputLength;
          
          // 更新获取时间和长度
          (session as any).lastOutputFetch = now;
          (session as any).lastOutputLength = session.stdout.length;
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "success",
                stdout: session.stdout,
                stderr: session.stderr,
                has_new_output: hasNewOutput,
                time_since_last_fetch_ms: timeSinceLastFetch,
                waiting_for_input: session.isWaitingForInput
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
      
      // 执行msfconsole测试命令，替换ls -al命令
      // log.info(`=== 启动msfconsole测试会话 ===`);
      // try {
      //   // 使用交互式会话方式创建msfconsole
      //   const ptyOptions = {
      //     waitForPrompt: true,
      //     maxWaitTime: 60000, // 增加等待时间，msfconsole启动较慢（1分钟）
      //     forcePty: true,
      //     term: "xterm-256color",
      //     cols: 100,
      //     rows: 40
      //   };
        
      //   log.info(`正在启动msfconsole，请稍候...这可能需要几十秒时间`);
      //   const testSession = await commandExecutor.createInteractiveSession("msfconsole -q", ptyOptions);
      //   log.info(`msfconsole测试会话创建成功，ID: ${testSession.sessionId}`);
        
      //   // 展示初始输出详情，帮助调试
      //   const initialOutput = testSession.stdout;
      //   log.info(`初始输出长度: ${initialOutput.length} 字节`);
      //   log.info(`初始输出前200字符:\n${initialOutput.substring(0, 200)}`);
      //   log.info(`初始输出末尾200字符:\n${initialOutput.substring(Math.max(0, initialOutput.length - 200))}`);
      //   log.info(`输入状态: ${testSession.isWaitingForInput ? '等待输入' : '不等待输入'}`);
        
      //   // 等待更长时间，确保msfconsole完全加载
      //   await new Promise(resolve => setTimeout(resolve, 5000));
      //   log.info(`等待5秒后的输出长度: ${testSession.stdout.length} 字节`);
        
      //   // 执行几个简单的msfconsole命令来测试交互
      //   log.info(`发送msfconsole命令: version`);
      //   testSession.write("version\n");
        
      //   // 等待命令执行完成
      //   await new Promise(resolve => setTimeout(resolve, 3000));
        
      //   // 获取当前输出并分析msf>提示符
      //   const outputAfterVersion = testSession.stdout;
      //   log.info(`命令执行后的输出长度: ${outputAfterVersion.length} 字节`);
        
      //   // 检查提示符
      //   const lines = outputAfterVersion.split('\n');
      //   const lastFewLines = lines.slice(-5).join('\n'); // 获取最后5行
      //   log.info(`最后几行输出:\n${lastFewLines}`);
        
      //   // 检测msf提示符
      //   const hasMsfPrompt = /msf\d*\s*>\s*$/m.test(lastFewLines);
      //   log.info(`是否检测到MSF提示符: ${hasMsfPrompt}`);
        
      //   // 再执行一个命令
      //   log.info(`发送msfconsole命令: help`);
      //   testSession.write("help\n");
        
      //   // 等待命令执行完成
      //   await new Promise(resolve => setTimeout(resolve, 3000));
        
      //   // 获取最终结果
      //   const finalOutput = testSession.stdout;
      //   log.info(`输出总长度: ${finalOutput.length} 字节`);
      //   log.info(`输出最后300字符:\n${finalOutput.substring(Math.max(0, finalOutput.length - 300))}`);
      //   log.info(`最终状态: ${testSession.isWaitingForInput ? '等待输入' : '不等待输入'}`);
        
      //   // 检测总结
      //   log.info(`======= msfconsole测试结果总结 =======`);
      //   log.info(`1. 会话创建：${testSession ? '成功' : '失败'}`);
      //   log.info(`2. 输出捕获：${finalOutput.length > 0 ? '成功' : '失败'} (${finalOutput.length} 字节)`);
      //   log.info(`3. 提示符检测：${hasMsfPrompt ? '成功' : '失败'}`);
      //   log.info(`4. 输入状态：${testSession.isWaitingForInput ? '等待输入' : '不等待输入'}`);
      //   log.info(`=======================================`);
        
      //   // 关闭测试会话
      //   testSession.close();
      //   log.info(`msfconsole测试会话已关闭`);
      // } catch (error) {
      //   log.error(`msfconsole测试失败: ${error instanceof Error ? error.message : String(error)}`);
      //   // 继续执行，不要因为msfconsole测试失败而终止程序
      // }
      
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
