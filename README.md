# 方块发布站 / 一键多平台发布视频

**现在支持抖音、B站、视频号。**

一款免费、MIT 开源的 Windows 本地辅助发布器。集中通用素材与填写流程，保留平台真实投稿页、本人风控验证和最终发布确认。适合个人创作者，以及在各自电脑上工作的运营团队成员。

- 产品网站：https://jonzhao819-del.github.io/blockcast-studio/
- Windows 下载：https://github.com/jonzhao819-del/blockcast-studio/releases
- 问题反馈：https://github.com/jonzhao819-del/blockcast-studio/issues
- 项目联系邮箱：**1994763499@qq.com**

官网无需注册、登录或扫码，直接展示介绍、下载、功能状态、隐私说明和开源入口。平台账号登录仅发生在安装后的专用 Edge 中。

## 当前状态：v0.4.0 公开测试版

| 功能 | 状态 |
| --- | --- |
| 三平台真实视频上传、标题和简介 | 本机固定素材验证通过 |
| 原生话题/标签、账号合集 ID | 本机真实页面读取和填写验证通过 |
| B站分区 | 当前测试页面的 30 个分类与可见候选交叉核验；不是旧版 120 分区 |
| 真实进度 | 观察网络请求、分片字节与页面状态；只有平台提供整体百分比才显示 |
| 原生复核 | 一个专用 Edge 窗口，三个平台标签页 |
| 封面、定时 | 裁剪、最终保存与平台日期仍需人工确认；B站真实封面专项未完成 |
| 最终发布 | 人工确认保护逻辑已测试；本轮未执行真实最终发布 |
| 系统兼容 | 本机安装和升级通过；Windows 10、第二台干净电脑及弱网大文件仍待验收 |
| 团队功能 | 可分别安装；暂无团队权限、账号托管、共享素材和审批 |

本项目不是抖音、B站或视频号官方产品，不使用官方授权投稿 API；采用实际创作中心网页适配。平台改版、账号权限或灰度界面可能影响功能，请遵守平台规则。

## 安装与使用

1. 从 Releases 下载 Windows x64 安装包，并核对同页 SHA-256。
2. 安装后启动方块发布站。用户电脑不需要安装 Node.js 或 npm；需要 Microsoft Edge。
3. 在助手专用 Edge 的真实平台页登录账号。验证码与风控由本人完成。
4. 选择或拖入视频和封面，填写通用信息，再调整平台独立字段。
5. 观察真实状态，在原生投稿页检查封面、文字、合集与定时，最后由本人确认发布。

**当前安装包未签名。** Windows 可能提示未知发布者。请核对来源和 SHA-256；有疑虑时不要运行。不要关闭杀毒软件或系统防护；文件校验值不能代替代码签名和安全审查。安装、升级及数据清理见 [INSTALL_UPGRADE.md](INSTALL_UPGRADE.md)。

## 隐私与安全

- 视频和封面直接交给对应平台投稿页，不经过项目运营方的上传服务器。
- 登录状态保存在专用本地 Edge Profile，不读取日常 Edge 登录资料。
- 调试端口随机分配且仅监听循环回地址，退出助手时关闭专用浏览器和通道。
- 不导出或上传 Cookie，不绕过验证码、平台风控或权限。
- 日志做凭证脱敏，但诊断导出和截图仍需人工检查后才能分享。
- 官网不设置登录、第三方统计或远程字体；托管/下载服务仍按其政策处理网络访问记录。

详见 [SECURITY.md](SECURITY.md)。安全问题请私下发往项目邮箱，不要公开凭证。

## 本地开发

开发环境：Windows x64、Node.js 22.12 或更高版本、npm、Microsoft Edge。依赖版本锁定于 package-lock.json。

    npm ci
    npm test
    npm start

构建 Windows 安装包：

    npm run release

构建不会自动发布；输出在 dist/。本轮固定版本为 Electron 43.8.4、electron-builder 26.15.3，后续升级需复测。

## 官网开发

纯 HTML/CSS/JavaScript，无运行时第三方依赖。邮箱、仓库与下载信息集中在 website/site.config.json。

    node scripts/build-website.js
    node --test tests/website-check.js
    node node_modules/electron/cli.js tests/website-render-check.js

构建输出 .site/，可以直接打开 index.html。网站构建不需要安装 Electron；最后一条仅用于可选的真实渲染测试。GitHub Pages 工作流只上传 .site/，不会把整个项目根目录作为网站。

## 架构与目录

- main.js / preload.js：主进程、受限 IPC 和本地窗口。
- lib/：平台适配、CDP、上传跟踪、校验和日志。
- renderer/：像素风桌面工作台。
- website/：无需登录的公开产品网站。
- tests/：静态、行为、图片与渲染回归测试。
- scripts/：构建、安装包核验、源码白名单导出。

欢迎阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。验收边界见 [AUDIT_0.4.0.md](AUDIT_0.4.0.md)。不得将本机测试写成所有电脑、账号与平台功能全面通过。

## 许可证

本项目自有源码采用 [MIT License](LICENSE)。依赖和平台商标属于各自权利人，遵循各自许可和规则；项目名称及像素风示意图不表示与任何游戏或平台官方合作。
