# 足迹规划 Footprint

微信小程序 · 旅游计划工具（Taro + React + TypeScript）

## 功能

- 计划：创建 / 编辑 / 删除 / 合并；JSON 导入导出（微信文件）
- 行程编辑：按日安排、地图选点添加、拖拽排序、类型筛选
- 备注与导航：行程备注、步行/骑行/公交路线

当前为**本地单机存储**，数据结构已预留 `userId` / `extra`，便于后续登录与字段扩展。

导入仅接受当前版本导出的 JSON（`plans` + `places` + `stops`）。

## 开发

```bash
npm install
npm run dev:weapp
```

用微信开发者工具打开项目根目录（`miniprogramRoot` 为 `dist/`）。

## 高德地图配置

编辑 `src/constants/index.ts`：

1. `AMAP_CONFIG.webServiceKey`：Web 服务 Key（地点搜索）
2. `AMAP_CONFIG.key`：小程序 Key

并在[微信公众平台](https://mp.weixin.qq.com/) → 开发管理 → 开发设置 → 服务器域名中，将 `https://restapi.amap.com` 配为 **request 合法域名**。

申请地址：https://console.amap.com/dev/key/app

## 目录

```
src/
  pages/index          计划列表（导入/导出/合并）
  pages/plan-edit      新建/编辑计划
  pages/trip-edit      行程编辑（薄页面）
  pages/nav            路线导航
  features/trip        行程编辑领域 UI 与逻辑
  components/sheet-map 地图 + 底部面板
  hooks/               共享 hooks
  services/            本地存储、高德 API
  types/               数据模型
```

## 后续可扩展

- 微信登录与用户隔离
- 停留时长、完成状态
- 服务端同步
