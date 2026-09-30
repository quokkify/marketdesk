import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const [workflow, backend, frontend, assets, frontendNginx, assetsNginx] = await Promise.all([
  read('.github/workflows/container-images.yml'),
  read('Dockerfile'),
  read('Dockerfile.frontend'),
  read('Dockerfile.assets'),
  read('docker/nginx/frontend.conf'),
  read('docker/nginx/assets.conf'),
]);

for (const [image, dockerfile] of [
  ['backend', 'Dockerfile'],
  ['frontend', 'Dockerfile.frontend'],
  ['assets', 'Dockerfile.assets'],
]) {
  assert.match(workflow, new RegExp(`image: ${image}\\s+dockerfile: ${dockerfile.replaceAll('.', '\\.')}\\b`));
}
assert.match(workflow, /pull_request:[\s\S]*?push:[\s\S]*?branches: \[main\][\s\S]*?tags: \['marketdesk-v\*'\]/);
assert.match(workflow, /push: \$\{\{ github\.event_name != 'pull_request' \}\}/);
assert.match(workflow, /packages: write/);
assert.match(workflow, /MARKETDESK_RELEASE_TAG=/);
assert.match(backend, /USER nodejs/);
assert.match(backend, /dist\/backend\/main\.js/);
assert.match(backend, /localhost:3000\/health/);
assert.match(frontend, /npm run build:frontend/);
assert.match(frontend, /dist\/frontend\//);
assert.match(frontendNginx, /try_files \$uri \$uri\/ \/index\.html/);
assert.match(assets, /marketdesk-mark\.svg/);
assert.match(assets, /favicon-32x32\.png/);
assert.match(assets, /apple-touch-icon\.png/);
assert.match(assets, /marketdesk-mark\.svg \\| exit 1/);
assert.match(assetsNginx, /try_files \$uri =404/);
assert.match(assetsNginx, /Access-Control-Allow-Origin/);
console.log('Container image workflow and runtime contracts verified.');
