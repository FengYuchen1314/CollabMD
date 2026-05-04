@echo off
chcp 65001 >nul
echo.
echo 🚀 开始 Git 提交流程...
echo.

git add .
echo 📁 已执行 git add .

git diff --cached --quiet
if %errorlevel% == 1 (
    echo.
    echo ✍️ 请输入提交信息（直接回车结束）：
    set "commit_msg="
    set /p "commit_msg="
    
    if "!commit_msg!"=="" (
        echo ❌ 提交信息不能为空！
        pause
        exit /b
    )
    
    echo.
    echo 💾 正在提交...
    git commit -m "!commit_msg!"
    
    echo 🌐 正在推送...
    git push
    
    echo.
    echo ✅ 全部完成！
) else (
    echo ⚠️ 没有检测到任何文件改动。
)

echo.
pause