import { spawn } from 'node:child_process';
import { join } from 'node:path';

const script = [
 '$ErrorActionPreference = "Stop"',
 'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
 '$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]',
 '$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]',
 '$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]',
 '$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]',
 '$null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType=WindowsRuntime]',
 '$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]',
 '$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]',
 '$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
 ' $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Length -eq 1',
 '} | Select-Object -First 1',
 'function Wait-WinRt($operation, [Type]$type) {',
 ' $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))',
 ' $task.GetAwaiter().GetResult()',
 '}',
 '$memory = New-Object System.IO.MemoryStream',
 '$source = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream',
 '$writer = New-Object Windows.Storage.Streams.DataWriter($source)',
 'try {',
 ' [Console]::OpenStandardInput().CopyTo($memory)',
 ' $writer.WriteBytes($memory.ToArray())',
 ' $null = Wait-WinRt ($writer.StoreAsync()) ([uint32])',
 ' $null = $writer.DetachStream()',
 ' $source.Seek(0)',
 ' $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($source)) ([Windows.Graphics.Imaging.BitmapDecoder])',
 ' $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
 ' if (!$engine) { exit 3 }',
 ' $transform = New-Object Windows.Graphics.Imaging.BitmapTransform',
 ' $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension',
 ' $largest = [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight)',
 ' if ($largest -gt $limit) {',
 '  $scale = $limit / $largest',
 '  $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $scale))',
 '  $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $scale))',
 ' }',
 ' $bitmap = Wait-WinRt ($decoder.GetSoftwareBitmapAsync("Bgra8", "Premultiplied", $transform, "RespectExifOrientation", "DoNotColorManage")) ([Windows.Graphics.Imaging.SoftwareBitmap])',
 ' try {',
 '  $result = Wait-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
 '  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
 '  [Console]::Write(($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine)',
 ' } finally { $bitmap.Dispose() }',
 '} finally { $writer.Dispose(); $source.Dispose(); $memory.Dispose() }',
].join('\n');

function fail(message) {
  return Object.assign(new Error(message), {status: 422});
}

export async function extractLibraryImage(buffer) {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const executable = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const text = await new Promise((resolve, reject) => {
    const controller = new AbortController();
    const cutoff = setTimeout(() => controller.abort(), 30000);
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', command], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], signal: controller.signal,
    });
    let result = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', value => { result += value; });
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(cutoff);
      reject(fail(controller.signal.aborted
        ? '图片文字识别超时，请裁小图片后重试'
        : '无法启动 Windows 文字识别，请粘贴 OCR 文本后重试'));
    });
    child.once('close', code => {
      clearTimeout(cutoff);
      if (code === 0) resolve(result.trim());
      else reject(fail(code === 3
        ? 'Windows 没有可用的 OCR 语言，请安装语言包或粘贴 OCR 文本'
        : 'Windows 无法识别这张图片，请换一张清晰的 JPG 或 PNG，或粘贴 OCR 文本'));
    });
    child.stdin.end(Buffer.from(buffer));
  });
  if (!text) throw fail('图片中未识别到文字，请上传清晰图片，或粘贴 OCR 文本');
  return text;
}

export async function prepareLibraryUpload(buffer, filename, mime) {
  if (process.platform !== 'win32' || !/\.(?:jpe?g|png|bmp|tiff?|gif|webp|heic|heif)$/i.test(filename)) {
    return {buffer, filename, mime};
  }
  const text = await extractLibraryImage(buffer);
  const name = filename.replace(/\.[^.]+$/, '');
  return {buffer: Buffer.from(text, 'utf8'), filename: name + '.md', mime: 'text/markdown'};
}
