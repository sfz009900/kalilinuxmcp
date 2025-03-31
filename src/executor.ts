import { NodeSSH } from 'node-ssh';
import * as fs from 'fs';
import { log } from './index.js';

/**
 * 移除ANSI转义序列
 * 这些序列用于终端颜色和格式化,但在API输出中不需要
 */
function stripAnsiCodes(str: string): string {
  // 匹配所有ANSI转义序列
  return str.replace(/\x1B\[\d+m|\x1B\[\d+;\d+m|\x1B\[\d+;\d+;\d+m/g, '');
}

// SSH执行器，使用node-ssh库
export class CommandExecutor {
  private ssh: NodeSSH = new NodeSSH();
  public isConnected: boolean = false;
  
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
   * 断开SSH连接
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      log.info('断开SSH连接');
      this.ssh.dispose();
      this.isConnected = false;
    }
  }
}