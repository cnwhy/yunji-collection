document.addEventListener('DOMContentLoaded', loadDomains);
document.getElementById('addBtn').addEventListener('click', addDomain);

// 辅助函数：在界面上显示/清除错误提示
function showWarning(message) {
  let warningEl = document.getElementById('errorWarning');
  if (!warningEl) {
    warningEl = document.createElement('p');
    warningEl.id = 'errorWarning';
    warningEl.style.color = '#ff4d4f';
    warningEl.style.fontSize = '12px';
    warningEl.style.marginTop = '4px';
    // 把提示语插入到输入框所在的容器里
    const container = document.getElementById('domainInput').parentNode;
    container.appendChild(warningEl);
  }
  warningEl.textContent = message;
}

function clearWarning() {
  const warningEl = document.getElementById('errorWarning');
  if (warningEl) warningEl.textContent = '';
}

// 加载并渲染域名列表
async function loadDomains() {
  const data = await chrome.storage.local.get({ domains: [] });
  const list = document.getElementById('domainList');
  list.innerHTML = '';

  data.domains.forEach((domain, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><strong>${domain}</strong> (已开启泛域名无缝跨域)</span>
      <button class="delete-btn" data-index="${index}">删除</button>
    `;
    list.appendChild(li);
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => deleteDomain(e.target.dataset.index));
  });

  updateNetRules(data.domains);
}

// 🌟 核心改进：添加新域名（含多重智能检测与清洗）
async function addDomain() {
  const input = document.getElementById('domainInput');
  let rawInput = input.value.trim();
  
  clearWarning(); // 每次点击先清空上一次的错误

  if (!rawInput) {
    showWarning('⚠️ 输入不能为空！');
    return;
  }

  // 🧪 智能清洗第一步：如果用户直接粘贴了完整的 URL，提取出它的 Host
  if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
    try {
      const urlObj = new URL(rawInput);
      rawInput = urlObj.hostname; // 提取纯 Host (例如 localhost 或 baidu.com)
    } catch (e) {
      showWarning('⚠️ 无法解析的 URL 格式！');
      return;
    }
  }

  // 🧪 智能清洗第二步：如果用户带了端口号（如 localhost:3001），砍掉端口，只留域名
  let pureDomain = rawInput.split(':')[0].toLowerCase();

  // 🧪 核心安全检测：使用标准的域名/IP 正则表达式进行验证
  // 支持: localhost、127.0.0.1、标准线上域名(example.com)、甚至泛域名形式
  const domainRegex = /^(localhost|((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)|([a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.)+[a-zA-Z]{2,})$/;

  if (!domainRegex.test(pureDomain)) {
    showWarning('⚠️ 请输入合法的域名、本地 Host 或 IP 地址！(例如: localhost 或 test.com)');
    return;
  }

  // 🧪 第三步：查重检测
  const data = await chrome.storage.local.get({ domains: [] });
  if (data.domains.includes(pureDomain)) {
    showWarning('💡 该域名已经在跨域允许列表中了，无需重复添加。');
    return;
  }

  // 校验全部通过，写入存储
  data.domains.push(pureDomain);
  await chrome.storage.local.set({ domains: data.domains });
  input.value = ''; // 清空输入框
  loadDomains();     // 重新渲染
}

async function deleteDomain(index) {
  const data = await chrome.storage.local.get({ domains: [] });
  data.domains.splice(index, 1);
  await chrome.storage.local.set({ domains: data.domains });
  loadDomains();
}

// 底层 DNR 规则映射
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