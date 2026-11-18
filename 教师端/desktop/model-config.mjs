import { spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const promptScript = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$form = New-Object System.Windows.Forms.Form',
  '$form.Text = "配置 AnythingLLM Key"',
  '$form.Width = 510; $form.Height = 182; $form.StartPosition = "CenterScreen"',
  '$form.FormBorderStyle = "FixedDialog"; $form.MaximizeBox = $false; $form.MinimizeBox = $false',
  '$form.TopMost = $true; $form.ShowInTaskbar = $false',
  '$label = New-Object System.Windows.Forms.Label',
  '$label.SetBounds(16, 15, 465, 30); $label.Text = "请粘贴本机 AnythingLLM 的 Developer API Key。"',
  '$field = New-Object System.Windows.Forms.TextBox',
  '$field.SetBounds(16, 48, 460, 24); $field.UseSystemPasswordChar = $true; $field.MaxLength = 512',
  '$save = New-Object System.Windows.Forms.Button',
  '$save.SetBounds(307, 87, 82, 29); $save.Text = "保存"; $save.DialogResult = "OK"',
  '$cancel = New-Object System.Windows.Forms.Button',
  '$cancel.SetBounds(394, 87, 82, 29); $cancel.Text = "取消"; $cancel.DialogResult = "Cancel"',
  '$form.Controls.AddRange([System.Windows.Forms.Control[]]@($label, $field, $save, $cancel))',
  '$form.AcceptButton = $save; $form.CancelButton = $cancel; $form.ActiveControl = $field',
  'try {',
  '  if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '    [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($field.Text)))',
  '  } else { exit 2 }',
  '} finally { $field.Clear(); $form.Dispose() }',
].join('\n');

export async function promptDeveloperKey(signal) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = Buffer.from(promptScript, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal });
    let result = '';
    child.stdout.setEncoding('ascii');
    child.stdout.on('data', part => { result += part; });
    child.once('error', () => reject(Error('无法打开本机 Key 输入框，请重试')));
    child.once('close', code => {
      if (code === 2) resolve(null);
      else if (code === 0) resolve(Buffer.from(result.trim(), 'base64').toString('utf8'));
      else reject(Error('无法打开本机 Key 输入框，请重试'));
    });
  });
}

export async function saveDeveloperKey(configPath, value) {
  const key = value.trim();
  if (!key || key.length > 512 || !/^[!-~]+$/.test(key) || key.includes('"') || key.includes('\\')) {
    throw Error('Key 为空或包含无效字符，请重新复制 AnythingLLM Developer API Key');
  }
  let config;
  try { config = await readFile(configPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw Error('无法读取主机配置，请检查教师桌面版目录权限');
    config = '';
  }

  const assignment = /^(?:[ \t]*export[ \t]+)?[ \t]*CLASSROOM_ANYTHINGLLM_API_KEY[ \t]*=.*$/gm;
  let replaced = false;
  const line = 'CLASSROOM_ANYTHINGLLM_API_KEY="' + key + '"';
  let next = config.replace(assignment, () => {
    if (replaced) return '';
    replaced = true;
    return line;
  });
  if (!replaced) next = next.trimEnd() + (next.trimEnd() ? '\n' : '') + line + '\n';

  const temporary = configPath + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
    await rename(temporary, configPath);
  } catch {
    throw Error('无法保存 Key，请确认教师桌面版目录可写后重试');
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
