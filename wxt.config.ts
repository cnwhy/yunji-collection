import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
import pkg from './package.json';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: '云笈收藏助手',
    description: '一键收藏网页到云笈导航站',
    version: pkg.version,
    permissions: [
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'storage',
      'tabs',
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
