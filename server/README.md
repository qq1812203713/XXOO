# 值了吗 · 后端

一个不依赖框架的 Node.js 服务（需要 Node 22.13 以上）。负责：

| 接口 | 作用 |
| --- | --- |
| `GET /api/sync`、`POST /api/sync` | 拉取 / 推送主题、记录、标签、回顾 |
| `POST /api/files`、`GET /files/…` | 上传和读取照片（H5 用；小程序的照片走云托管对象存储） |
| `POST /api/shares`、`GET /api/shares/:id`、`DELETE /api/shares/:id` | 生成、查看、撤回分享 |
| `POST /api/ai` | 把 AI 请求转发到用户自己填写的 OpenAI 兼容接口 |
| `DELETE /api/account` | 删除当前用户的全部数据 |
| `GET /api/health` | 健康检查 |

## 本地运行

在项目根目录：

```bash
npm run build:h5     # 先构建页面
npm run server       # 启动后端并托管页面，打开 http://localhost:5173
```

数据保存在 `server/data/`（SQLite 数据库和上传的照片）。

运行测试：

```bash
cd server && npm test
```

## 部署到微信云托管

1. 在微信公众平台开通「云托管」，新建一个环境和一个服务，记下**环境 ID** 和**服务名称**。
2. 在云托管里开通 **MySQL**。开通后平台会给服务注入 `MYSQL_ADDRESS`、`MYSQL_USERNAME`、`MYSQL_PASSWORD`，
   后端检测到 `MYSQL_ADDRESS` 就会改用 MySQL，并自动建库（默认库名 `zhilema`）和建表。
   容器的磁盘在重启后会清空，所以线上不能用 SQLite。
3. 部署服务：上传 `server/` 这个目录（里面有 `Dockerfile`），端口填 `80`。
4. 建议在服务设置里**关闭公网访问**。小程序通过 `wx.cloud.callContainer` 走内部通道，不需要公网域名；
   后端靠平台注入的 `x-wx-openid` 请求头识别用户，公网访问关闭后外部无法伪造这个请求头。
5. 回到前端，把环境 ID 和服务名称填进 `src/config.js` 的 `CLOUD_ENV`、`CLOUD_SERVICE`，
   再把小程序 AppID 填进 `src/manifest.json` 的 `mp-weixin.appid`，重新运行 `npm run dev:mp-weixin`。

部署后可以先在云托管控制台看日志，启动成功会打印一行 `zhilema server on :80  db=mysql …`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 80 |
| `MYSQL_ADDRESS` | `host:port`，设置后使用 MySQL |
| `MYSQL_USERNAME` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | MySQL 账号、密码、库名（默认 `zhilema`） |
| `DATA_DIR` | SQLite 数据库和上传照片的目录，默认 `./data` |
| `STATIC_DIR` | H5 构建产物目录；设置后同时托管页面 |
| `DEVICE_AUTH` | 设为 `1` 时允许浏览器用随机设备号当作用户，只用于开发和 H5 预览，线上保持 `0` |

## 还没有在真实环境验证的部分

- MySQL 这一套语句只做了代码检查，没有连真实的 MySQL 跑过。
- 小程序端的 `wx.cloud.callContainer`、`wx.cloud.uploadFile` 需要在微信开发者工具里验证。
