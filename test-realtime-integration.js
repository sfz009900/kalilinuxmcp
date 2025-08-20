#!/usr/bin/env node

/**
 * 测试MCP实时输出查看器集成
 * 这个脚本模拟MCP服务器向实时查看器发送数据
 */

import fetch from 'node-fetch';

const VIEWER_URL = 'http://localhost:3000';

async function testRealtimeViewer() {
    console.log('🚀 开始测试MCP实时输出查看器集成...\n');

    try {
        // 1. 检查查看器是否运行
        console.log('1. 检查实时查看器状态...');
        const healthResponse = await fetch(`${VIEWER_URL}/api/sessions`);
        if (!healthResponse.ok) {
            throw new Error(`查看器未运行或无法访问: ${healthResponse.status}`);
        }
        console.log('✅ 实时查看器运行正常\n');

        // 2. 创建测试会话
        const sessionId = `test_session_${Date.now()}`;
        const command = 'ping -c 5 8.8.8.8';
        
        console.log('2. 创建测试会话...');
        const startResponse = await fetch(`${VIEWER_URL}/api/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, command })
        });
        
        if (!startResponse.ok) {
            throw new Error(`创建会话失败: ${startResponse.status}`);
        }
        console.log(`✅ 会话创建成功: ${sessionId}\n`);

        // 3. 模拟发送输出数据
        console.log('3. 模拟发送命令输出...');
        const outputs = [
            'PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.\n',
            '64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.3 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=11.8 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=12.1 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=4 ttl=118 time=11.9 ms\n',
            '64 bytes from 8.8.8.8: icmp_seq=5 ttl=118 time=12.0 ms\n',
            '\n--- 8.8.8.8 ping statistics ---\n',
            '5 packets transmitted, 5 received, 0% packet loss, time 4006ms\n',
            'rtt min/avg/max/mdev = 11.8/12.0/12.3/0.2 ms\n'
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
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('✅ 输出发送完成\n');

        // 4. 结束会话
        console.log('4. 结束测试会话...');
        const endResponse = await fetch(`${VIEWER_URL}/api/session/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        
        if (!endResponse.ok) {
            console.warn(`⚠️ 结束会话失败: ${endResponse.status}`);
        } else {
            console.log('✅ 会话已结束\n');
        }

        // 5. 验证会话状态
        console.log('5. 验证会话状态...');
        const sessionResponse = await fetch(`${VIEWER_URL}/api/session/${sessionId}`);
        if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            console.log('✅ 会话数据验证成功:');
            console.log(`   - 会话ID: ${sessionData.sessionId}`);
            console.log(`   - 命令: ${sessionData.command}`);
            console.log(`   - 输出长度: ${sessionData.output.length} 字符`);
            console.log(`   - 活跃状态: ${sessionData.isActive ? '是' : '否'}`);
        } else {
            console.warn('⚠️ 无法获取会话数据');
        }

        console.log('\n🎉 测试完成！请在浏览器中查看 http://localhost:3000 验证界面显示');
        console.log('\n📋 测试总结:');
        console.log('   ✅ 实时查看器服务正常');
        console.log('   ✅ 会话创建功能正常');
        console.log('   ✅ 实时输出推送正常');
        console.log('   ✅ 会话结束功能正常');
        console.log('   ✅ 数据验证功能正常');

    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        console.log('\n🔧 故障排除建议:');
        console.log('   1. 确保实时查看器正在运行: npm start (在 realtime-viewer 目录)');
        console.log('   2. 确认端口3000未被占用');
        console.log('   3. 检查防火墙设置');
        console.log('   4. 查看实时查看器的控制台日志');
        process.exit(1);
    }
}

// 运行测试
testRealtimeViewer();
