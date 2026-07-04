/**
 * NPM pack 本地安装验收 — 需在仓库根目录已执行 npm run build 后运行
 * 验证：npm pack → npm install ./tgz → npx agentwatch --help → proxy 启动
 */
import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packTimeoutMs = 120_000;

function findRepoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
      if (pkg.name === '@agentwatch-web3/cli') {
        return dir;
      }
    }
    dir = dirname(dir);
  }
  throw new Error('Unable to locate @agentwatch-web3/cli repository root');
}

function run(command: string, cwd: string, env?: NodeJS.ProcessEnv): string {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
  } catch (cause) {
    const err = cause as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const detail = err.stderr?.toString() ?? err.stdout?.toString() ?? err.message ?? String(cause);
    console.error(`[pack-install] command failed: ${command}\n${detail}`);
    throw cause;
  }
}

function resolveCliCommand(installDir: string): { cmd: string; args: string[] } {
  for (const binName of ['agentwatch-web3', 'agentwatch']) {
    const binPath = join(installDir, 'node_modules', '.bin', binName);
    if (existsSync(binPath)) {
      return { cmd: binPath, args: [] };
    }
  }
  const entry = join(
    installDir,
    'node_modules',
    '@agentwatch-web3',
    'cli',
    'dist',
    'packages',
    'local',
    'src',
    'cli',
    'index.js',
  );
  if (existsSync(entry)) {
    return { cmd: process.execPath, args: [entry] };
  }
  throw new Error(`agentwatch CLI not found under ${installDir}`);
}

function runCli(installDir: string, cliArgs: string[]): string {
  const { cmd, args } = resolveCliCommand(installDir);
  const result = spawnSync(cmd, [...args, ...cliArgs], {
    cwd: installDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = result.stderr ?? result.stdout ?? `exit ${result.status}`;
    console.error(`[pack-install] CLI failed: ${cmd} ${[...args, ...cliArgs].join(' ')}\n${detail}`);
    throw new Error(`CLI exited with status ${result.status}`);
  }
  return result.stdout ?? '';
}

describe.skipIf(process.env['PACK_VERIFY'] !== '1')('NPM pack install verification', () => {
  let installDir = '';
  let packFile = '';
  let previousHome: string | undefined;
  let previousApiKey: string | undefined;
  let previousOkxApiKey: string | undefined;
  let previousOkxSecretKey: string | undefined;
  let previousOkxPassphrase: string | undefined;
  let previousOkxProjectId: string | undefined;

  beforeAll(() => {
    previousHome = process.env['HOME'];
    previousApiKey = process.env['AGENTWATCH_API_KEY'];
    previousOkxApiKey = process.env['OKX_API_KEY'];
    previousOkxSecretKey = process.env['OKX_SECRET_KEY'];
    previousOkxPassphrase = process.env['OKX_PASSPHRASE'];
    previousOkxProjectId = process.env['OKX_PROJECT_ID'];
    installDir = mkdtempSync(join(tmpdir(), 'agentwatch-pack-install-'));
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-pack-home-'));
    process.env['AGENTWATCH_API_KEY'] = 'pack-verify-test-key';
    process.env['OKX_API_KEY'] = 'pack-verify-test-key';
    process.env['OKX_SECRET_KEY'] = 'pack-verify-test-key';
    process.env['OKX_PASSPHRASE'] = 'pack-verify-test-key';
    process.env['OKX_PROJECT_ID'] = 'pack-verify-test-key';

    const repoRoot = findRepoRoot();
    const builtCli = join(
      repoRoot,
      'dist/packages/local/src/cli/index.js',
    );
    if (!existsSync(builtCli)) {
      run('npm run build', repoRoot);
    }

    const packOutput = run('npm pack --silent', repoRoot);
    const tarballName = packOutput.trim().split('\n').pop()?.trim();
    if (tarballName === undefined || tarballName.length === 0) {
      throw new Error('npm pack did not produce tarball name');
    }
    packFile = join(repoRoot, tarballName);
    if (!existsSync(packFile)) {
      throw new Error(`tarball not found: ${packFile}`);
    }

    run('npm init -y', installDir);
    run(`npm install --no-audit --no-fund ${JSON.stringify(packFile)}`, installDir);
    runCli(installDir, ['init']);
  }, packTimeoutMs);

  afterAll(() => {
    try {
      if (installDir.length > 0 && existsSync(installDir)) {
        rmSync(installDir, { recursive: true, force: true });
      }
      if (packFile.length > 0 && existsSync(packFile)) {
        rmSync(packFile, { force: true });
      }
    } catch {
      // cleanup
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    if (previousApiKey === undefined) {
      delete process.env['AGENTWATCH_API_KEY'];
    } else {
      process.env['AGENTWATCH_API_KEY'] = previousApiKey;
    }
    if (previousOkxApiKey === undefined) {
      delete process.env['OKX_API_KEY'];
    } else {
      process.env['OKX_API_KEY'] = previousOkxApiKey;
    }
    if (previousOkxSecretKey === undefined) {
      delete process.env['OKX_SECRET_KEY'];
    } else {
      process.env['OKX_SECRET_KEY'] = previousOkxSecretKey;
    }
    if (previousOkxPassphrase === undefined) {
      delete process.env['OKX_PASSPHRASE'];
    } else {
      process.env['OKX_PASSPHRASE'] = previousOkxPassphrase;
    }
    if (previousOkxProjectId === undefined) {
      delete process.env['OKX_PROJECT_ID'];
    } else {
      process.env['OKX_PROJECT_ID'] = previousOkxProjectId;
    }
  });

  it('installs agentwatch bin and prints CLI help', () => {
    const help = runCli(installDir, ['--help']);
    expect(help).toContain('AgentWatch MCP 安全代理');
    expect(help).toMatch(/proxy|init|status|logs|audit/);
    expect(help).toContain('AgentWatch MCP 安全代理');
  });

  it(
    'starts proxy and creates ~/.agentwatch directory with SQLite database',
    { timeout: packTimeoutMs },
    async () => {
      const { cmd, args } = resolveCliCommand(installDir);
      const agentWatchHome = join(process.env['HOME']!, '.agentwatch');

      const child = spawn(cmd, [...args, 'proxy', '--', 'node', '-e', 'process.stdin.pipe(process.stdout)'], {
        cwd: installDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stderrLog = '';

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(
            new Error(
              `proxy startup timeout${stderrLog.length > 0 ? `: ${stderrLog.slice(0, 500)}` : ''}`,
            ),
          );
        }, 30_000);

        const poll = setInterval(() => {
          if (existsSync(join(agentWatchHome, 'agentwatch.db'))) {
            clearTimeout(timeout);
            clearInterval(poll);
            resolve();
          }
        }, 100);

        const onData = (chunk: Buffer) => {
          const text = chunk.toString();
          stderrLog += text;
          if (text.includes('gateway_ready')) {
            clearTimeout(timeout);
            clearInterval(poll);
            resolve();
          }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (error) => {
          clearTimeout(timeout);
          clearInterval(poll);
          reject(error);
        });
        child.on('exit', (code) => {
          if (code !== null && code !== 0 && !existsSync(join(agentWatchHome, 'agentwatch.db'))) {
            clearTimeout(timeout);
            clearInterval(poll);
            reject(new Error(`proxy exited early code=${String(code)} stderr=${stderrLog.slice(0, 500)}`));
          }
        });
      });

      expect(existsSync(agentWatchHome)).toBe(true);
      expect(existsSync(join(agentWatchHome, 'agentwatch.db'))).toBe(true);

      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        setTimeout(resolve, 2000);
      });
    },
  );
});
