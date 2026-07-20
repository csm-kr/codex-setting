#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIONS = new Set(['install', 'update', 'status', 'uninstall']);
const HOOK_FILENAME = 'rename_prompt_hook.mjs';
const WINDOWS_HELPER_FILENAME = 'codex_tui_insert.exe';
const POSIX_HELPER_FILENAME = 'codex_tui_insert';
const STATUS_PREFIX = 'Rename suggestion:';
const SOURCE_HOOK = fileURLToPath(new URL(`./hook/${HOOK_FILENAME}`, import.meta.url));
const SOURCE_WINDOWS_HELPER = fileURLToPath(new URL('./hook/windows/codex_tui_insert.cs', import.meta.url));
const SOURCE_POSIX_HELPER = fileURLToPath(new URL('./hook/posix/codex_tui_insert.c', import.meta.url));
const LEGACY_FILENAMES = [
  'auto_rename_session.mjs',
  'auto_rename_session_remote.mjs',
  'auto_rename_title_suggester.mjs',
  'codex_tui_rename.exe',
];

function printUsage() {
  process.stdout.write(`Usage:
  node install.mjs [install|update] [project-path]
  node install.mjs status [project-path]
  node install.mjs uninstall [project-path]
`);
}

function parseArguments(args) {
  if (args.includes('--help') || args.includes('-h')) return { action: 'help' };
  const values = [...args];
  const action = ACTIONS.has(values[0]) ? values.shift() : 'install';
  const targetRoot = path.resolve(values.shift() ?? process.cwd());
  if (values.length > 0) throw new Error(`Unexpected argument: ${values[0]}`);
  return { action, targetRoot };
}

function projectPaths(targetRoot) {
  const codexDirectory = path.join(targetRoot, '.codex');
  const hookDirectory = path.join(codexDirectory, 'hooks');
  return {
    codexDirectory,
    hookDirectory,
    configFile: path.join(codexDirectory, 'hooks.json'),
    hookFile: path.join(hookDirectory, HOOK_FILENAME),
    helperFile: path.join(
      hookDirectory,
      process.platform === 'win32' ? WINDOWS_HELPER_FILENAME : POSIX_HELPER_FILENAME,
    ),
  };
}

async function pathExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function readConfig(filePath) {
  try {
    const config = JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('The root value must be an object.');
    }
    return config;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
}

function isManagedHook(hook) {
  if (!hook || hook.type !== 'command') return false;
  const commands = [hook.command, hook.commandWindows].filter((value) => typeof value === 'string');
  return commands.some((command) =>
    command.includes(HOOK_FILENAME) || LEGACY_FILENAMES.some((name) => command.includes(name)),
  ) || String(hook.statusMessage ?? '').startsWith(STATUS_PREFIX) ||
    String(hook.statusMessage ?? '').startsWith('Auto thread title:') ||
    String(hook.statusMessage ?? '').startsWith('Remote auto thread title:');
}

function removeManagedHandlers(config) {
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) return config;
  for (const [eventName, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) continue;
    config.hooks[eventName] = groups
      .map((group) => !Array.isArray(group?.hooks)
        ? group
        : { ...group, hooks: group.hooks.filter((hook) => !isManagedHook(hook)) })
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (config.hooks[eventName].length === 0) delete config.hooks[eventName];
  }
  if (Object.keys(config.hooks).length === 0) delete config.hooks;
  return config;
}

function quotePosix(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quoteWindows(value) {
  if (value.includes('"')) throw new Error(`Unsupported quote in Windows path: ${value}`);
  return `"${value}"`;
}

function addManagedHandler(config, hookFile) {
  config.description = 'Insert a summarized /rename command and let the user press Enter.';
  config.hooks ??= {};
  config.hooks.UserPromptSubmit ??= [];
  config.hooks.UserPromptSubmit.push({
    hooks: [{
      type: 'command',
      command: `node ${quotePosix(hookFile.replaceAll('\\', '/'))}`,
      commandWindows: `node ${quoteWindows(hookFile)}`,
      timeout: 90,
      statusMessage: `${STATUS_PREFIX} preparing /rename text`,
    }],
  });
  return config;
}

async function replaceFile(filePath, data, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data, options);
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code) || !(await pathExists(filePath))) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    const backup = `${filePath}.${process.pid}.${Date.now()}.bak`;
    await fs.rename(filePath, backup);
    try {
      await fs.rename(temporary, filePath);
      await fs.rm(backup, { force: true });
    } catch (replacementError) {
      if (await pathExists(backup)) {
        await fs.rm(filePath, { force: true });
        await fs.rename(backup, filePath);
      }
      throw replacementError;
    }
  }
}

