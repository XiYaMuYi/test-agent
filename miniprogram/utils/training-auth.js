/**
 * 训练模块登录守卫。
 * 未登录（本地无 token 或 open_id）时跳转公主购登录页。
 */

/** 未登录则跳转登录页并返回 false；已登录返回 true。 */
export function requireLogin() {
  const token = wx.getStorageSync('token');
  const openId = wx.getStorageSync('open_id');
  if (!token || !openId) {
    getApp().commonNoLogin();
    return false;
  }
  return true;
}

/** 仅检查登录态（不跳转），用于 onShow 恢复加载。 */
export function isLoggedIn() {
  const token = wx.getStorageSync('token');
  const openId = wx.getStorageSync('open_id');
  return !!(token && openId);
}
