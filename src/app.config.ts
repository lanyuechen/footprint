export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/plan-edit/index',
    'pages/plan-detail/index',
    'pages/point-edit/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1a5f4a',
    navigationBarTitleText: '足迹规划',
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
