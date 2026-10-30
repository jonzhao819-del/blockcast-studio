# Windows 代码签名

当前安装包是功能测试构建，Authenticode 状态为 `NotSigned`。对其他电脑正式分发前，建议使用受信任的 OV/EV 代码签名证书或企业认可的云签名服务。

## 安全要求

- 证书私钥、PFX 密码和云签名凭据不得写入项目、日志或聊天记录。
- PFX 应保存在受限本机目录或硬件密钥中。
- 构建完成后必须验证主程序和安装包的签名状态与时间戳。

## electron-builder 本机 PFX 方式

在构建机器的临时环境变量中设置：

```powershell
$env:CSC_LINK = 'C:\secure\publisher-certificate.pfx'
$securePassword = Read-Host 'PFX password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try { $env:CSC_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
```

实际自动构建时应通过安全凭据系统注入密码，而不是写入脚本。运行：

```powershell
npm run release
Get-AuthenticodeSignature .\dist\Blockcast-Studio-Setup-*.exe
$env:CSC_LINK = $null
$env:CSC_KEY_PASSWORD = $null
```

验收结果必须为 `Valid`，并且签名者名称与发布主体一致。

如果暂时没有合法证书，可以内部测试未签名安装包，但不能把 SmartScreen 警告描述为安全通过，也不能将自签名证书静默加入其他电脑的受信任根证书库。
