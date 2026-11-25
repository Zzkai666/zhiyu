import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = join(root, '.toolchain', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
const out = join(root, 'dist', 'bin');
const bin = join(out, process.platform === 'win32' ? 'researchdesk-core.exe' : 'researchdesk-core');
const packages = ['./cmd/...', './internal/...', './scripts/...'];
const args = { build: ['build', '-trimpath', '-o', bin, './cmd/core'], test: ['test', ...packages], stub: ['build','-o',join(out,'rdnext-test-codex.exe'),'./scripts/test-codex'], tidy: ['mod', 'tidy'], fmt: ['fmt', ...packages] }[process.argv[2]];
if (!args) throw new Error('Expected build, test, tidy or fmt');
mkdirSync(out, { recursive: true });
const result = spawnSync(existsSync(local) ? local : 'go', args, {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0',
    GOPATH: process.env.GOPATH ?? join(root, '.toolchain', 'gopath'),
    GOCACHE: process.env.GOCACHE ?? join(root, '.toolchain', 'gocache'),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
