import { extractPureDomain } from '../../utils/domain';
import { getDomains, setDomains } from '../../utils/storage';
import { updateNetRules } from '../../utils/dnr';

let currentPureDomain = '';

document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup() {
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
  const openOptions = document.getElementById('openOptions') as HTMLAnchorElement;

  // 点击跳转到高级管理页
  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 1. 获取当前活跃的标签页 URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showSystemPage('无法获取当前标签页');
    return;
  }

  // 2. 过滤掉 Chrome 内部特权页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showSystemPage('Chrome 系统页面（禁止跨域修改）');
    return;
  }

  // 3. 智能清洗出纯域名/Host
  currentPureDomain = extractPureDomain(tab.url);
  if (!currentPureDomain) {
    showSystemPage('无法解析的网址格式');
    return;
  }
  document.getElementById('currentDomain')!.textContent = currentPureDomain;

  // 4. 检查当前域名是否已存在，并刷新 UI
  await checkAndUpdateUI();

  // 5. 绑定一键添加/删除按钮事件
  actionBtn.addEventListener('click', toggleDomainStatus);
}

// 检查状态并刷新 UI 样式
async function checkAndUpdateUI() {
  const statusText = document.getElementById('statusText')!;
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;

  const domains = await getDomains();
  const isAdded = domains.includes(currentPureDomain);

  actionBtn.style.display = 'block';
  if (isAdded) {
    statusText.textContent = '已开启泛域名跨域放行';
    statusText.className = 'status active';
    actionBtn.textContent = '一键移除白名单';
    actionBtn.className = 'btn-remove';
  } else {
    statusText.textContent = '当前域名未开启跨域';
    statusText.className = 'status inactive';
    actionBtn.textContent = '一键允许此网站跨域';
    actionBtn.className = 'btn-add';
  }
}

// 按钮点击：切换添加/删除状态
async function toggleDomainStatus() {
  const domains = await getDomains();
  const index = domains.indexOf(currentPureDomain);

  if (index > -1) {
    domains.splice(index, 1);
  } else {
    domains.push(currentPureDomain);
  }

  await setDomains(domains);
  // 同步 DNR 规则，保证弹窗与配置页完全一致
  await updateNetRules(domains);
  // 通知 background 立刻刷新图标 Badge
  chrome.runtime.sendMessage({ action: 'refreshBadge' });

  await checkAndUpdateUI();
}

// 针对系统特权页面的置灰显示
function showSystemPage(msg: string) {
  document.getElementById('currentDomain')!.textContent = 'N/A';
  const statusText = document.getElementById('statusText')!;
  statusText.textContent = msg;
  statusText.className = 'status system';
  (document.getElementById('actionBtn') as HTMLButtonElement).style.display = 'none';
}