async function runCompiler(command, args) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Compiler failed (code=${code}, signal=${signal}): ${stderr || stdout}`));
    });
  });
}

async function compileHelper(targetFile) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const temporary = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (process.platform === 'win32') {
      const windowsDirectory = process.env.WINDIR || 'C:\\Windows';
      const candidates = [
        path.join(windowsDirectory, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
        path.join(windowsDirectory, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
      ];
      let selected = null;
      for (const candidate of candidates) {
        if (await pathExists(candidate)) { selected = candidate; break; }
      }
      if (!selected) throw new Error('The Windows C# compiler csc.exe was not found.');
      await runCompiler(selected, [
        '/nologo', '/optimize+', '/target:exe', `/out:${temporary}`, SOURCE_WINDOWS_HELPER,
      ]);
    } else {
      await runCompiler(process.env.CC?.trim() || 'cc', [
        '-O2', '-Wall', '-Wextra', '-o', temporary, SOURCE_POSIX_HELPER,
      ]);
    }
    await replaceFile(targetFile, await fs.readFile(temporary), { mode: 0o755 });
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function removeLegacyFiles(paths) {
  for (const name of LEGACY_FILENAMES) {
    await fs.rm(path.join(paths.hookDirectory, name), { force: true });
  }
  await fs.rm(path.join(paths.codexDirectory, 'codex_remote.mjs'), { force: true });
  const unusedHelper = path.join(
    paths.hookDirectory,
    process.platform === 'win32' ? POSIX_HELPER_FILENAME : WINDOWS_HELPER_FILENAME,
  );
  await fs.rm(unusedHelper, { force: true });
}

async function install(targetRoot) {
  const stat = await fs.stat(targetRoot).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Project directory does not exist: ${targetRoot}`);
  const paths = projectPaths(targetRoot);
  const config = addManagedHandler(removeManagedHandlers(await readConfig(paths.configFile)), paths.hookFile);
  await replaceFile(paths.hookFile, await fs.readFile(SOURCE_HOOK), { mode: 0o755 });
  await compileHelper(paths.helperFile);
  await removeLegacyFiles(paths);
  await replaceFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  process.stdout.write(`Installed the /rename suggestion hook:\n${targetRoot}\n`);
  process.stdout.write('The hook inserts text only. The user must press Enter.\n');
}

async function showStatus(targetRoot) {
  const paths = projectPaths(targetRoot);
  const config = await readConfig(paths.configFile);
  let handlers = 0;
  for (const group of config.hooks?.UserPromptSubmit ?? []) {
    handlers += (group?.hooks ?? []).filter((hook) =>
      [hook.command, hook.commandWindows].some((value) =>
        typeof value === 'string' && value.includes(HOOK_FILENAME),
      ),
    ).length;
  }
  const hookPresent = await pathExists(paths.hookFile);
  const helperPresent = await pathExists(paths.helperFile);
  const ready = hookPresent && helperPresent && handlers === 1;
  process.stdout.write(`${ready ? 'ready' : 'not ready'}: ${targetRoot}\n`);
  process.stdout.write(`hook: ${hookPresent ? 'present' : 'missing'}\n`);
  process.stdout.write(`text-only helper: ${helperPresent ? 'present' : 'missing'}\n`);
  process.stdout.write(`managed handlers: ${handlers}/1\n`);
  process.exitCode = ready ? 0 : 1;
}

async function uninstall(targetRoot) {
  const paths = projectPaths(targetRoot);
  if (await pathExists(paths.configFile)) {
    const config = removeManagedHandlers(await readConfig(paths.configFile));
    await replaceFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600,
    });
  }
  await fs.rm(paths.hookFile, { force: true });
  await fs.rm(paths.helperFile, { force: true });
  await removeLegacyFiles(paths);
  process.stdout.write(`Removed all managed rename hooks from:\n${targetRoot}\n`);
}

async function main() {
  const { action, targetRoot } = parseArguments(process.argv.slice(2));
  if (action === 'help') printUsage();
  else if (action === 'status') await showStatus(targetRoot);
  else if (action === 'uninstall') await uninstall(targetRoot);
  else await install(targetRoot);
}

main().catch((error) => {
  process.stderr.write(`codex-setting: ${error.message}\n`);
  process.exitCode = 1;
});
