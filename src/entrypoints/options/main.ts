import { sanitizeAndValidateDomain } from '../../utils/domain';
import { getDomains, setDomains } from '../../utils/storage';
import { updateNetRules } from '../../utils/dnr';

let warningEl: HTMLParagraphElement | null = null;

// 在界面上显示错误提示
function showWarning(message: string) {
  if (!warningEl) {
    warningEl = document.createElement('p');
    warningEl.id = 'errorWarning';
    warningEl.style.color = '#ff4d4f';
    warningEl.style.fontSize = '12px';
    warningEl.style.marginTop = '4px';
    const container = document.getElementById('domainInput')!.parentNode;
    container?.appendChild(warningEl);
  }
  warningEl.textContent = message;
}

function clearWarning() {
  if (warningEl) warningEl.textContent = '';
}

// 加载并渲染域名列表，同时同步 DNR 规则
async function loadDomains() {
  const domains = await getDomains();
  const list = document.getElementById('domainList')!;
  list.innerHTML = '';

  domains.forEach((domain, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><strong>${domain}</strong> (已开启泛域名无缝跨域)</span>
      <button class="delete-btn" data-index="${index}">删除</button>
    `;
    list.appendChild(li);
  });

  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const index = Number((e.target as HTMLElement).dataset.index);
      deleteDomain(index);
    });
  });

  await updateNetRules(domains);
}

// 添加新域名（含智能清洗、合法性校验、查重）
async function addDomain() {
  const input = document.getElementById('domainInput') as HTMLInputElement;
  clearWarning();

  if (!input.value.trim()) {
    showWarning('输入不能为空！');
    return;
  }

  const pureDomain = sanitizeAndValidateDomain(input.value);
  if (pureDomain === null) {
    showWarning('请输入合法的域名、本地 Host 或 IP 地址！(例如: localhost 或 test.com)');
    return;
  }

  const domains = await getDomains();
  if (domains.includes(pureDomain)) {
    showWarning('该域名已经在跨域允许列表中了，无需重复添加。');
    return;
  }

  domains.push(pureDomain);
  await setDomains(domains);
  input.value = '';
  await loadDomains();
}

async function deleteDomain(index: number) {
  const domains = await getDomains();
  if (index < 0 || index >= domains.length) return;
  domains.splice(index, 1);
  await setDomains(domains);
  await loadDomains();
}

// 统一在 DOM 就绪后绑定事件与初始化（避免脚本提前访问 DOM 元素）
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addBtn')!.addEventListener('click', addDomain);
  loadDomains();
});
