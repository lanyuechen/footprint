/**
 * 高德地图相关配置
 * 请在高德开放平台申请「微信小程序」Key，填入下方
 * https://console.amap.com/dev/key/app
 */
export const AMAP_CONFIG = {
  /** 小程序 Key（地图组件 / JS API） */
  key: 'a7b534b97618a7dcb7170f53774369e4',
  /** Web 服务 Key（地点搜索等 REST API，可与小程序 Key 分开申请） */
  webServiceKey: '47728e3fac92ea82f03ffac99b08c3d1',
  /** 安全密钥（若控制台开启了安全密钥校验则填写） */
  securityJsCode: '',
}

export const STORAGE_KEYS = {
  APP_DATA: 'footprint_app_data_v1',
  /** 导航页上次选择的出行方式 */
  LAST_NAV_MODE: 'footprint_last_nav_mode_v1',
} as const

export const DATA_VERSION = 4
