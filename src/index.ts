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
import { CommandExecutor } from "./executor.js";

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
          description: "在Kali Linux渗透测试环境中执行命令。支持所有Kali Linux内置的安全测试工具和常规Linux命令。",
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
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    try {
      if (request.params.name !== "execute_command") {
        throw new McpError(ErrorCode.MethodNotFound, "未知工具");
      }
      
      const command = String(request.params.arguments?.command);
      if (!command) {
        throw new McpError(ErrorCode.InvalidParams, "命令是必需的");
      }
      const env = {};
      const timeout = 30000000;

      try {
        // 详细记录请求信息
        log.info(`准备执行命令: ${command}`);
        log.debug(`连接配置: host=${KALI_CONFIG.host}, port=${KALI_CONFIG.port}, user=${KALI_CONFIG.username}`);
        log.debug(`命令超时设置: ${timeout}毫秒`);
        
        // 确保已连接
        if (!commandExecutor.isConnected) {
          await commandExecutor.connect({
            host: KALI_CONFIG.host,
            port: KALI_CONFIG.port,
            username: KALI_CONFIG.username,
            privateKeyPath: KALI_CONFIG.privateKeyPath
          });
        }

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
        const errorStack = error instanceof Error && error.stack ? error.stack : "无堆栈信息";
        
        log.error(`SSH命令执行失败: ${errorMessage}`);
        log.debug(`错误堆栈: ${errorStack}`);
        
        // 提供友好的错误提示
        let errorDetails = errorMessage;
        if (errorMessage.includes('ECONNREFUSED')) {
          errorDetails = `SSH连接被拒绝 (端口${KALI_CONFIG.port}): 请确认SSH服务正在运行。您可以在系统中运行: sudo service ssh start`;
        } else if (errorMessage.includes('authentication')) {
          errorDetails = `SSH认证失败: 用户名(${KALI_CONFIG.username})或私钥不正确`;
        } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
          errorDetails = `命令执行或连接超时: 请确认命令是否需要更长的时间来执行`;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `无法执行Kali Linux命令: ${errorDetails}`
        );
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
