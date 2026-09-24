export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/plan-edit/index',
    'pages/trip-edit/index',
    'pages/stop-edit/index',
    'pages/nav/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1a5f4a',
    navigationBarTitleText: '我的计划',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f6f7',
  },
  permission: {
    'scope.userLocation': {
      desc: '用于在地图上展示与选择地点',
    },
  },
  requiredPrivateInfos: ['getLocation'],
})
