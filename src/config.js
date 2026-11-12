// 后端连接配置。
//
// 微信小程序：后端部署在「微信云托管」后，把下面两项填上，小程序就会通过
// wx.cloud.callContainer 调用后端（不需要配置服务器域名）。留空则小程序只用本机数据。
export const CLOUD_ENV = '' // 云托管环境 ID，例如 prod-1a2b3c4d5e
export const CLOUD_SERVICE = '' // 云托管里的服务名称，例如 zhilema

// H5：接口地址前缀。留空表示和页面同源（server/ 同时托管页面时就是这种情况）。
export const API_BASE = ''
