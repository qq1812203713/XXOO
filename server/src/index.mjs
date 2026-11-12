// 启动入口。环境变量：
//   PORT            监听端口，默认 80（微信云托管的默认端口）
//   DATA_DIR        SQLite 数据库和上传图片的目录，默认 ./data
//   STATIC_DIR      H5 构建产物目录（可选，给了就同时托管页面）
//   DEVICE_AUTH     设为 1 时允许用 x-device-id 作为身份（开发 / H5 预览用，正式环境不要开）
//   MYSQL_ADDRESS   host:port。设置后改用 MySQL（云托管开通 MySQL 后会自动注入）
//   MYSQL_USERNAME / MYSQL_PASSWORD / MYSQL_DATABASE（默认 zhilema）
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createApp } from './app.mjs'
import { openMysql, openSqlite } from './db.mjs'

const env = process.env
const dataDir = resolve(env.DATA_DIR || 'data')
mkdirSync(dataDir, { recursive: true })

const db = env.MYSQL_ADDRESS
  ? await openMysql({ address: env.MYSQL_ADDRESS, user: env.MYSQL_USERNAME, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE || 'zhilema' })
  : await openSqlite(join(dataDir, 'zhilema.db'))

const app = createApp({ db, dataDir, staticDir: env.STATIC_DIR || '', deviceAuth: env.DEVICE_AUTH === '1' })
const port = Number(env.PORT) || 80
createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`zhilema server on :${port}  db=${db.name}  deviceAuth=${env.DEVICE_AUTH === '1'}  static=${env.STATIC_DIR || '-'}`)
})
