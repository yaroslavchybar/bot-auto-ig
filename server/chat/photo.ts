import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function photoDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'json', filePath,
  ], { timeout: 20_000 });
  const stream = (JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('Photo has no valid dimensions');
  return { width, height };
}

function validateFeedDimensions(width: number, height: number): void {
  const ratio = width / height;
  if (ratio < 3 / 4 || ratio > 90 / 47)
    throw new Error(`Photo ratio ${width}:${height} is outside the supported feed range`);
  if (width > 1080 || height > 1440)
    throw new Error(`Photo dimensions ${width}:${height} exceed the supported feed size`);
}

/** Fit a feed photo within Instagram's pixel limits without changing its aspect ratio. */
export async function prepareFeedPhoto(filePath: string): Promise<{ file: Buffer; width: number; height: number }> {
  const { width, height } = await photoDimensions(filePath);
  const scale = Math.min(1, 1080 / width, 1440 / height);
  if (scale === 1 && /\.jpe?g$/i.test(filePath)) {
    validateFeedDimensions(width, height);
    return { file: await fs.readFile(filePath), width, height };
  }

  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'ig-feed-photo-'));
  const output = path.join(dir, 'photo.jpg');
  try {
    await execFile('ffmpeg', [
      '-v', 'error', '-i', filePath, '-frames:v', '1',
      '-vf', `scale=${targetWidth}:${targetHeight}:flags=lanczos`,
      '-map_metadata', '0', '-q:v', '2', '-y', output,
    ], { timeout: 120_000 });
    const converted = await photoDimensions(output);
    validateFeedDimensions(converted.width, converted.height);
    return { file: await fs.readFile(output), ...converted };
  } finally {
    await fs.rm(output, { force: true });
    await fs.rmdir(dir);
  }
}
