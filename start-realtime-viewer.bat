@echo off
echo 启动MCP实时命令输出查看器...
echo.

cd realtime-viewer

echo 检查依赖...
if not exist node_modules (
    echo 安装依赖...
    npm install
    if errorlevel 1 (
        echo 依赖安装失败！
        pause
        exit /b 1
    )
)

echo 启动实时查看器服务器...
echo 服务器将在 http://localhost:3000 运行
echo 按 Ctrl+C 停止服务器
echo.

npm start
