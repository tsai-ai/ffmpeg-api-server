const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '2mb' }));
app.use('/video', express.static(path.join(__dirname, 'public')));

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

const subtitleStyle = [
  'PlayResX=1920',
  'PlayResY=1080',
  'FontName=NotoSansCJKtc-Regular',
  'Fontsize=13',
  'WrapStyle=2',
  'Alignment=2',
  'MarginL=140',
  'MarginR=140',
  'MarginV=55',
  'Outline=2',
  'Shadow=0',
  'BorderStyle=1',
  'PrimaryColour=&H00FFFFFF',
  'OutlineColour=&H00000000',
].join(',');

app.post(
  '/generate',
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 },
  ]),
  async (req, res) => {
    const image = req.files?.image?.[0];
    const audio = req.files?.audio?.[0];
    const subtitle = req.files?.subtitle?.[0];

    if (!image || !audio || !subtitle) {
      return res.status(400).json({ error: 'image, audio, subtitle are required' });
    }

    const output = ensureMp4Name(req.body?.outputName, `output-${Date.now()}`);

    const imagePath = image.path.replace(/\\/g, '/');
    const audioPath = audio.path.replace(/\\/g, '/');
    const subtitlePath = subtitle.path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const outputPath = path.join(__dirname, 'public', output).replace(/\\/g, '/');

    const videoFilter = [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      `subtitles='${subtitlePath}':force_style='${subtitleStyle}'`,
    ].join(',');

    const cmd = `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "${videoFilter}" -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;

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
