#!/usr/bin/env node
'use strict';

/**
 * npx k-shui — thin launcher for the k-shui Python CLI.
 *
 * Resolution order:
 *   1. `--docker`         -> docker run ghcr.io/k-shui/k-shui
 *   2. `uvx` on PATH      -> uvx --from k-shui k-shui <args>
 *   3. `uv` on PATH       -> uv tool run --from k-shui k-shui <args>
 *   4. `pipx` on PATH     -> pipx run --spec k-shui k-shui <args>
 *   5. otherwise, prompt (or --yes) to download uv to ~/.k-shui/bin, then re-exec via it.
 *
 * `init`, `serve`, `check`, `version`, etc. are all just forwarded to the real k-shui CLI —
 * this wrapper has no subcommands of its own besides --help/--docker/--yes.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const readline = require('node:readline');

const PACKAGE_NAME = 'k-shui';
const DOCKER_IMAGE = 'ghcr.io/k-shui/k-shui:latest';
const UV_INSTALL_DIR = path.join(os.homedir(), '.k-shui', 'bin');

function printHelp() {
  console.log(`k-shui - Kafka Streaming Hub UI

Usage:
  npx k-shui [args...]            Run k-shui via uv/uvx (auto-installed if needed) or pipx
  npx k-shui --docker [args...]   Run k-shui via Docker instead
  npx k-shui --yes [args...]      Skip the "install uv?" confirmation prompt
  npx k-shui --help               Show this help

Examples:
  npx k-shui serve --config k-shui.yaml --port 8090
  npx k-shui init
  npx k-shui --docker serve

k-shui prefers an existing 'uv'/'uvx' or 'pipx' on PATH. If neither is found, it offers
to install uv (https://astral.sh/uv) to ~/.k-shui/bin and re-exec through it. Pass
--docker to run the published container image instead (requires Docker).

Docs: https://github.com/k-shui/k-shui/tree/main/docs
`);
}

function commandExists(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) {
    console.error(`k-shui: failed to run "${cmd}": ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status === null ? 1 : res.status);
}

function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function runDocker(args) {
  if (!commandExists('docker')) {
    console.error('k-shui: --docker was requested but "docker" was not found on PATH.');
    process.exit(1);
  }
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'k-shui.yaml');
  const dockerArgs = [
    'run',
    '--rm',
    process.stdin.isTTY ? '-it' : '-i',
    '-p',
    '8090:8090',
    '-v',
    `${configPath}:/etc/k-shui/config.yaml`,
    DOCKER_IMAGE,
    ...(args.length ? args : ['serve']),
  ];
  run('docker', dockerArgs);
}

function installUv() {
  fs.mkdirSync(UV_INSTALL_DIR, { recursive: true });
  const env = { ...process.env, UV_INSTALL_DIR };
  if (process.platform === 'win32') {
    const res = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'],
      { stdio: 'inherit', env },
    );
    return res.status === 0;
  }
  const res = spawnSync('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
    stdio: 'inherit',
    env,
  });
  return res.status === 0;
}

async function main() {
  const rawArgv = process.argv.slice(2);

  if (rawArgv.includes('--help') || rawArgv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const yes = rawArgv.includes('--yes') || rawArgv.includes('-y');
  const argv = rawArgv.filter((a) => a !== '--yes' && a !== '-y');

  const dockerIdx = argv.indexOf('--docker');
  if (dockerIdx !== -1) {
    argv.splice(dockerIdx, 1);
    runDocker(argv);
    return;
  }

  if (commandExists('uvx')) {
    run('uvx', ['--from', PACKAGE_NAME, PACKAGE_NAME, ...argv]);
    return;
  }
  if (commandExists('uv')) {
    run('uv', ['tool', 'run', '--from', PACKAGE_NAME, PACKAGE_NAME, ...argv]);
    return;
  }
  if (commandExists('pipx')) {
    run('pipx', ['run', '--spec', PACKAGE_NAME, PACKAGE_NAME, ...argv]);
    return;
  }

  console.log('k-shui: neither "uv"/"uvx" nor "pipx" was found on PATH.');
  const ok = yes || (await confirm(`Download uv (https://astral.sh/uv) to ${UV_INSTALL_DIR} now?`));
  if (!ok) {
    console.error('k-shui: aborted. Install uv <https://astral.sh/uv> or pipx, or pass --docker.');
    process.exit(1);
  }

  console.log(`k-shui: installing uv to ${UV_INSTALL_DIR} ...`);
  if (!installUv()) {
    console.error('k-shui: failed to install uv. Install it manually from https://astral.sh/uv.');
    process.exit(1);
  }

  const uvxBin = path.join(UV_INSTALL_DIR, process.platform === 'win32' ? 'uvx.exe' : 'uvx');
  run(uvxBin, ['--from', PACKAGE_NAME, PACKAGE_NAME, ...argv]);
}

main();
