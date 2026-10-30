# 干净 Windows 最终验收

1. 将 `Blockcast-Studio-Setup-0.4.0.exe` 复制到一台 Windows 10 22H2 或 Windows 11 x64 测试电脑。此项是待执行清单，不代表已通过。
2. 校验 SHA-256：`D77A62426B4FA7A93119E2644B58B6D33475474F12E830B05DD31BB96B309C24`。当前包未签名，有疑虑时不要运行，不要关闭系统防护。
3. 安装并启动，确认桌面/开始菜单快捷方式、像素 UI、一个 Edge 窗口三个平台标签页。
4. 分别在 100%、125%、150% 缩放下检查 1920×1080 或 1366×768 窗口，不应出现控件遮挡。
5. 首次扫码登录，关闭并重启发布器，确认登录状态恢复。
6. 可选：在 PowerShell 运行以下只读采集命令（会在桌面生成 JSON）。先检查报告和截图有无个人信息，再决定是否私下分享，不要直接公开完整诊断：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\collect-clean-machine-report.ps1 -Installer .\dist\Blockcast-Studio-Setup-0.4.0.exe
```

验证码、风控、SmartScreen 与扫码均由用户本人完成；测试不得点击最终发布。
