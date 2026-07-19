#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIONS = new Set(['install', 'update', 'status', 'uninstall']);
const EVENTS = ['UserPromptSubmit', 'Stop'];
const HOOK_FILENAME = 'auto_rename_session.mjs';
const CONFIG_DESCRIPTION =
  'Project-local hook that summarizes the first user intent and sets the thread title.';
const MANAGED_STATUS_PREFIX = 'Auto thread title:';
const SOURCE_HOOK = fileURLToPath(new URL(`./hook/${HOOK_FILENAME}`, import.meta.url));

function printUsage() {
  process.stdout.write(`Usage:
  node install.mjs [install|update] [project-path]
  node install.mjs status [project-path]
  node install.mjs uninstall [project-path]

If the action is omitted, install is used. If the path is omitted, the current
directory is used.
`);
}

function parseArguments(argumentsList) {
  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let action = 'install';
  let target = process.cwd();
  const remaining = [...argumentsList];

  if (remaining[0] && ACTIONS.has(remaining[0])) {
    action = remaining.shift();
  }
  if (remaining[0]) {
    target = remaining.shift();
  }
  if (remaining.length > 0) {
    throw new Error(`Unexpected argument: ${remaining[0]}`);
  }

  return { action, targetRoot: path.resolve(target) };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertProjectDirectory(targetRoot) {
  let stat;
  try {
    stat = await fs.stat(targetRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Project directory does not exist: ${targetRoot}`);
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${targetRoot}`);
  }
}

function projectPaths(targetRoot) {
  const codexDirectory = path.join(targetRoot, '.codex');
  return {
    codexDirectory,
    hookDirectory: path.join(codexDirectory, 'hooks'),
    hookFile: path.join(codexDirectory, 'hooks', HOOK_FILENAME),
    configFile: path.join(codexDirectory, 'hooks.json'),
  };
}

async function readConfig(configFile) {
  try {
    const source = (await fs.readFile(configFile, 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The root value must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw new Error(`Cannot read ${configFile}: ${error.message}`);
  }
}

function isManagedCommand(hook) {
  if (!hook || typeof hook !== 'object' || hook.type !== 'command') {
    return false;
  }
  const commands = [hook.command, hook.commandWindows].filter(
    (value) => typeof value === 'string',
  );
  return (
    commands.some((command) => command.includes(HOOK_FILENAME)) ||
    (typeof hook.statusMessage === 'string' &&
      hook.statusMessage.startsWith(MANAGED_STATUS_PREFIX))
  );
}

function removeManagedHandlers(config) {
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
    return config;
  }

  for (const eventName of EVENTS) {
    const groups = config.hooks[eventName];
    if (!Array.isArray(groups)) {
      continue;
    }

    config.hooks[eventName] = groups
      .map((group) => {
        if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) {
          return group;
        }
        return { ...group, hooks: group.hooks.filter((hook) => !isManagedCommand(hook)) };
      })
      .filter((group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0);

    if (config.hooks[eventName].length === 0) {
      delete config.hooks[eventName];
    }
  }

  if (Object.keys(config.hooks).length === 0) {
    delete config.hooks;
  }
  return config;
}

function quotePosix(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quoteWindows(value) {
  if (value.includes('"')) {
    throw new Error(`Windows paths containing a double quote are unsupported: ${value}`);
  }
  return `"${value}"`;
}

function commandForPosix(hookFile) {
  const portablePath = process.platform === 'win32'
    ? hookFile.replaceAll('\\', '/')
    : hookFile;
  return `node ${quotePosix(portablePath)}`;
}

function managedHook(hookFile, eventName) {
  const status = eventName === 'UserPromptSubmit'
    ? `${MANAGED_STATUS_PREFIX} summarizing first intent`
    : `${MANAGED_STATUS_PREFIX} finalizing title`;
  return {
    type: 'command',
    command: commandForPosix(hookFile),
    commandWindows: `node ${quoteWindows(hookFile)}`,
    timeout: 90,
    statusMessage: status,
  };
}

function addManagedHandlers(config, hookFile) {
  if (!config.description) {
    config.description = CONFIG_DESCRIPTION;
  }
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
    config.hooks = {};
  }

  for (const eventName of EVENTS) {
    if (!Array.isArray(config.hooks[eventName])) {
      config.hooks[eventName] = [];
    }
    config.hooks[eventName].push({ hooks: [managedHook(hookFile, eventName)] });
  }
  return config;
}

async function replaceFile(filePath, data, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${filePath}.${process.pid}.${Date.now()}.bak`;
  await fs.writeFile(temporaryPath, data, options);

  try {
    await fs.rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code) || !(await pathExists(filePath))) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  await fs.rename(filePath, backupPath);
  try {
    await fs.rename(temporaryPath, filePath);
    await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (await pathExists(backupPath)) {
      if (await pathExists(filePath)) {
        await fs.rm(filePath, { force: true });
      }
      await fs.rename(backupPath, filePath);
    }
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function managedHandlerCount(config) {
  let count = 0;
  for (const eventName of EVENTS) {
    for (const group of config.hooks?.[eventName] ?? []) {
      for (const hook of group?.hooks ?? []) {
        if (isManagedCommand(hook)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

async function install(targetRoot) {
  await assertProjectDirectory(targetRoot);
  const paths = projectPaths(targetRoot);
  const config = removeManagedHandlers(await readConfig(paths.configFile));
  addManagedHandlers(config, paths.hookFile);

  const hookSource = await fs.readFile(SOURCE_HOOK);
  await replaceFile(paths.hookFile, hookSource, { mode: 0o755 });
  await replaceFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  process.stdout.write(`Installed project-local thread auto-rename hook:\n${targetRoot}\n`);
  process.stdout.write('Open this project in Codex, run /hooks, approve the new hook, then start a new session.\n');
}

async function showStatus(targetRoot) {
  await assertProjectDirectory(targetRoot);
  const paths = projectPaths(targetRoot);
  const config = await readConfig(paths.configFile);
  const hookPresent = await pathExists(paths.hookFile);
  const handlerCount = managedHandlerCount(config);
  const ready = hookPresent && handlerCount === EVENTS.length;

  process.stdout.write(`${ready ? 'ready' : 'not ready'}: ${targetRoot}\n`);
  process.stdout.write(`hook file: ${hookPresent ? 'present' : 'missing'}\n`);
  process.stdout.write(`managed handlers: ${handlerCount}/${EVENTS.length}\n`);
  if (ready) {
    process.stdout.write('Trust approval is managed by Codex; use /hooks to inspect it.\n');
  }
  process.exitCode = ready ? 0 : 1;
}

async function uninstall(targetRoot) {
  await assertProjectDirectory(targetRoot);
  const paths = projectPaths(targetRoot);
  const configExists = await pathExists(paths.configFile);

  if (configExists) {
    const config = removeManagedHandlers(await readConfig(paths.configFile));
    await replaceFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
  await fs.rm(paths.hookFile, { force: true });
  process.stdout.write(`Removed the managed thread auto-rename hook from:\n${targetRoot}\n`);
}

async function main() {
  const { action, targetRoot } = parseArguments(process.argv.slice(2));
  if (action === 'status') {
    await showStatus(targetRoot);
  } else if (action === 'uninstall') {
    await uninstall(targetRoot);
  } else {
    await install(targetRoot);
  }
}

main().catch((error) => {
  process.stderr.write(`codex-setting: ${error.message}\n`);
  process.exitCode = 1;
});
