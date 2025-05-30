FROM node:18

# 安裝 ffmpeg 和繁中字型
RUN apt-get update && \
    apt-get install -y ffmpeg fonts-noto-cjk && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 設定 FFmpeg 預設字型為 NotoSansCJKtc-Regular.otf
ENV FONTCONFIG_PATH=/etc/fonts
ENV FONTCONFIG_FILE=fonts.conf

# 建立工作目錄
WORKDIR /app

# 複製 package.json 並安裝相依
COPY package*.json ./
RUN npm install

# 複製全部程式碼
COPY . .

# 建立影片輸出資料夾
RUN mkdir -p public uploads

# 開放 port
EXPOSE 3000

# 啟動 Node.js 應用
CMD ["node", "index.js"]
