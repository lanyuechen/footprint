# 足迹规划 Footprint

微信小程序 · 旅游计划工具（Taro + React + TypeScript）

## 功能

- 计划：创建 / 查看 / 编辑 / 删除（删除级联目标点）
- 目标点：高德全国地点搜索添加，设置预期时间（精确到分），可改地点与时间
- 计划详情：列表（时间正序）/ 地图打点 两种视图

当前为**本地单机存储**，数据结构已预留 `userId` / `extra`，便于后续登录与字段扩展。

## 开发

```bash
npm install
npm run dev:weapp
```

用微信开发者工具打开项目根目录（或 `dist`，视本地 Taro 输出配置而定；本项目 `miniprogramRoot` 为 `dist/`）。

## 高德地图配置

编辑 `src/constants/index.ts`：

1. `AMAP_CONFIG.webServiceKey`：Web 服务 Key（地点搜索）
2. `AMAP_CONFIG.key`：小程序 Key（后续接入高德地图插件时使用）

并在[微信公众平台](https://mp.weixin.qq.com/) → 开发管理 → 开发设置 → 服务器域名中，将 `https://restapi.amap.com` 配为 **request 合法域名**。

申请地址：https://console.amap.com/dev/key/app

## 目录

```
src/
  pages/index          计划列表
  pages/plan-edit      新建/编辑计划
  pages/plan-detail    计划详情（列表/地图）
  pages/point-edit     添加/编辑目标点
  services/storage.ts  本地存储 CRUD
  services/amap.ts     高德地点搜索
  types/               数据模型
```

## 后续可扩展

- 微信登录与用户隔离
- 目标点备注、停留时长、完成状态
- 地图路线规划
- 服务端同步
