import { NodeSSH } from 'node-ssh';
import * as ssh2 from 'ssh2';
import * as fs from 'fs';
import { log } from './index.js';
import { EventEmitter } from 'events';

/**
 * 移除ANSI转义序列
 * 这些序列用于终端颜色和格式化,但在API输出中不需要
 */
function stripAnsiCodes(str: string): string {
  // 匹配所有ANSI转义序列
  return str.replace(/\x1B\[\d+m|\x1B\[\d+;\d+m|\x1B\[\d+;\d+;\d+m/g, '');
}

// 定义交互式会话事件类型
export interface InteractiveSession extends EventEmitter {
  stdin: NodeJS.WritableStream;
  stdout: string;
  stderr: string;
  sessionId: string;
  write(data: string): void;
  close(): void;
}

// SSH执行器，使用node-ssh库和ssh2
export class CommandExecutor {
  private ssh: NodeSSH = new NodeSSH();
  private sshClient: ssh2.Client | null = null;
  public isConnected: boolean = false;
  private sessions: Map<string, InteractiveSession> = new Map();
  
  constructor() {}

  /**
   * 连接到SSH服务器
   */
  async connect(options: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
  }): Promise<void> {
    if (this.isConnected) {
      log.info('已经连接到SSH服务器，重用现有连接');
      return;
    }

    try {
      const { host, port, username, privateKeyPath, password } = options;
      
      log.info(`连接到SSH服务器: ${username}@${host}:${port}`);
      
      // 构建连接配置
      const sshConfig: any = {
        host,
        port,
        username,
        keepaliveInterval: 60000 // 每分钟发送一次keepalive包
      };
      
      // 优先使用私钥认证
      if (privateKeyPath) {
        log.debug(`使用私钥认证: ${privateKeyPath}`);
        try {
          sshConfig.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        } catch (error) {
          throw new Error(`无法读取SSH私钥文件: ${privateKeyPath}`);
        }
      } else if (password) {
        log.debug('使用密码认证');
        sshConfig.password = password;
      } else {
        throw new Error('必须提供私钥或密码进行认证');
      }
      
      // 连接到服务器
      await this.ssh.connect(sshConfig);
      
      // 同时准备ssh2客户端供交互式会话使用
      this.sshClient = new ssh2.Client();
      
      await new Promise<void>((resolve, reject) => {
        this.sshClient!.on('ready', () => {
          log.info('SSH2交互式客户端准备就绪');
          resolve();
        }).on('error', (err) => {
          log.error('SSH2交互式客户端错误:', err);
          reject(err);
        }).connect({
          host,
          port,
          username,
          privateKey: privateKeyPath ? fs.readFileSync(privateKeyPath, 'utf8') : undefined,
          password: password
        });
      });
      
      this.isConnected = true;
      log.info('SSH连接成功');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`SSH连接失败: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 在SSH服务器上执行命令
   */
  async executeCommand(
    command: string,
    options: {
      timeout?: number; // 命令执行超时时间(毫秒)
      cwd?: string; // 工作目录
      env?: Record<string, string>; // 环境变量
    } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const { timeout = 30000000, cwd = '/', env = {} } = options;
    
    if (!this.isConnected) {
      throw new Error('SSH未连接，请先调用connect方法');
    }
    
    try {
      log.info(`执行命令: ${command}`);
      log.debug(`命令超时: ${timeout}ms, 工作目录: ${cwd}`);
      
      // 如果有环境变量，构建环境变量设置命令
      let execCommand = command;
      if (Object.keys(env).length > 0) {
        const envSetup = Object.entries(env)
          .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"`)
          .join(' && ');
        execCommand = `${envSetup} && ${command}`;
      }
      
      // 执行命令，带超时控制
      const result = await Promise.race([
        this.ssh.execCommand(execCommand, { cwd }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('命令执行超时'));
          }, timeout);
        })
      ]) as { stdout: string; stderr: string };
      
      log.debug(`命令执行完成，stdout长度: ${result.stdout.length}, stderr长度: ${result.stderr.length}`);
      
      // 清理输出中的ANSI转义序列
      return {
        stdout: stripAnsiCodes(result.stdout),
        stderr: stripAnsiCodes(result.stderr)
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`命令执行失败: ${errorMessage}`);
      
      if (errorMessage.includes('超时')) {
        // 超时情况返回已收集的输出
        return { stdout: '命令执行时间过长，已被中断', stderr: '命令执行超时' };
      }
      
      throw error;
    }
  }

  /**
   * 创建交互式命令会话
   * 返回可用于交互式输入的会话
   */
  async createInteractiveSession(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<InteractiveSession> {
    if (!this.isConnected || !this.sshClient) {
      throw new Error('SSH未连接，请先调用connect方法');
    }
    
    const { cwd = '/', env = {} } = options;
    
    try {
      log.info(`创建交互式会话: ${command}`);
      
      // 创建环境变量设置
      const envSettings = Object.entries(env)
        .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join('; ');
      
      // 最终命令
      const finalCommand = envSettings 
        ? `cd "${cwd}" && ${envSettings} && ${command}`
        : `cd "${cwd}" && ${command}`;
        
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // 创建一个会话对象
      const session = new EventEmitter() as InteractiveSession;
      session.stdout = '';
      session.stderr = '';
      session.sessionId = sessionId;
      
      // 设置session的close方法
      session.close = () => {
        if (this.sessions.has(sessionId)) {
          // 实际会话清理在ssh2回调中处理
          session.emit('closing');
          this.sessions.delete(sessionId);
        }
      };
      
      await new Promise<void>((resolve, reject) => {
        this.sshClient!.exec(finalCommand, { pty: true }, (err, stream) => {
          if (err) {
            log.error(`创建交互式会话错误: ${err.message}`);
            reject(err);
            return;
          }
          
          // 设置输入流
          session.stdin = stream;
          
          // 设置write方法简化输入
          session.write = (data: string) => {
            log.debug(`[会话 ${sessionId}] 发送输入: ${data}`);
            stream.write(data);
          };
          
          // 处理输出流
          stream.on('data', (data: Buffer) => {
            const output = data.toString();
            session.stdout += output;
            log.debug(`[会话 ${sessionId}] 输出: ${output.trim()}`);
            session.emit('output', output);
          });
          
          // 处理错误流
          stream.stderr.on('data', (data: Buffer) => {
            const error = data.toString();
            session.stderr += error;
            log.debug(`[会话 ${sessionId}] 错误: ${error.trim()}`);
            session.emit('stderr', error);
          });
          
          // 处理会话关闭
          stream.on('close', () => {
            log.info(`[会话 ${sessionId}] 会话关闭`);
            this.sessions.delete(sessionId);
            session.emit('close');
          });
          
          // 处理错误
          stream.on('error', (err: Error) => {
            log.error(`[会话 ${sessionId}] 会话错误: ${err.message}`);
            session.emit('error', err);
          });
          
          // 关闭时清理流
          session.on('closing', () => {
            stream.end();
          });
          
          // 会话创建成功
          this.sessions.set(sessionId, session);
          resolve();
        });
      });
      
      log.info(`交互式会话创建成功，ID: ${sessionId}`);
      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`创建交互式会话失败: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 断开SSH连接
   */
  async disconnect(): Promise<void> {
    // 先关闭所有活跃会话
    for (const [sessionId, session] of this.sessions.entries()) {
      log.info(`关闭会话: ${sessionId}`);
      session.close();
    }
    
    if (this.sshClient) {
      log.info('断开SSH2客户端连接');
      this.sshClient.end();
      this.sshClient = null;
    }
    
    if (this.isConnected) {
      log.info('断开NodeSSH连接');
      this.ssh.dispose();
      this.isConnected = false;
    }
  }
}