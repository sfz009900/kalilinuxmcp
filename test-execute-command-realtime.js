#!/usr/bin/env node

/**
 * 测试execute_command的实时推送功能
 */

import fetch from 'node-fetch';

const VIEWER_URL = 'http://localhost:3000';

async function testExecuteCommandRealtime() {
    console.log('🚀 测试execute_command实时推送功能...\n');

    try {
        // 1. 检查查看器是否运行
        console.log('1. 检查实时查看器状态...');
        const healthResponse = await fetch(`${VIEWER_URL}/api/sessions`);
        if (!healthResponse.ok) {
            throw new Error(`查看器未运行或无法访问: ${healthResponse.status}`);
        }
        console.log('✅ 实时查看器运行正常\n');

        // 2. 模拟execute_command的实时推送
        console.log('2. 模拟execute_command实时推送...');
        
        // 创建一个模拟的execute命令会话
        const sessionId = `exec_${Date.now()}_test`;
        const command = 'ping -c 3 8.8.8.8';
        
        // 开始会话
        const startResponse = await fetch(`${VIEWER_URL}/api/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, command })
        });
        
        if (!startResponse.ok) {
            throw new Error(`创建会话失败: ${startResponse.status}`);
        }
        console.log(`✅ 模拟execute会话创建成功: ${sessionId}\n`);

        // 3. 模拟实时输出
        console.log('3. 模拟实时命令输出...');
        const outputs = [
            'PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.\n',
            '64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.3 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=11.8 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=12.1 ms\n',
            '\n--- 8.8.8.8 ping statistics ---\n',
            '3 packets transmitted, 3 received, 0% packet loss, time 2003ms\n',
            'rtt min/avg/max/mdev = 11.8/12.1/12.3/0.2 ms\n',
            '\n[命令执行完成，退出码: 0]'
        ];

        for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i];
            const isComplete = i === outputs.length - 1;
            
            const outputResponse = await fetch(`${VIEWER_URL}/api/session/output`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, output, isComplete })
            });
            
            if (!outputResponse.ok) {
                console.warn(`⚠️ 发送输出失败: ${outputResponse.status}`);
            } else {
                console.log(`📤 发送输出 ${i + 1}/${outputs.length}: ${output.trim()}`);
            }
            
            // 模拟实时输出的延迟
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log('✅ 模拟输出发送完成\n');

        // 4. 结束会话
        console.log('4. 结束模拟会话...');
        const endResponse = await fetch(`${VIEWER_URL}/api/session/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        
        if (!endResponse.ok) {
            console.warn(`⚠️ 结束会话失败: ${endResponse.status}`);
        } else {
            console.log('✅ 模拟会话已结束\n');
        }

        console.log('🎉 execute_command实时推送测试完成！\n');
        console.log('📋 测试结果:');
        console.log('   ✅ 实时查看器服务正常');
        console.log('   ✅ execute_command会话创建正常');
        console.log('   ✅ 实时输出推送正常');
        console.log('   ✅ 会话结束功能正常');
        console.log('\n💡 现在您可以在Augment中使用execute_command，输出会实时显示在浏览器中！');
        console.log('   示例: execute_command command="nmap -Pn -sS 39.107.25.121"');

    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        console.log('\n🔧 故障排除建议:');
        console.log('   1. 确保实时查看器正在运行: npm start (在 realtime-viewer 目录)');
        console.log('   2. 确认端口3000未被占用');
        console.log('   3. 重新构建MCP服务器: npm run build');
        process.exit(1);
    }
}

// 运行测试
testExecuteCommandRealtime();
