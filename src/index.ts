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

// 实时推送配置
const realtimePusherConfig = {
  viewerUrl: process.env.REALTIME_VIEWER_URL || 'http://localhost:3000',
  enabled: process.env.REALTIME_PUSH_ENABLED === 'true' || false
};

const commandExecutor = new CommandExecutor(realtimePusherConfig);

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
          description: "(需要交互式比如mysql -u root -p)在Kali Linux环境中启动一个交互式命令，并返回会话ID。交互式命令可以接收用户输入,可以在不close_interactive_command的情况下同时执行execute_command。",
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
        },
        {
          name: "configure_realtime_viewer",
          description: "配置实时命令输出查看器。可以启用/禁用实时推送功能，或查看当前状态。",
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["enable", "disable", "status", "configure"],
                description: "操作类型：enable(启用), disable(禁用), status(查看状态), configure(配置)"
              },
              viewer_url: {
                type: "string",
                description: "实时查看器的URL地址，仅在action为configure时需要"
              }
            },
            required: ["action"]
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
            
            // 执行命令，启用实时推送
            const result = await commandExecutor.executeCommand(command, {
              timeout: timeout,
              env: env as Record<string, string>,
              enableRealtime: true
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
            
            // 检查当前命令是否包含msf且输入为exit
            if ((global as any).currentInteractiveCommand.includes('msf') && input.trim() === 'exit') {
              log.info(`检测到用户退出msfconsole命令`);
              (global as any).currentInteractiveCommand = 'exit';
            }
            
            // 记录输入前的输出长度
            const beforeLength = session.stdout.length;
            
            // 发送输入，根据需要添加换行符
            session.write(endLine ? `${input}\n` : input);
            
            // 等待命令执行完成并出现输入提示
            const maxWaitTime = 3000000; // 较长等待时间(50分钟)
            
            // 使用Promise等待输入状态变为true
            await new Promise<void>((resolve, reject) => {
              // 如果已经是等待输入状态，立即解析
              if (session.isWaitingForInput) {
                resolve();
                return;
              }
              
              // 等待"waiting-for-input"事件
              const waitHandler = () => {
                clearTimeout(timeoutId);
                resolve();
              };
              
              // 设置超时
              const timeoutId = setTimeout(() => {
                session.removeListener('waiting-for-input', waitHandler);
                log.info(`等待输入提示超时，已等待${maxWaitTime}毫秒`);
                // 即使超时，也返回当前状态
                resolve();
              }, maxWaitTime);
              
              // 添加事件监听器
              session.once('waiting-for-input', waitHandler);
              
              // 添加错误处理
              session.once('error', (err) => {
                clearTimeout(timeoutId);
                session.removeListener('waiting-for-input', waitHandler);
                reject(err);
              });
              
              // 添加关闭处理
              session.once('close', () => {
                clearTimeout(timeoutId);
                session.removeListener('waiting-for-input', waitHandler);
                resolve(); // 会话已关闭，直接返回
              });
            });
            
            // 获取新输出，从上次输出的位置开始
            if (!(session as any).lastOutputPosition) {
              (session as any).lastOutputPosition = beforeLength;
            }
            const newOutput = session.stdout.substring((session as any).lastOutputPosition);
            // 更新上次输出位置
            (session as any).lastOutputPosition = session.stdout.length;
            
            log.info(`命令执行完成，等待输入状态: ${session.isWaitingForInput}, 新输出长度: ${newOutput.length}`);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  new_output: stripAnsiCodes(newOutput),
                  waiting_for_input: session.isWaitingForInput
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
          }
          
          // 初始化lastOutputPosition(如果还没有的话)
          if (!(session as any).lastOutputPosition) {
            (session as any).lastOutputPosition = 0;
          }

          // 获取新输出
          const newOutput = session.stdout.substring((session as any).lastOutputPosition);
          const hasNewOutput = newOutput.length > 0;
          
          // 更新获取时间和位置
          const now = Date.now();
          const timeSinceLastFetch = now - (session as any).lastOutputFetch;
          (session as any).lastOutputFetch = now;
          (session as any).lastOutputPosition = session.stdout.length;
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "success",
                stdout: stripAnsiCodes(newOutput), // 只返回新的输出
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

        // 配置实时查看器
        case "configure_realtime_viewer": {
          const action = String(request.params.arguments?.action);
          const viewerUrl = request.params.arguments?.viewer_url;

          if (!action) {
            throw new McpError(ErrorCode.InvalidParams, "操作类型是必需的");
          }

          try {
            switch (action) {
              case "enable":
                commandExecutor.setRealtimePushEnabled(true);
                log.info("实时推送已启用");
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({
                      status: "success",
                      message: "实时推送已启用",
                      config: commandExecutor.getRealtimePusherStatus()
                    })
                  }]
                };

              case "disable":
                commandExecutor.setRealtimePushEnabled(false);
                log.info("实时推送已禁用");
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({
                      status: "success",
                      message: "实时推送已禁用",
                      config: commandExecutor.getRealtimePusherStatus()
                    })
                  }]
                };

              case "status":
                const status = commandExecutor.getRealtimePusherStatus();
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({
                      status: "success",
                      enabled: status.enabled,
                      activeSessionCount: status.activeSessionCount,
                      viewerUrl: status.config.viewerUrl,
                      message: `实时推送${status.enabled ? '已启用' : '已禁用'}，活跃会话数: ${status.activeSessionCount}`
                    })
                  }]
                };

              case "configure":
                if (!viewerUrl) {
                  throw new McpError(ErrorCode.InvalidParams, "配置操作需要提供viewer_url参数");
                }
                commandExecutor.configureRealtimePusher({
                  viewerUrl: String(viewerUrl),
                  enabled: true
                });
                log.info(`实时查看器URL已配置为: ${viewerUrl}`);
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({
                      status: "success",
                      message: `实时查看器已配置并启用`,
                      config: commandExecutor.getRealtimePusherStatus()
                    })
                  }]
                };

              default:
                throw new McpError(ErrorCode.InvalidParams, `未知操作类型: ${action}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`配置实时查看器失败: ${errorMessage}`);
            throw new McpError(
              ErrorCode.InternalError,
              `无法配置实时查看器: ${errorMessage}`
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
