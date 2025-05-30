const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post(
  '/generate',
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 },
  ]),
  async (req, res) => {
    const image = req.files['image'][0];
    const audio = req.files['audio'][0];
    const subtitle = req.files['subtitle'][0];
    const output = `output-${Date.now()}.mp4`;

    // 讓路徑支援中文與空格
    const imagePath = image.path.replace(/\\/g, '/');
    const audioPath = audio.path.replace(/\\/g, '/');
    const subtitlePath = subtitle.path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

    const cmd = `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "subtitles='${subtitlePath}':force_style='FontName=NotoSansCJKtc-Regular,Fontsize=24'" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest public/${output}`;

    console.log('Executing FFmpeg command:\n', cmd);

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('FFmpeg stderr:', stderr);
        return res.status(500).send('FFmpeg failed');
      }

      const filePath = path.join(__dirname, 'public', output);
      res.download(filePath); // or res.sendFile(filePath);
    });
  }
);

app.listen(8080, () => console.log('API running on port 8080'));
