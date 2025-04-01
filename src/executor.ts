import { NodeSSH } from 'node-ssh';
import * as ssh2 from 'ssh2';
import * as fs from 'fs';
import { log } from './index.js';
import { EventEmitter } from 'events';
import { ClientChannel, ConnectConfig, ExecOptions } from 'ssh2';

/**
 * 移除ANSI转义序列
 * 这些序列用于终端颜色和格式化,但在API输出中不需要
 */
function stripAnsiCodes(str: string): string {
  // 更完整的ANSI转义序列匹配模式
  return str.replace(
    /(\x1B\[[0-9;]*[a-zA-Z])|(\x1B\].*?\x07)|(\x1B\[\?[0-9;]*[a-zA-Z])|(\x1B\[[0-9]+[a-zA-Z])/g,
    ''
  );
}

/**
 * 检测输出是否在等待用户输入
 * 通过检查输出中的常见提示符和特定模式来判断
 */
function isWaitingForInput(output: string): boolean {
  // 检查是否有全局重载函数，如果有则使用它
  if ((global as any).overrideWaitingCheck) {
    return (global as any).overrideWaitingCheck(output);
  }
  
  if (!output || output.trim() === '') {
    return false;
  }

  // 首先移除所有ANSI转义序列，确保检查的是纯文本内容
  const cleanOutput = stripAnsiCodes(output);
  
  // 检查常见的命令行提示符
  const lines = cleanOutput.split('\n');
  // 获取最后20行非空文本，某些程序可能会有很长的输出
  const lastLines = lines.filter(line => line.trim().length > 0).slice(-20);
  const lastLine = lastLines.length > 0 ? lastLines[lastLines.length - 1] : '';
  const cleanLine = lastLine.trim();
  
  // 检查是否包含msfconsole的启动文本或特殊提示符
  const isMsfconsole = cleanOutput.includes('Metasploit Framework') || 
                       cleanOutput.includes('msf') || 
                       cleanOutput.includes('Call trans opt:') ||
                       /msf\d*\s*>\s*$/i.test(cleanLine); // 检查msf>提示符
  
  // 在日志中记录最后几行，帮助调试
  // log.debug(`检测输入提示符，最后一行: "${cleanLine}"`);
  if (isMsfconsole) {
    // log.debug(`检测到可能是msfconsole，最后一行: "${cleanLine}", 输出前100个字符: "${cleanOutput.substring(0, 100)}"`);
    
    // 对于msfconsole，最近的几行中如果包含msf>提示符，很可能是在等待输入
    const lastFewLines = lastLines.join('\n');
    
    // 特别检查msf提示符的多种情况
    if (/msf\d*\s*>\s*$/im.test(lastFewLines) || 
        cleanLine.trim() === 'msf >' || 
        cleanLine.trim() === 'msf>' ||
        cleanLine.trim() === 'msf5 >' || 
        cleanLine.trim() === 'msf6 >') {
      // log.debug('检测到msfconsole提示符 msf>，判定为等待输入');
      return true;
    }
    
    // 如果输出中包含metasploit相关的文本且最后一行看起来像是提示符，也认为在等待输入
    if (cleanLine.endsWith('>') || cleanLine.endsWith('#') || cleanLine.endsWith('$')) {
      // log.debug('检测到msf相关内容且最后一行是提示符，判定为等待输入');
      return true;
    }
    
    // 如果最后一次输出已经过去很长时间，也认为是在等待输入
    const timeWithoutNewOutput = Date.now() - (global as any).lastMsfOutput || 0;
    if (timeWithoutNewOutput > 5000) { // 5秒没有新输出
      // log.debug(`msfconsole已${timeWithoutNewOutput/1000}秒无新输出，判定为等待输入`);
      return true;
    }
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
    /msf[56]?\s*>\s*$/i,       // msf提示符，支持msf、msf5、msf6等（更精确的正则）
    /mysql>\s*$/,              // mysql提示符
    /sqlite>\s*$/,             // sqlite提示符
    /ftp>\s*$/,                // ftp提示符
    /postgres=#\s*$/,          // postgres提示符
    /Press RETURN to continue/, // 按回车继续
    /waiting for input/i        // 通用等待输入文本
  ];
  
  // 检查最后一行是否匹配任何提示符模式
  for (const pattern of promptPatterns) {
    if (pattern.test(cleanLine)) {
      log.debug(`匹配到提示符模式 ${pattern}，判定为等待输入`);
      return true;
    }
  }
  
  // 如果都不匹配，则默认不是在等待输入
  return false;
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
      forcePty?: boolean;      // 是否强制分配PTY
      term?: string;           // 终端类型
      cols?: number;           // 终端列数
      rows?: number;           // 终端行数
    } = {}
  ): Promise<InteractiveSession> {
    if (!this.isConnected || !this.sshClient) {
      throw new Error('SSH未连接，请先调用connect方法');
    }
    
    const { 
      cwd = '/', 
      env = {}, 
      waitForPrompt = true, 
      maxWaitTime = 3000000, // 默认最大等待30秒
      forcePty = false,      // 默认不强制PTY
      term = 'xterm-256color', // 默认终端类型
      cols = 80,             // 默认终端列数
      rows = 24              // 默认终端行数
    } = options;
    
    try {
      log.info(`创建交互式会话: ${command}`);
      
      // 创建环境变量设置
      let envSettings = Object.entries(env)
        .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join('; ');
      
      // 为交互式终端添加必要的环境变量
      const defaultEnvSettings = [
        `export TERM=${term}`,
        `export COLUMNS=${cols}`,
        `export LINES=${rows}`,
        'export PS1="\\u@\\h:\\w\\$ "'
      ].join('; ');
      
      envSettings = envSettings ? `${envSettings}; ${defaultEnvSettings}` : defaultEnvSettings;
      
      // 特殊命令处理
      let processedCommand = command;
      
      // 对于msfconsole等命令，添加特殊处理
      if (command.includes('msfconsole')) {
        log.info('检测到msfconsole命令，添加特殊处理');
        // 确保使用安静模式启动
        if (!processedCommand.includes('-q')) {
          processedCommand = `${processedCommand} -q`; 
        }
        log.info(`处理后的msfconsole命令: ${processedCommand}`);
      }
      
      // 最终命令
      const finalCommand = `cd "${cwd}" && ${envSettings} && ${processedCommand}`;
      
      // 创建会话并配置
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // 传递PTY相关参数到createSessionObject
      const session = await this.createSessionObject(sessionId, finalCommand, {
        forcePty,
        term,
        cols,
        rows
      });
      
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
  private async createSessionObject(
    sessionId: string, 
    finalCommand: string, 
    ptyOptions: {
      forcePty?: boolean;
      term?: string;
      cols?: number;
      rows?: number;
    } = {}
  ): Promise<InteractiveSession> {
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
    
    // 保存this引用以在内部函数中使用
    const self = this;
    
    // 从finalCommand中提取实际命令，用于后面判断
    const actualCommand = finalCommand.split('&&').pop()?.trim() || finalCommand;
    const isMsfconsole = actualCommand.includes('msfconsole');
    
    await new Promise<void>((resolve, reject) => {
      // 始终为交互式会话分配 PTY
      const execOptions: ExecOptions = { 
        pty: true,
        // 移除不支持的属性，通过环境变量设置
      };
      
      // 设置环境变量来配置终端
      const termEnv = {
        TERM: ptyOptions.term || 'xterm-256color',
        COLUMNS: String(ptyOptions.cols || 80),
        LINES: String(ptyOptions.rows || 24)
      };
      
      // 如果强制使用PTY，尝试使用shell代替exec
      if (ptyOptions.forcePty) {
        log.info(`为会话 ${sessionId} 强制使用PTY并启动shell`);
        
        this.sshClient!.shell(execOptions, (err, stream) => {
          if (err) {
            log.error(`启动shell失败: ${finalCommand}`, err);
            reject(err);
            return;
          }
          
          // 对于msfconsole，需要特殊处理
          if (isMsfconsole) {
            log.info(`检测到msfconsole命令，使用简单方式启动`);
            // 先设置终端环境，然后直接执行msfconsole
            setTimeout(() => {
              // 先清屏，让输出更清晰
              stream.write("clear\n");
              log.debug('发送清屏命令');
              
              // 设置终端环境
              Object.entries(termEnv).forEach(([key, value]) => {
                stream.write(`export ${key}=${value}\n`);
              });
              
              // 延迟后启动msfconsole
              setTimeout(() => {
                // 取消别名影响
                log.debug('发送unalias命令确保使用原始命令');
                stream.write("unalias msfconsole 2>/dev/null\n");
                
                // 使用-q参数启动，减少启动时的输出
                const msfCmd = '/usr/bin/msfconsole -q';  // 使用绝对路径
                log.info(`发送msfconsole启动命令: ${msfCmd}`);
                stream.write(`${msfCmd}\n`);
                
                // 等待msf加载
                log.debug(`正在等待msfconsole初始化...`);
              }, 1000);
            }, 500);
          } else {
            // 非msfconsole命令的处理方式
            setTimeout(() => {
              // 设置终端环境
              Object.entries(termEnv).forEach(([key, value]) => {
                stream.write(`export ${key}=${value}\n`);
              });
              
              // 运行实际命令 - 使用真实命令部分
              setTimeout(() => {
                const extractedCommand = actualCommand;
                log.debug(`发送实际命令: ${extractedCommand}`);
                stream.write(`${extractedCommand}\n`);
              }, 200);
            }, 300);
          }
          
          setupStreamHandlers(stream);
        });
      } else {
        // 使用常规exec方法，但添加环境变量
        // 将环境变量添加到命令前面
        const envPrefix = Object.entries(termEnv)
          .map(([key, value]) => `export ${key}=${value}`)
          .join('; ');
        
        const commandWithEnv = `${envPrefix}; ${finalCommand}`;
        
        this.sshClient!.exec(commandWithEnv, execOptions, (err, stream) => {
          if (err) {
            log.error(`执行命令失败: ${commandWithEnv}`, err);
            reject(err);
            return;
          }
          
          setupStreamHandlers(stream);
        });
      }
      
      // 设置流处理程序的函数
      function setupStreamHandlers(stream: ClientChannel) {
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
          
          // 对于msfconsole输出，记录更多信息用于调试
          if (isMsfconsole) {
            // 记录msfconsole每次输出，帮助调试
            // log.debug(`[MSF输出] 长度=${output.length}, 内容: "${output.trim()}"`);
            
            // 更新最后输出时间戳
            (global as any).lastMsfOutput = Date.now();
            
            // 检查是否包含msf>提示符
            if (output.includes('msf') && output.includes('>')) {
              log.info(`[MSF提示符] 检测到msf>提示符: ${output.trim()}`);
            }
          }
          
          // 添加ANSI转义序列过滤
          const cleanOutput = stripAnsiCodes(output);
          session.stdout += cleanOutput;
          
          // 对msfconsole启动时的大量输出进行处理
          // 不记录太大的输出块，避免日志过多
          if (output.length < 100) {
            log.debug(`[会话 ${sessionId}] 输出: ${output.trim()}`);
          } else {
            log.debug(`[会话 ${sessionId}] 输出较长: 长度=${output.length}, 前50个字符: ${output.substring(0, 50).trim()}...`);
          }
          
          session.emit('output', cleanOutput);
          
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
          // 添加ANSI转义序列过滤
          const cleanError = stripAnsiCodes(error);
          session.stderr += cleanError;
          log.debug(`[会话 ${sessionId}] 错误: ${cleanError.trim()}`);
          session.emit('stderr', cleanError);
        });
        
        // 处理会话关闭
        stream.on('close', () => {
          log.info(`[会话 ${sessionId}] 会话关闭`);
          if (checkInputTimer) {
            clearTimeout(checkInputTimer);
          }
          self.sessions.delete(sessionId);  // 使用外部保存的this引用
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
        self.sessions.set(sessionId, session);  // 使用外部保存的this引用
        resolve();
      }
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
      // 判断是否为msfconsole命令
      const isMsfconsole = command.includes('msfconsole');
      
      // 对于msfconsole设置更长的等待时间
      const actualMaxWaitTime = isMsfconsole ? maxWaitTime * 3 : maxWaitTime;
      
      log.info(`会话 ${session.sessionId} 开始等待输入提示符，最大等待时间: ${actualMaxWaitTime}ms`);
      
      // 如果是msfconsole，需要检测是否显式看到了msf>提示符
      let hasMsfPrompt = false;
      
      // 设置检查器，定期查看是否有msf>提示符出现
      let msfPromptChecker: NodeJS.Timeout | null = null;
      
      // 对于msfconsole命令，必须检测到真正的msf>提示符才认为是准备好了
      if (isMsfconsole) {
        log.info(`为msfconsole会话 ${session.sessionId} 启用严格提示符检测，必须等到真正的msf>提示符出现`);
        
        // 标记此会话为msfconsole会话，这样其他函数可以知道这是特殊会话
        (session as any).isMsfconsoleSession = true;
        
        // 每秒检查一次输出中是否出现msf>提示符
        msfPromptChecker = setInterval(() => {
          const output = session.stdout;
          // 严格检查是否有msf>提示符出现 - 使用更严格的匹配
          if (/msf\d*\s*>\s*$/m.test(output.trim())) {
            hasMsfPrompt = true;
            log.info(`msfconsole会话 ${session.sessionId} 检测到msf>提示符，准备返回`);
            
            // 显示msf>提示符后的最后几行，帮助诊断
            const lines = output.trim().split('\n');
            const lastFewLines = lines.slice(-5).join('\n');
            log.info(`msf>提示符内容: ${lastFewLines}`);
            
            // 清理定时器
            if (msfPromptChecker) {
              clearInterval(msfPromptChecker);
              msfPromptChecker = null;
            }
            
            // 设置等待输入状态并触发事件
            session.isWaitingForInput = true;
            session.emit('input-state-change', true);
            session.emit('waiting-for-input', session.stdout);
            
            // 清理超时定时器并返回会话
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            resolve(session);
          } else {
            // 如果输出中包含shell提示符但不是msf>提示符，说明msfconsole可能还没启动
            if (/root@.*?:\S*?[#$]\s*$/m.test(output.trim())) {
              // 这是普通shell提示符，不是msf>提示符
              log.debug(`检测到普通shell提示符，但不是msf>提示符，继续等待...`);
            }
          }
        }, 1000);
        
        // 普通shell提示符不应触发等待输入事件，覆盖isWaitingForInput检测
        const originalCheckWaiting = isWaitingForInput;
        (global as any).overrideWaitingCheck = function(output: string): boolean {
          // 如果是msfconsole会话，则只有检测到msf>提示符才返回true
          if ((session as any).isMsfconsoleSession) {
            // 检查是否有msf>提示符
            if (/msf\d*\s*>\s*$/m.test(output.trim())) {
              return true;
            }
            // 其他情况返回false，即使是普通shell提示符
            return false;
          }
          
          // 非msfconsole会话使用原来的检测逻辑
          return originalCheckWaiting(output);
        };
      }
      
      // 超时处理
      const timeoutId = setTimeout(() => {
        // 清理msf提示符检查器
        if (msfPromptChecker) {
          clearInterval(msfPromptChecker);
        }
        
        log.info(`会话 ${session.sessionId} 等待提示符超时，已等待 ${actualMaxWaitTime}ms`);
        
        // 对于msfconsole特殊处理
        if (isMsfconsole) {
          // 检查输出中是否包含任何Metasploit相关文本
          const hasMetasploitOutput = session.stdout.includes('Metasploit') || 
                                     session.stdout.includes('msf') ||
                                     session.stdout.includes('exploit') ||
                                     session.stdout.includes('module') ||
                                     session.stdout.includes('framework');
          
          // 如果是msfconsole并且没有检测到明确的提示符，但时间已经超时
          if (!hasMsfPrompt) {
            log.info(`msfconsole会话 ${session.sessionId} 超时，${hasMetasploitOutput ? '检测到Metasploit相关输出' : '未检测到Metasploit输出'}，继续等待...`);
            
            // 记录当前输出状态
            log.info(`当前输出内容最后200字符: ${session.stdout.slice(-200)}`);
            
            // 增加一个额外的等待时间，最多再等待3分钟
            const extraTimeoutId = setTimeout(() => {
              log.info(`msfconsole会话 ${session.sessionId} 额外等待时间结束，强制返回`);
              log.info(`最终输出内容最后300字符: ${session.stdout.slice(-300)}`);
              
              // 如果最后还是没有msf>提示符但有Metasploit相关输出，也设为可输入状态
              if (hasMetasploitOutput) {
                session.isWaitingForInput = true;
                log.info(`尽管没有检测到msf>提示符，但由于有Metasploit相关输出，假设已经可以输入`);
              } else {
                session.isWaitingForInput = false;
                log.info(`没有检测到msf>提示符也没有Metasploit相关输出，假设不可输入`);
              }
              resolve(session);
            }, 180000); // 额外等待3分钟
            
            // 继续检测msf>提示符
            msfPromptChecker = setInterval(() => {
              const output = session.stdout;
              if (/msf\d*\s*>\s*$/m.test(output.trim())) {
                hasMsfPrompt = true;
                log.info(`msfconsole会话 ${session.sessionId} 在额外等待期间检测到msf>提示符`);
                
                // 清理定时器
                clearInterval(msfPromptChecker!);
                clearTimeout(extraTimeoutId);
                
                // 设置等待输入状态
                session.isWaitingForInput = true;
                session.emit('input-state-change', true);
                session.emit('waiting-for-input', session.stdout);
                
                resolve(session);
              }
            }, 1000);
            
            return; // 不立即解析promise，继续等待
          }
        }
        
        // 非msfconsole命令直接返回
        if (!isMsfconsole) {
          // 检查非msfconsole命令的等待输入状态
          const waiting = isWaitingForInput(session.stdout);
          session.isWaitingForInput = waiting;
          
          if (waiting) {
            log.info(`会话 ${session.sessionId} 检测到等待输入状态，超时返回`);
            session.emit('input-state-change', true);
            session.emit('waiting-for-input', session.stdout);
          } else {
            log.info(`会话 ${session.sessionId} 未检测到等待输入状态，超时返回`);
          }
          
          resolve(session);
        } else {
          // 不应该到这里，但如果到了，也返回会话
          log.warn(`msfconsole会话 ${session.sessionId} 处理异常，可能没有正确等待msf>提示符`);
          resolve(session);
        }
      }, actualMaxWaitTime);
      
      // 等待输入状态变化
      const waitForInputHandler = () => {
        // 如果是msfconsole会话，但没有检测到msf>提示符，忽略此事件
        if (isMsfconsole && !hasMsfPrompt) {
          log.debug(`收到waiting-for-input事件但忽略，因为没有检测到msf>提示符`);
          return; // 不处理此事件，继续等待
        }
        
        // 清理msf提示符检查器
        if (msfPromptChecker) {
          clearInterval(msfPromptChecker);
        }
        
        clearTimeout(timeoutId);
        log.info(`会话 ${session.sessionId} 已准备好接收输入`);
        resolve(session);
      };
      
      // 如果已经在等待输入，对于非msfconsole命令直接返回
      if (session.isWaitingForInput && !isMsfconsole) {
        // 清理msf提示符检查器
        if (msfPromptChecker) {
          clearInterval(msfPromptChecker);
        }
        
        clearTimeout(timeoutId);
        resolve(session);
        return;
      }
      
      // 添加等待输入事件处理
      session.once('waiting-for-input', waitForInputHandler);
      
      // 添加错误处理
      session.once('error', (err) => {
        // 清理msf提示符检查器
        if (msfPromptChecker) {
          clearInterval(msfPromptChecker);
        }
        
        clearTimeout(timeoutId);
        session.removeListener('waiting-for-input', waitForInputHandler);
        reject(err);
      });
      
      // 添加关闭处理
      session.once('close', () => {
        // 清理msf提示符检查器
        if (msfPromptChecker) {
          clearInterval(msfPromptChecker);
        }
        
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

export class InteractiveSession extends EventEmitter {
  sessionId: string;
  private stream: ClientChannel | undefined;
  stdout: string = '';
  stderr: string = '';
  isWaitingForInput: boolean = false;
  private promptDetected: boolean = false;
  private waitForPromptResolve: ((value: void | PromiseLike<void>) => void) | null = null;
  private waitForPromptReject: ((reason?: any) => void) | null = null;
  private waitForPromptTimer: NodeJS.Timeout | null = null;

  // 更新正则以包含 msfX > 提示符
  private PROMPT_REGEX = /(\\r?\\n|^)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[^#$>\\s]*\\s?[#$>]|msf\\d+\\s?>)\\s*$/;
  
  constructor(sessionId: string, stream: ClientChannel, initialStdout: string = '') {
    super();
    this.sessionId = sessionId;
    this.stream = stream;
    this.stdout = initialStdout;
  }

  async waitForSessionPrompt(maxWaitTime: number): Promise<void> {
    log.debug(`[${this.sessionId}] Waiting for session prompt, max wait: ${maxWaitTime}ms`);
    return new Promise((resolve, reject) => {
      this.waitForPromptResolve = resolve;
      this.waitForPromptReject = reject;

      // 设置超时
      this.waitForPromptTimer = setTimeout(() => {
        log.warn(`[${this.sessionId}] Wait for prompt timed out after ${maxWaitTime}ms.`);
        // 清理监听器
        if (this.stream) {
          this.stream.removeListener('data', this._promptDataHandler);
          this.stream.removeListener('stderr', this._promptErrorHandler);
        }
        reject(new Error(`Wait for prompt timed out after ${maxWaitTime}ms`));
      }, maxWaitTime);

      // 添加临时监听器来检测提示符
      if (this.stream) {
        this.stream.on('data', this._promptDataHandler);
        this.stream.on('stderr', this._promptErrorHandler);
      }
      
      // 立即检查一次现有输出
      this._checkForPrompt();
    });
  }

  // 用于等待提示符的 data 处理函数
  private _promptDataHandler = (data: Buffer) => {
    const dataStr = data.toString();
    log.debug(`[${this.sessionId}] Raw data during prompt wait: ${dataStr}`); // 记录原始输出
    this.stdout += dataStr;
    this._checkForPrompt();
  };

  // 用于等待提示符的 error 处理函数
  private _promptErrorHandler = (data: Buffer) => {
    const dataStr = data.toString();
    log.debug(`[${this.sessionId}] Raw stderr during prompt wait: ${dataStr}`); // 记录错误输出
    this.stderr += dataStr;
    // 错误也可能包含提示符或者指示已准备就绪，所以也检查
    this._checkForPrompt(); 
  };


  private _checkForPrompt() {
    if (this.promptDetected || !this.waitForPromptResolve) {
      return; // 已经检测到或没有在等待
    }

    // 使用更新后的正则检查输出末尾是否有提示符
    if (this.PROMPT_REGEX.test(this.stdout)) {
      log.info(`[${this.sessionId}] Prompt detected.`);
      this.promptDetected = true;
      this.isWaitingForInput = true; // 假设检测到提示符就表示等待输入
      
      // 清理定时器和监听器
      if (this.waitForPromptTimer) clearTimeout(this.waitForPromptTimer);
      if (this.stream) {
        this.stream.removeListener('data', this._promptDataHandler);
        this.stream.removeListener('stderr', this._promptErrorHandler);
      }

      // 解析 Promise
      this.waitForPromptResolve();
      this.waitForPromptResolve = null;
      this.waitForPromptReject = null;
      
      // 发出状态变化事件
      this.emit('input-state-change', this.isWaitingForInput);
    }
  }
}