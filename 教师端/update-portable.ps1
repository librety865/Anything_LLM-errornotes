param([Parameter(Mandatory = $true)][ValidateSet('student','teacher')][string]$Role)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$release = Split-Path -Parent $project
if ($Role -eq 'student') {
  $portable = Join-Path $release '桌面版\知序桌面版'
  $exe = '知序错题本.exe'
  $dist = 'dist-desktop'
  $buildArgs = @('run','build','--','--mode','desktop')
  $runtimeFiles = @('desktop\main.mjs','desktop\preload.cjs')
} else {
  $portable = Join-Path $release '桌面版\知序教师桌面版'
  $exe = '知序教师端.exe'
  $dist = 'dist'
  $buildArgs = @('run','build')
  $runtimeFiles = @('desktop\main.mjs','desktop\preload.cjs','desktop\model-config.mjs','classroom-server.mjs','classroom-store.mjs','classroom-library.mjs','classroom-cards.mjs','classroom-image-ocr.mjs','classroom-ppt.mjs')
}
function Get-Sha256([string]$File) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) }
    finally { $stream.Dispose() }
  } finally {
    $algorithm.Dispose()
  }
}
function Assert-FileHash([string]$Source, [string]$Destination) {
  if ((Get-Sha256 $Source) -ne (Get-Sha256 $Destination)) {
    throw "产物哈希不一致：$Destination"
  }
}
function Assert-BackupTree([string]$Directory) {
  foreach ($child in Get-ChildItem -LiteralPath $Directory -Force) {
    if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "备份目录包含重解析点：$($child.FullName)"
    }
    if ($child.PSIsContainer) { Assert-BackupTree $child.FullName }
  }
}
function Remove-PortableBackups([string]$Directory) {
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    if ($item.Name -like '*.bak-*') {
      $validated = (Resolve-Path -LiteralPath $item.FullName).ProviderPath
      if (!$validated.StartsWith($portableRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "备份路径不在便携包内：$validated"
      }
      if ($item.PSIsContainer) { Assert-BackupTree $validated }
      Remove-Item -LiteralPath $validated -Recurse -Force
    } elseif ($item.PSIsContainer) {
      Remove-PortableBackups $item.FullName
    }
  }
}
$app = Join-Path $portable 'resources\app'
try {
  if (!(Test-Path -LiteralPath (Join-Path $portable $exe) -PathType Leaf) -or
      !(Test-Path -LiteralPath (Join-Path $app 'package.json') -PathType Leaf)) {
    throw "找不到 v4.0 便携包：$portable"
  }
  Push-Location -LiteralPath $project
  try {
    & npm.cmd @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "构建失败，退出码 $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  $out = Join-Path $project $dist
  if (!(Test-Path -LiteralPath (Join-Path $out 'index.html') -PathType Leaf)) {
    throw "构建产物缺少页面文件：$out"
  }
  $app = (Resolve-Path -LiteralPath $app).ProviderPath
  $releasePath = (Resolve-Path -LiteralPath $release).ProviderPath
  if (!$app.StartsWith($releasePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "便携包路径不在 v4.0 内：$app"
  }
  $target = Join-Path $app $dist
  foreach ($directory in @($release, (Join-Path $release '桌面版'), $portable, (Join-Path $portable 'resources'), $app, $target)) {
    if ((Test-Path -LiteralPath $directory) -and
        ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "便携包路径包含重解析点：$directory"
    }
  }
  $stage = Join-Path $app ($dist + '.stage-' + [Guid]::NewGuid())
  $old = Join-Path $app ($dist + '.previous-' + [Guid]::NewGuid())
  try {
    Copy-Item -LiteralPath $out -Destination $stage -Recurse
    $files = @(Get-ChildItem -LiteralPath $out -File -Recurse)
    if (@(Get-ChildItem -LiteralPath $stage -File -Recurse).Count -ne $files.Count) {
      throw '产物文件数量不一致'
    }
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($out.Length + 1)
      Assert-FileHash $file.FullName (Join-Path $stage $relative)
    }
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $old }
    Move-Item -LiteralPath $stage -Destination $target
  } catch {
    if (Test-Path -LiteralPath $old) { Move-Item -LiteralPath $old -Destination $target }
    throw
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
  foreach ($file in $runtimeFiles) {
    $source = Join-Path $project $file
    $destination = Join-Path $app $file
    Copy-Item -LiteralPath $source -Destination $destination -Force
    Assert-FileHash $source $destination
  }
  $portableRoot = (Resolve-Path -LiteralPath $portable).ProviderPath
  Remove-PortableBackups $portableRoot
  Write-Host "已完成 SHA256 校验和便携备份清理"
  Write-Host "已更新 v4.0 便携包：$portable"
} catch {
  Write-Host ("便携包更新失败：" + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
