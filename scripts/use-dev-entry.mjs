import { copyFileSync, existsSync } from 'node:fs';

if (!existsSync('index.dev.html')) {
  throw new Error('缺少 index.dev.html（开发入口模板）');
}
copyFileSync('index.dev.html', 'index.html');
