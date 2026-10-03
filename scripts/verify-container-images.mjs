import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const [workflow, backend, frontend, assets, assetsManifest, frontendCaddy, assetsCaddy, caddyDeployment] = await Promise.all([
  read('.github/workflows/container-images.yml'),
  read('Dockerfile'),
  read('Dockerfile.frontend'),
  read('Dockerfile.assets'),
  read('public/assets-manifest.json'),
  read('docker/caddy/frontend.Caddyfile'),
  read('docker/caddy/assets.Caddyfile'),
  read('docs/deployment/caddy-cloudflare-vps.md'),
]);

for (const [image, dockerfile] of [
  ['backend', 'Dockerfile'],
  ['frontend', 'Dockerfile.frontend'],
  ['assets', 'Dockerfile.assets'],
]) {
  assert.match(workflow, new RegExp(`image: ${image}\\s+dockerfile: ${dockerfile.replaceAll('.', '\\.')}\\b`));
}
assert.match(workflow, /pull_request:[\s\S]*?push:[\s\S]*?branches: \[main\][\s\S]*?tags: \['marketdesk-v\*', 'backend-v\*', 'frontend-v\*', 'assets-v\*'\]/);
assert.match(workflow, /Select image for release tag[\s\S]*?\$\{IMAGE_NAME\}-v[\s\S]*?steps\.release-image\.outputs\.include == 'true'/);
assert.match(workflow, /push: \$\{\{ github\.event_name != 'pull_request' \}\}/);
assert.match(workflow, /packages: write/);
assert.match(workflow, /MARKETDESK_RELEASE_TAG=/);
assert.match(workflow, /concurrency:[\s\S]*?cancel-in-progress: false/);
assert.match(workflow, /group: container-images-\$\{\{[\s\S]*?github\.ref_name \|\| github\.ref \}\}/);
assert.match(workflow, /if \[\[ "\$IMAGE_NAME" == backend && "\$REF_TYPE" == tag \]\]; then[\s\S]*?sha_namespace="sha-release"/);
assert.match(workflow, /if \[\[ "\$EVENT_NAME" == push && "\$REF_TYPE" == tag \]\]; then[\s\S]*?\$\{image\}:\$\{REF_NAME\}/);
assert.match(workflow, /promote-main:[\s\S]*?needs: build[\s\S]*?if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[\s\S]*?git rev-parse HEAD/);
assert.match(workflow, /run: node scripts\/promote-container-images\.mjs/);
const promotion = await read('scripts/promote-container-images.mjs');
assert.match(promotion, /all :main aliases reconciled/);
assert.match(promotion, /complete-set reconciliation failed/);
assert.match(promotion, /imagetools', 'create', '--tag', tag, source/);
assert.doesNotMatch(promotion, /gh', \['api'|--method', 'DELETE'/);
assert.doesNotMatch(workflow.match(/- name: Resolve image tags[\s\S]*?- name: Build and publish/)[0], /:main/);
assert.match(backend, /USER nodejs/);
assert.match(backend, /dist\/backend\/main\.js/);
assert.match(backend, /localhost:3000\/health/);
assert.match(frontend, /npm run build:frontend/);
assert.match(frontend, /dist\/frontend\//);
assert.match(frontend, /FROM caddy:2\.10\.2-alpine/);
assert.match(assets, /FROM caddy:2\.10\.2-alpine/);
assert.doesNotMatch(frontend + assets, /nginx/i);
assert.match(frontendCaddy, /root \* \/srv/);
assert.match(frontendCaddy, /try_files \{path\} \{path\}\/ \/index\.html/);
assert.match(frontendCaddy, /file_server/);
assert.match(assets, /marketdesk-mark\.svg/);
assert.match(assets, /favicon-32x32\.png/);
assert.match(assets, /apple-touch-icon\.png/);
assert.match(assets, /assets-manifest\.json/);
assert.match(assetsManifest, /"component":\s*"assets"/);
assert.match(assetsManifest, /"tagPrefix":\s*"assets-v"/);
assert.match(assets, /marketdesk-mark\.svg \\| exit 1/);
assert.match(assetsCaddy, /file_server/);
assert.match(assetsCaddy, /Access-Control-Allow-Origin/);
const deploymentGuide = await read('docs/deployment/container-images.md');
assert.match(deploymentGuide, /Recommended current VPS deployment[\s\S]*host Caddy[\s\S]*127\.0\.0\.1:3000/);
assert.match(deploymentGuide, /Optional future split-image deployment[\s\S]*frontend[\s\S]*assets[\s\S]*127\.0\.0\.1:3001:8080[\s\S]*127\.0\.0\.1:3002:8080/);
assert.match(deploymentGuide, /never bind the static services to `0\.0\.0\.0` or public interfaces/i);
assert.match(caddyDeployment, /host proxies to the combined Compose `app` image bound to loopback at `127\.0\.0\.1:3000`/);
console.log('Container image workflow and runtime contracts verified.');
