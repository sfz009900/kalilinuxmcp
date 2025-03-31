import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class SSHManager {
  private client: Client | null = null;
  private connection: Promise<void> | null = null;
  private timeout: NodeJS.Timeout | null = null;
  private sessionTimeout: number = 20 * 60 * 1000; // 20 minutes

  constructor() {
    this.client = new Client();
  }

  async connect(host: string): Promise<void> {
    if (this.connection) {
      return this.connection;
    }

    const privateKey = fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_rsa'));

    this.connection = new Promise((resolve, reject) => {
      this.client = new Client();
      this.client
        .on('ready', () => {
          this.resetTimeout();
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        })
        .connect({
          host: host,
          username: 'weidwonder',
          privateKey: privateKey,
        });
    });

    return this.connection;
  }

  private resetTimeout(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(async () => {
      console.log('SSH session timeout, disconnecting');
      await this.disconnect();
    }, this.sessionTimeout);
  }

  async executeCommand(host: string, command: string, env: Record<string, string> | {} = {}): Promise<{stdout: string; stderr: string}> {
    if (!this.client) {
      await this.connect(host);
    }
    this.resetTimeout();

    return new Promise((resolve, reject) => {
      // 使用完整的shell路径，以交互式登录模式执行命令
      // 这更接近于用户直接SSH登录的体验
      
      // 构建环境变量设置命令
      const envSetup = Object.entries(env as Record<string, string>)
        .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join(' && ');
      
      // 如果有环境变量，先设置环境变量，再执行命令
      const fullCommand = envSetup ? `${envSetup} && ${command}` : command;
      
      this.client?.exec(`/bin/bash --login -c "${fullCommand}"`, (err, stream) => {
        if (err) {
          reject(err);
          return
        }

        let stdout = ""
        let stderr = '';

        stream
          .on("data", (data: Buffer) => {
            this.resetTimeout();
            stdout += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          })
          .on('close', () => {
            resolve({ stdout, stderr });
          })
          .on('error', (err) => {
            reject(err);
          });
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connection = null;
    }
  }
}