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

/**
 * 检测输出是否在等待用户输入
 * 通过检查输出中的常见提示符和特定模式来判断
 */
function isWaitingForInput(output: string): boolean {
  if (!output || output.trim() === '') {
    return false;
  }

  // 检查常见的命令行提示符
  const lines = output.split('\n');
  // 获取最后20行非空文本，某些程序可能会有很长的输出
  const lastLines = lines.filter(line => line.trim().length > 0).slice(-20);
  const lastLine = lastLines.length > 0 ? lastLines[lastLines.length - 1] : '';
  const cleanLine = stripAnsiCodes(lastLine.trim());
  
  // 检查是否包含msfconsole的启动文本
  const isMsfconsole = output.includes('Metasploit Framework') || 
                       output.includes('msf') || 
                       output.includes('Call trans opt:');

  // 在日志中记录最后几行，帮助调试
  log.debug(`检测输入提示符，最后一行: "${cleanLine}"`);
  if (isMsfconsole) {
    log.debug(`检测到可能是msfconsole，输出前100个字符: "${output.substring(0, 100)}"`);
  }
  
  // 常见的提示符模式
  const promptPatterns = [
    /[\$#>]\s*$/,              // 常见的shell提示符: $, #, > 
    /password[: ]*$/i,         // 密码提示
    /continue\? \[(y\/n)\]/i,  // 继续提示
    /\[\?\]\s*$/,              // 问号提示
    /输入.*[:：]/,              // 中文输入提示
    /please enter.*:/i,        // 英文输入提示
    /press.*to continue/i,     // 按键继续提示
    /Enter\s*.*:/i,            // Enter提示
    /\(.*\)\s*$/,              // 括号内选择提示，如 (Y/n)
    /\s+y\/n\s*$/i,            // y/n选择
    /msf[56]?\s*>\s*$/,       // msf提示符，支持msf、msf5、msf6等
    /mysql>\s*$/,              // mysql提示符
    /sqlite>\s*$/,             // sqlite提示符
    /ftp>\s*$/,                // ftp提示符
    /postgres=#\s*$/,          // postgres提示符
    /Press RETURN to continue/, // 按回车继续
    /waiting for input/i        // 通用等待输入文本
  ];
  
  // msfconsole特殊处理 - 如果输出包含Metasploit相关内容，并且有一段时间没有更新
  if (isMsfconsole) {
    // 对于msfconsole，如果输出包含特定文本并且最近没有新数据，很可能是在等待输入
    return true;
  }
  
  // 检查最后一行是否匹配任何提示符模式
  return promptPatterns.some(pattern => pattern.test(cleanLine));
}

// 定义交互式会话事件类型
export interface InteractiveSession extends EventEmitter {
  stdin: NodeJS.WritableStream;
  stdout: string;
  stderr: string;
  sessionId: string;
  isWaitingForInput: boolean;
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
      waitForPrompt?: boolean; // 是否等待提示符后再返回
      maxWaitTime?: number;    // 最大等待时间(毫秒)
    } = {}
  ): Promise<InteractiveSession> {
    if (!this.isConnected || !this.sshClient) {
      throw new Error('SSH未连接，请先调用connect方法');
    }
    
    const { 
      cwd = '/', 
      env = {}, 
      waitForPrompt = true, 
      maxWaitTime = 30000 // 默认最大等待30秒
    } = options;
    
    try {
      log.info(`创建交互式会话: ${command}`);
      
      // 创建环境变量设置
      let envSettings = Object.entries(env)
        .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join('; ');
      
      // 为交互式终端添加必要的环境变量
      const defaultEnvSettings = [
        'export TERM=xterm-256color',
        'export COLUMNS=80',
        'export LINES=24',
        'export PS1="\\u@\\h:\\w\\$ "'
      ].join('; ');
      
      envSettings = envSettings ? `${envSettings}; ${defaultEnvSettings}` : defaultEnvSettings;
      
      // 特殊命令处理
      let processedCommand = command;
      
      // 对于msfconsole等命令，添加特殊处理
      if (command.includes('msfconsole')) {
        log.info('检测到msfconsole命令，添加特殊处理');
        // 不再添加version命令，让它自然启动并等待真正的提示符
        processedCommand = `${command} -q`; // 仅使用安静模式
      }
      
      // 最终命令
      const finalCommand = `cd "${cwd}" && ${envSettings} && ${processedCommand}`;
      
      // 创建会话并配置
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const session = await this.createSessionObject(sessionId, finalCommand);
      
      log.info(`交互式会话创建成功，ID: ${sessionId}`);
      
      // 如果需要等待提示符出现
      if (waitForPrompt) {
        return await this.waitForSessionPrompt(session, command, maxWaitTime);
      }
      
      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`创建交互式会话失败: ${errorMessage}`);
      throw error;
    }
  }
  
  /**
   * 创建会话对象并配置事件处理
   * @private
   */
  private async createSessionObject(sessionId: string, finalCommand: string): Promise<InteractiveSession> {
    // 创建一个会话对象
    const session = new EventEmitter() as InteractiveSession;
    session.stdout = '';
    session.stderr = '';
    session.sessionId = sessionId;
    session.isWaitingForInput = false;
    
    // 设置session的close方法
    session.close = () => {
      if (this.sessions.has(sessionId)) {
        // 实际会话清理在ssh2回调中处理
        session.emit('closing');
        this.sessions.delete(sessionId);
      }
    };
    
    await new Promise<void>((resolve, reject) => {
      // 使用默认选项，只保留pty: true
      this.sshClient!.exec(finalCommand, { 
        pty: true
      }, (err, stream) => {
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
        
        // 检查是否等待输入的标志
        let checkInputTimer: NodeJS.Timeout | null = null;
        
        // 定时检查是否等待输入
        const checkIfWaitingForInput = () => {
          // 检查输出是否在等待用户输入
          const waiting = isWaitingForInput(session.stdout);
          
          // 如果状态改变，发出事件
          if (waiting !== session.isWaitingForInput) {
            session.isWaitingForInput = waiting;
            session.emit('input-state-change', waiting);
            
            if (waiting) {
              session.emit('waiting-for-input', session.stdout);
              log.debug(`[会话 ${sessionId}] 检测到命令等待用户输入`);
            }
          }
          
          // 继续检查
          checkInputTimer = setTimeout(checkIfWaitingForInput, 100);
        };
        
        // 开始检查是否等待输入
        checkIfWaitingForInput();
        
        // 处理输出流 - 使用更可靠的数据处理
        stream.on('data', (data: Buffer) => {
          const output = data.toString();
          session.stdout += output;
          
          // 对msfconsole启动时的大量输出进行处理
          // 不记录太大的输出块，避免日志过多
          if (output.length < 100) {
            log.debug(`[会话 ${sessionId}] 输出: ${output.trim()}`);
          } else {
            log.debug(`[会话 ${sessionId}] 输出较长: 长度=${output.length}, 前50个字符: ${output.substring(0, 50).trim()}...`);
          }
          
          session.emit('output', output);
          
          // 立即检查是否等待输入
          const waiting = isWaitingForInput(session.stdout);
          if (waiting !== session.isWaitingForInput) {
            session.isWaitingForInput = waiting;
            log.debug(`[会话 ${sessionId}] 输入状态变化: ${waiting ? '等待输入' : '不等待输入'}`);
            session.emit('input-state-change', waiting);
            
            if (waiting) {
              session.emit('waiting-for-input', session.stdout);
              log.info(`[会话 ${sessionId}] 检测到命令等待用户输入`);
            }
          }
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
          if (checkInputTimer) {
            clearTimeout(checkInputTimer);
          }
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
          if (checkInputTimer) {
            clearTimeout(checkInputTimer);
          }
          stream.end();
        });
        
        // 会话创建成功
        this.sessions.set(sessionId, session);
        resolve();
      });
    });
    
    return session;
  }
  
  /**
   * 等待会话出现输入提示符
   * @private
   */
  private async waitForSessionPrompt(
    session: InteractiveSession, 
    command: string, 
    maxWaitTime: number
  ): Promise<InteractiveSession> {
    return new Promise<InteractiveSession>((resolve, reject) => {
      // 对于慢启动的命令设置更长的等待时间，但不再主动发送回车
      const actualMaxWaitTime = command.includes('msfconsole') ? maxWaitTime * 3 : maxWaitTime;
      
      const timeoutId = setTimeout(() => {
        log.info(`会话 ${session.sessionId} 等待提示符超时，直接返回`);
        
        // 对于特定的命令，尝试看最后一行是否可以被当作提示符
        if (command.includes('msfconsole')) {
          // 检查输出中是否包含任何Metasploit相关文本
          const hasMetasploitOutput = session.stdout.includes('Metasploit') || 
                                     session.stdout.includes('msf') ||
                                     session.stdout.includes('exploit');
          
          if (hasMetasploitOutput) {
            // 如果有Metasploit相关的输出，认为它在等待输入
            session.isWaitingForInput = true;
            log.info('检测到msfconsole有输出，认为它在等待输入');
          }
        }
        
        resolve(session);
      }, actualMaxWaitTime);
      
      // 等待输入状态变化
      const waitForInputHandler = () => {
        clearTimeout(timeoutId);
        log.info(`会话 ${session.sessionId} 已准备好接收输入`);
        resolve(session);
      };
      
      // 如果已经在等待输入，直接返回
      if (session.isWaitingForInput) {
        clearTimeout(timeoutId);
        resolve(session);
        return;
      }
      
      // 添加等待输入事件处理
      session.once('waiting-for-input', waitForInputHandler);
      
      // 添加错误处理
      session.once('error', (err) => {
        clearTimeout(timeoutId);
        session.removeListener('waiting-for-input', waitForInputHandler);
        reject(err);
      });
      
      // 添加关闭处理
      session.once('close', () => {
        clearTimeout(timeoutId);
        session.removeListener('waiting-for-input', waitForInputHandler);
        resolve(session); // 会话已关闭，直接返回
      });
    });
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