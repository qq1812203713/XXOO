# 微信云托管用。构建目录就是 server/ 这一层。
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV PORT=80 DEVICE_AUTH=0 NODE_ENV=production
EXPOSE 80
CMD ["node", "src/index.mjs"]
