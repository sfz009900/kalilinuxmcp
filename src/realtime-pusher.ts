import fetch from 'node-fetch';

export interface RealtimePusherConfig {
  viewerUrl: string;
  enabled: boolean;
}

export class RealtimePusher {
  private config: RealtimePusherConfig;
  private activeSessions: Set<string> = new Set();

  constructor(config: RealtimePusherConfig) {
    this.config = config;
  }

  /**
   * 通知查看器新会话开始
   */
  async notifySessionStart(sessionId: string, command: string): Promise<void> {
    if (!this.config.enabled) return;

    try {
      this.activeSessions.add(sessionId);
      
      const response = await fetch(`${this.config.viewerUrl}/api/session/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          command
        }),
        timeout: 5000 // 5秒超时
      });

      if (!response.ok) {
        console.warn(`通知查看器会话开始失败: ${response.status} ${response.statusText}`);
      } else {
        console.log(`已通知查看器会话开始: ${sessionId}`);
      }
    } catch (error) {
      console.warn(`通知查看器会话开始时发生错误:`, error);
    }
  }

  /**
   * 推送输出到查看器
   */
  async pushOutput(sessionId: string, output: string, isComplete: boolean = false): Promise<void> {
    if (!this.config.enabled || !this.activeSessions.has(sessionId)) return;

    try {
      const response = await fetch(`${this.config.viewerUrl}/api/session/output`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          output,
          isComplete
        }),
        timeout: 5000 // 5秒超时
      });

      if (!response.ok) {
        console.warn(`推送输出到查看器失败: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.warn(`推送输出到查看器时发生错误:`, error);
    }
  }

  /**
   * 通知查看器会话结束
   */
  async notifySessionEnd(sessionId: string): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const response = await fetch(`${this.config.viewerUrl}/api/session/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId
        }),
        timeout: 5000 // 5秒超时
      });

      if (!response.ok) {
        console.warn(`通知查看器会话结束失败: ${response.status} ${response.statusText}`);
      } else {
        console.log(`已通知查看器会话结束: ${sessionId}`);
      }
    } catch (error) {
      console.warn(`通知查看器会话结束时发生错误:`, error);
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * 批量推送输出（用于减少网络请求）
   */
  private outputBuffer: Map<string, string> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * 缓冲输出并批量发送
   */
  async bufferAndPushOutput(sessionId: string, output: string, isComplete: boolean = false): Promise<void> {
    if (!this.config.enabled || !this.activeSessions.has(sessionId)) return;

    // 如果是完成状态，立即发送
    if (isComplete) {
      // 先发送缓冲的内容
      if (this.outputBuffer.has(sessionId)) {
        await this.pushOutput(sessionId, this.outputBuffer.get(sessionId)!, false);
        this.outputBuffer.delete(sessionId);
      }
      // 清除定时器
      if (this.flushTimers.has(sessionId)) {
        clearTimeout(this.flushTimers.get(sessionId)!);
        this.flushTimers.delete(sessionId);
      }
      // 发送最终输出
      await this.pushOutput(sessionId, output, true);
      return;
    }

    // 添加到缓冲区
    const currentBuffer = this.outputBuffer.get(sessionId) || '';
    this.outputBuffer.set(sessionId, currentBuffer + output);

    // 清除之前的定时器
    if (this.flushTimers.has(sessionId)) {
      clearTimeout(this.flushTimers.get(sessionId)!);
    }

    // 设置新的定时器，500ms后发送缓冲的内容
    const timer = setTimeout(async () => {
      const bufferedOutput = this.outputBuffer.get(sessionId);
      if (bufferedOutput) {
        await this.pushOutput(sessionId, bufferedOutput, false);
        this.outputBuffer.delete(sessionId);
      }
      this.flushTimers.delete(sessionId);
    }, 500);

    this.flushTimers.set(sessionId, timer);
  }

  /**
   * 检查查看器是否可用
   */
  async checkViewerHealth(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const response = await fetch(`${this.config.viewerUrl}/api/sessions`, {
        method: 'GET',
        timeout: 3000 // 3秒超时
      });
      return response.ok;
    } catch (error) {
      console.warn('查看器健康检查失败:', error);
      return false;
    }
  }

  /**
   * 启用或禁用推送功能
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      // 清理所有缓冲和定时器
      this.outputBuffer.clear();
      this.flushTimers.forEach(timer => clearTimeout(timer));
      this.flushTimers.clear();
      this.activeSessions.clear();
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): RealtimePusherConfig {
    return { ...this.config };
  }

  /**
   * 获取活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
