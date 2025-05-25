FROM node:18

# 安裝 ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 建立工作目錄
WORKDIR /app

# 複製 package.json 並安裝相依
COPY package*.json ./
RUN npm install

# 複製全部程式碼
COPY . .

# 建立影片輸出資料夾
RUN mkdir -p public uploads

# 啟動服務
EXPOSE 3000
CMD ["node", "index.js"]