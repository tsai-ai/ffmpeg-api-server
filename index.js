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

  const cmd = `ffmpeg -y -loop 1 -i ${image.path} -i ${audio.path} -vf "subtitles=${subtitle.path}:force_style='FontName=DejaVuSans,Fontsize=24'" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest public/${output}`;


    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        return res.status(500).send('FFmpeg failed');
      }

      // 將影片檔案以 binary 回傳
      const filePath = path.join(__dirname, 'public', output);
      res.download(filePath); // 或使用 res.sendFile(filePath);
    });
  }
);

app.listen(8080, () => console.log('API running on port 8080'));
