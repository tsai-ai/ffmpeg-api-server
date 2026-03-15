const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '2mb' }));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/video', express.static(PUBLIC_DIR));
app.get('/health', (req, res) => res.status(200).json({ ok: true }));
app.get('/', (req, res) => res.status(200).send('ok'));

const sanitizeBaseName = (value, fallback) => {
  const cleaned = String(value || fallback || 'output')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  return cleaned || fallback || 'output';
};

const ensureMp4Name = (value, fallback) => {
  const normalized = sanitizeBaseName(String(value || fallback || 'output').replace(/\.mp4$/i, ''), fallback);
  return `${normalized}.mp4`;
};

const resolveProjectFile = (file) => {
  const normalized = String(file || '').replace(/^\/+/, '').replace(/\\/g, '/');
  return path.join(__dirname, normalized);
};

const audioLeadInMs = 300;
const subtitleFontFile = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';

const wrapText = (text, lineLength = 22, maxLines = 3) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const chars = Array.from(normalized);
  const lines = [];
  let current = '';

  for (const char of chars) {
    current += char;
    if (current.length >= lineLength) {
      lines.push(current);
      current = '';
    }
  }

  if (current) lines.push(current);

  if (lines.length <= maxLines) {
    return lines.join('\n');
  }

  const limited = lines.slice(0, maxLines);
  limited[maxLines - 1] = `${limited[maxLines - 1].slice(0, Math.max(0, lineLength - 1))}…`;
  return limited.join('\n');
};

const escapeDrawtext = (text) => String(text || '')
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/:/g, '\\:')
  .replace(/%/g, '\\%')
  .replace(/\n/g, '\\n');

app.post(
  '/generate',
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'bgm', maxCount: 1 },
  ]),
  async (req, res) => {
    const image = req.files?.image?.[0];
    const audio = req.files?.audio?.[0];
    const bgm = req.files?.bgm?.[0];
    const subtitleText = req.body?.subtitleText || '';

    if (!image || !audio) {
      return res.status(400).json({ error: 'image and audio are required' });
    }

    const output = ensureMp4Name(req.body?.outputName, `output-${Date.now()}`);

    const imagePath = image.path.replace(/\\/g, '/');
    const audioPath = audio.path.replace(/\\/g, '/');
    const outputPath = path.join(__dirname, 'public', output).replace(/\\/g, '/');
    const wrappedSubtitle = escapeDrawtext(wrapText(subtitleText));

    const videoFilters = [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
    ];

    if (wrappedSubtitle) {
      videoFilters.push('drawbox=x=140:y=ih-230:w=iw-280:h=150:color=black@0.52:t=fill');
      videoFilters.push(`drawtext=fontfile='${subtitleFontFile}':text='${wrappedSubtitle}':fontcolor=white:fontsize=26:line_spacing=8:x=(w-text_w)/2:y=h-195`);
    }

    const inputArgs = [`-loop 1 -i "${imagePath}"`, `-i "${audioPath}"`];
    let audioFilter = `[1:a]adelay=${audioLeadInMs}:all=1[voice]`;
    let audioMap = '"[voice]"';

    if (bgm) {
      const bgmPath = bgm.path.replace(/\\/g, '/');
      inputArgs.push(`-stream_loop -1 -i "${bgmPath}"`);
      audioFilter += `;[2:a]volume=0.12[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
      audioMap = '"[aout]"';
    }

    const cmd = `ffmpeg -y ${inputArgs.join(' ')} -vf "${videoFilters.join(',')}" -filter_complex "${audioFilter}" -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -map 0:v:0 -map ${audioMap} -shortest "${outputPath}"`;

    console.log('Executing FFmpeg command:\n', cmd);

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('FFmpeg stderr:', stderr);
        return res.status(500).json({ error: 'FFmpeg failed', details: stderr });
      }

      return res.json({
        file: output,
        url: `/video/${output}`,
      });
    });
  }
);

app.post('/merge', async (req, res) => {
  const files = req.body?.files;

  if (!files || !Array.isArray(files) || files.length < 2) {
    return res.status(400).send('請提供至少兩個影片路徑');
  }

  const resolvedFiles = files.map((file) => ({
    original: file,
    absolute: resolveProjectFile(file),
  }));

  const missingFile = resolvedFiles.find((file) => !fs.existsSync(file.absolute));
  if (missingFile) {
    return res.status(400).json({
      error: '影片檔不存在',
      file: missingFile.original,
      resolvedPath: missingFile.absolute,
    });
  }

  const listFilePath = path.join(__dirname, 'uploads', `merge-list-${Date.now()}.txt`);
  const listContent = resolvedFiles
    .map(({ absolute }) => `file '${absolute.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listFilePath, listContent);

  const output = ensureMp4Name(req.body?.outputName, `merged-${Date.now()}`);
  const outputPath = path.join(__dirname, 'public', output);
  const cmd = `ffmpeg -f concat -safe 0 -i "${listFilePath}" -c copy "${outputPath}"`;

  console.log('Executing merge command:\n', cmd);

  exec(cmd, (err, stdout, stderr) => {
    try {
      fs.unlinkSync(listFilePath);
    } catch (unlinkError) {
      console.warn('Failed to remove merge list file:', unlinkError.message);
    }

    if (err) {
      console.error('FFmpeg stderr:', stderr);
      return res.status(500).json({ error: '影片合併失敗', details: stderr });
    }

    return res.json({
      file: output,
      url: `/video/${output}`,
    });
  });
});

app.listen(8080, () => console.log('API running on port 8080'));


