document.addEventListener('DOMContentLoaded', initPopup);

let currentPureDomain = '';

async function initPopup() {
  const actionBtn = document.getElementById('actionBtn');
  const openOptions = document.getElementById('openOptions');
  
  // 点击跳转到高级管理页
  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 1. 获取当前活跃的标签页 URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    showSystemPage('无法获取当前标签页');
    return;
  }

  const url = tab.url;

  // 2. 过滤掉 Chrome 内部特权页面
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    showSystemPage('🔒 Chrome 系统页面（禁止跨域修改）');
    return;
  }

  // 3. 智能清洗出纯域名/Host
  try {
    const urlObj = new URL(url);
    // 剔除端口，只留纯 Host
    currentPureDomain = urlObj.hostname.toLowerCase(); 
    document.getElementById('currentDomain').textContent = currentPureDomain;
  } catch (e) {
    showSystemPage('❌ 无法解析的网址格式');
    return;
  }

  // 4. 检查当前域名是否已存在，并刷新 UI
  checkAndUpdateUI();

  // 5. 绑定一键添加/删除按钮事件
  actionBtn.addEventListener('click', toggleDomainStatus);
}

// 检查状态并刷新 UI 样式
async function checkAndUpdateUI() {
  const statusText = document.getElementById('statusText');
  const actionBtn = document.getElementById('actionBtn');
  
  const data = await chrome.storage.local.get({ domains: [] });
  const isAdded = data.domains.includes(currentPureDomain);

  actionBtn.style.display = 'block';

  if (isAdded) {
    statusText.textContent = '✅ 已开启泛域名跨域放行';
    statusText.className = 'status active';
    actionBtn.textContent = '一键移除白名单';
    actionBtn.className = 'btn-remove';
  } else {
    statusText.textContent = '💡 当前域名未开启跨域';
    statusText.className = 'status inactive';
    actionBtn.textContent = '一键允许此网站跨域';
    actionBtn.className = 'btn-add';
  }
}

// 按钮点击：切换添加/删除状态
async function toggleDomainStatus() {
  const data = await chrome.storage.local.get({ domains: [] });
  const index = data.domains.indexOf(currentPureDomain);

  if (index > -1) {
    // 如果已有，则移除
    data.domains.splice(index, 1);
  } else {
    // 如果没有，则添加
    data.domains.push(currentPureDomain);
  }

  // 写入存储
  await chrome.storage.local.set({ domains: data.domains });
  
  // 🚀 核心同步：调用 DNR 规则同步更新浏览器底层网络拦截库
  await updateNetRules(data.domains);

  // 🚀 新增这行：通知 background.js 立刻刷新右上角图标的 Badge 状态！
  chrome.runtime.sendMessage({ action: 'refreshBadge' });
  
  // 刷新当前弹窗 UI
  checkAndUpdateUI();
}

// 针对系统特权页面的置灰显示
function showSystemPage(msg) {
  document.getElementById('currentDomain').textContent = 'N/A';
  const statusText = document.getElementById('statusText');
  statusText.textContent = msg;
  statusText.className = 'status system';
  document.getElementById('actionBtn').style.display = 'none';
}

// 🌟 直接复用 options.js 中的 DNR 规则写入逻辑，确保弹窗点击和配置页完全同步
async function updateNetRules(domains) {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = oldRules.map(rule => rule.id);

  if (domains.length === 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    return;
  }

  const newRules = domains.map((pureDomain, index) => {
    return {
      id: index + 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { "header": "Access-Control-Allow-Origin", "operation": "set", "value": "*" },
          { "header": "Access-Control-Allow-Methods", "operation": "set", "value": "GET, POST, PUT, DELETE, OPTIONS" },
          { "header": "Access-Control-Allow-Headers", "operation": "set", "value": "*" }
        ]
      },
      condition: {
        initiatorDomains: [pureDomain],
        urlFilter: "|http*",
        resourceTypes: ["xmlhttprequest", "ping"]
      }
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: newRules
  });
}