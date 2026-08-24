#!/usr/bin/env node
'use strict';

/**
 * npx k-shui — thin launcher for the k-shui Python CLI.
 *
 * Resolution order:
 *   1. `--docker`         -> docker run ghcr.io/thadchas/k-shui
 *   2. `uvx` on PATH      -> uvx --from <spec> k-shui <args>
 *   3. `uv` on PATH       -> uv tool run --from <spec> k-shui <args>
 *   4. `pipx` on PATH     -> pipx run --spec <spec> k-shui <args>
 *   5. otherwise, prompt (or --yes) to download uv to ~/.k-shui/bin, then re-exec via it.
 *
 * `<spec>` defaults to the PyPI package name `k-shui`, and can be overridden with
 * `--from <spec>` or the `KSHUI_UVX_FROM` environment variable — a local wheel/sdist
 * path, a directory, or a PEP 508 / git requirement. That is the escape hatch for
 * pre-release builds that are not on PyPI yet, e.g.
 *
 *   KSHUI_UVX_FROM=./backend/dist/k_shui-0.1.0-py3-none-any.whl npx k-shui version
 *   npx k-shui --from 'git+https://github.com/thadchas/k-shui@main#subdirectory=backend' serve
 *
 * `init`, `serve`, `check`, `version`, etc. are all just forwarded to the real k-shui CLI —
 * this wrapper has no subcommands of its own besides --help/--docker/--from/--dry-run/--yes.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const readline = require('node:readline');

const PACKAGE_NAME = 'k-shui';
const DOCKER_IMAGE = process.env.KSHUI_DOCKER_IMAGE || 'ghcr.io/thadchas/k-shui:latest';
const UV_INSTALL_DIR = path.join(os.homedir(), '.k-shui', 'bin');

/** Package spec handed to uvx/uv/pipx. Defaults to the published PyPI name. */
function resolveSpec(explicit) {
  const raw = explicit || process.env.KSHUI_UVX_FROM || PACKAGE_NAME;
  // A local wheel / sdist / project directory is made absolute so the spec keeps
  // working regardless of the cwd uvx resolves it from.
  if (/[\\/]/.test(raw) && !/^[a-z+]+:/i.test(raw)) {
    const abs = path.resolve(raw);
    if (fs.existsSync(abs)) return abs;
  }
  return raw;
}

function printHelp() {
  console.log(`k-shui - Kafka Streaming Hub UI

Usage:
  npx k-shui [args...]            Run k-shui via uv/uvx (auto-installed if needed) or pipx
  npx k-shui --docker [args...]   Run k-shui via Docker instead
  npx k-shui --from <spec>        Install k-shui from <spec> instead of PyPI
                                  (local wheel/sdist/dir path, or a git+https URL)
  npx k-shui --dry-run [args...]  Print the command that would run, then exit
  npx k-shui --yes [args...]      Skip the "install uv?" confirmation prompt
  npx k-shui --help               Show this help

Environment:
  KSHUI_UVX_FROM     Same as --from. Use this when k-shui is not on PyPI yet, e.g.
                     a locally built wheel: backend/dist/k_shui-0.1.0-py3-none-any.whl
  KSHUI_DOCKER_IMAGE Image used by --docker (default ${DOCKER_IMAGE})

Examples:
  npx k-shui serve --config k-shui.yaml --port 8090
  npx k-shui init
  npx k-shui --docker serve
  npx k-shui --docker --dry-run serve
  KSHUI_UVX_FROM=./backend/dist/k_shui-0.1.0-py3-none-any.whl npx k-shui version

k-shui prefers an existing 'uv'/'uvx' or 'pipx' on PATH. If neither is found, it offers
to install uv (https://astral.sh/uv) to ~/.k-shui/bin and re-exec through it. Pass
--docker to run the published container image instead (requires Docker).

Docs: https://github.com/thadchas/k-shui/tree/main/docs
`);
}

function commandExists(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function quote(arg) {
  return /[\s"'$`\\*?{}[\]()<>|&;#~]/.test(arg) ? `'${String(arg).replace(/'/g, `'\\''`)}'` : arg;
}

let DRY_RUN = false;

function run(cmd, args) {
  if (DRY_RUN) {
    console.log([cmd, ...args].map(quote).join(' '));
    process.exit(0);
  }
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
  if (!commandExists('docker') && !DRY_RUN) {
    console.error('k-shui: --docker was requested but "docker" was not found on PATH.');
    process.exit(1);
  }
  const configPath = path.join(process.cwd(), 'k-shui.yaml');
  const dockerArgs = ['run', '--rm', process.stdin.isTTY ? '-it' : '-i', '-p', '8090:8090'];
  // Only bind-mount the config when it actually exists — Docker would otherwise
  // create an empty *directory* at that path on the host.
  if (fs.existsSync(configPath)) {
    dockerArgs.push('-v', `${configPath}:/etc/k-shui/config.yaml`);
  }
  dockerArgs.push(DOCKER_IMAGE, ...(args.length ? args : ['serve']));
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

/** Pull the wrapper's own flags out of argv; everything else is forwarded verbatim. */
function parseWrapperFlags(rawArgv) {
  const rest = [];
  const opts = { yes: false, docker: false, dryRun: false, help: false, from: null };
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i];
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--docker') opts.docker = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--from') opts.from = rawArgv[++i];
    else if (a.startsWith('--from=')) opts.from = a.slice('--from='.length);
    else rest.push(a);
  }
  return { opts, argv: rest };
}

async function main() {
  const { opts, argv } = parseWrapperFlags(process.argv.slice(2));

  // `--help` on its own prints the wrapper's help. Combined with `--dry-run` it is
  // forwarded, so `--docker --dry-run --help` shows the docker command instead.
  if (opts.help && !opts.dryRun) {
    printHelp();
    process.exit(0);
  }

  DRY_RUN = opts.dryRun;
  if (opts.help) argv.push('--help');

  if (opts.docker) {
    runDocker(argv);
    return;
  }

  const spec = resolveSpec(opts.from);

  if (commandExists('uvx')) {
    run('uvx', ['--from', spec, PACKAGE_NAME, ...argv]);
    return;
  }
  if (commandExists('uv')) {
    run('uv', ['tool', 'run', '--from', spec, PACKAGE_NAME, ...argv]);
    return;
  }
  if (commandExists('pipx')) {
    run('pipx', ['run', '--spec', spec, PACKAGE_NAME, ...argv]);
    return;
  }

  const uvxBin = path.join(UV_INSTALL_DIR, process.platform === 'win32' ? 'uvx.exe' : 'uvx');
  if (DRY_RUN) {
    run(uvxBin, ['--from', spec, PACKAGE_NAME, ...argv]);
    return;
  }

  console.log('k-shui: neither "uv"/"uvx" nor "pipx" was found on PATH.');
  const ok = opts.yes || (await confirm(`Download uv (https://astral.sh/uv) to ${UV_INSTALL_DIR} now?`));
  if (!ok) {
    console.error('k-shui: aborted. Install uv <https://astral.sh/uv> or pipx, or pass --docker.');
    process.exit(1);
  }

  console.log(`k-shui: installing uv to ${UV_INSTALL_DIR} ...`);
  if (!installUv()) {
    console.error('k-shui: failed to install uv. Install it manually from https://astral.sh/uv.');
    process.exit(1);
  }

  run(uvxBin, ['--from', spec, PACKAGE_NAME, ...argv]);
}

main();
