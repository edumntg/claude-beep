import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, LOG_DIR } from '../config/paths.js';
import { ENV_FILE, readEnvFile } from '../config/env-file.js';

export const SERVICE_LABEL = 'com.claudebeep.daemon';

function macosPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function linuxUnitPath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'claude-beep.service');
}

function resolveBinary(): string {
  try {
    const out = execFileSync('which', ['claude-beep']).toString().trim();
    if (out) return out;
  } catch {
    /* fall through */
  }
  throw new Error(
    'could not find `claude-beep` on PATH. Run `npm link` (dev) or `npm install -g claude-beep` first.',
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generatePlist(binaryPath: string, env: Record<string, string>): string {
  const envBlock =
    Object.keys(env).length === 0
      ? ''
      : `  <key>EnvironmentVariables</key>\n  <dict>\n${Object.entries(env)
          .map(
            ([k, v]) =>
              `    <key>${escapeXml(k)}</key><string>${escapeXml(v)}</string>`,
          )
          .join('\n')}\n  </dict>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(binaryPath)}</string>
    <string>daemon</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
${envBlock}  <key>StandardOutPath</key><string>${escapeXml(path.join(LOG_DIR, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(LOG_DIR, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

export function generateSystemdUnit(binaryPath: string): string {
  return `[Unit]
Description=claude-beep daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=-${ENV_FILE}
ExecStart=${binaryPath} daemon --foreground
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export async function serviceCommand(action: string): Promise<void> {
  if (!['install', 'start', 'stop', 'uninstall', 'status'].includes(action)) {
    console.error('usage: claude-beep service <install|start|stop|uninstall|status>');
    process.exit(2);
  }
  if (process.platform === 'darwin') {
    await macos(action);
  } else if (process.platform === 'linux') {
    await linux(action);
  } else {
    console.error(`service supervision is not supported on ${process.platform}`);
    console.error('Run `claude-beep daemon --foreground` directly, or wrap it in your own supervisor.');
    process.exit(2);
  }
}

async function macos(action: string): Promise<void> {
  const plistPath = macosPlistPath();

  if (action === 'install') {
    const binary = resolveBinary();
    const env = readEnvFile();
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(plistPath, generatePlist(binary, env));
    console.log(`wrote ${plistPath}`);
    if (Object.keys(env).length > 0) {
      console.log(`embedded ${Object.keys(env).length} env var(s) from ${ENV_FILE}`);
    } else {
      console.log(`(no ${ENV_FILE} found — daemon will start without API tokens)`);
    }
    console.log('next: claude-beep service start');
    return;
  }

  if (action === 'uninstall') {
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'pipe' });
    } catch {
      /* may not be loaded */
    }
    try {
      fs.unlinkSync(plistPath);
      console.log(`removed ${plistPath}`);
    } catch {
      console.log(`(no plist at ${plistPath})`);
    }
    return;
  }

  if (action === 'start') {
    execFileSync('launchctl', ['load', plistPath], { stdio: 'inherit' });
    console.log('started');
    return;
  }

  if (action === 'stop') {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'inherit' });
    console.log('stopped');
    return;
  }

  if (action === 'status') {
    try {
      const out = execFileSync('launchctl', ['list'], { stdio: 'pipe' }).toString();
      const line = out.split('\n').find((l) => l.includes(SERVICE_LABEL));
      console.log(line ?? `${SERVICE_LABEL} not loaded`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    return;
  }
}

async function linux(action: string): Promise<void> {
  const unitPath = linuxUnitPath();

  if (action === 'install') {
    const binary = resolveBinary();
    fs.mkdirSync(path.dirname(unitPath), { recursive: true });
    fs.writeFileSync(unitPath, generateSystemdUnit(binary));
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    console.log(`wrote ${unitPath}`);
    console.log(`tokens are read from ${ENV_FILE} if present (KEY=VALUE per line)`);
    console.log('next: claude-beep service start');
    return;
  }

  if (action === 'uninstall') {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', 'claude-beep'], { stdio: 'pipe' });
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(unitPath);
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
      console.log(`removed ${unitPath}`);
    } catch {
      console.log(`(no unit at ${unitPath})`);
    }
    return;
  }

  if (action === 'start') {
    execFileSync('systemctl', ['--user', 'enable', '--now', 'claude-beep'], { stdio: 'inherit' });
    return;
  }

  if (action === 'stop') {
    execFileSync('systemctl', ['--user', 'stop', 'claude-beep'], { stdio: 'inherit' });
    return;
  }

  if (action === 'status') {
    try {
      execFileSync('systemctl', ['--user', 'status', 'claude-beep'], { stdio: 'inherit' });
    } catch {
      /* systemctl status returns non-zero when inactive — that's fine */
    }
    return;
  }
}
