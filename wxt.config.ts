import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
import pkg from './package.json';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'CORS 跨域跳板',
    description: '动态配置允许跨域的发起方域名',
    version: pkg.version,
    permissions: [
      'declarativeNetRequest',
      'storage',
      'tabs',
      'activeTab',
      'scripting',
      'contextMenus',
      'offscreen',
      'cookies',
    ],
    host_permissions: ['<all_urls>'],
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Ctrl+Y',
          mac: 'Command+Y',
        },
      },
    },
  },
});
