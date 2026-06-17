import { describe, it, expect } from 'vitest';
import { generatePlist, generateSystemdUnit, SERVICE_LABEL } from '../src/commands/service.js';

describe('service file generation', () => {
  it('plist embeds binary path, label, and KeepAlive', () => {
    const plist = generatePlist('/usr/local/bin/claude-beep', {});
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain('<string>/usr/local/bin/claude-beep</string>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
  });

  it('plist embeds env vars when provided', () => {
    const plist = generatePlist('/usr/local/bin/claude-beep', {
      TELEGRAM_BOT_TOKEN: 'abc:def',
      DISCORD_BOT_TOKEN: 'xyz',
    });
    expect(plist).toContain('<key>EnvironmentVariables</key>');
    expect(plist).toContain('<key>TELEGRAM_BOT_TOKEN</key><string>abc:def</string>');
    expect(plist).toContain('<key>DISCORD_BOT_TOKEN</key><string>xyz</string>');
  });

  it('plist escapes XML special characters in env values', () => {
    const plist = generatePlist('/usr/local/bin/claude-beep', {
      TOKEN: 'a<b&c>"d"',
    });
    expect(plist).toContain('a&lt;b&amp;c&gt;&quot;d&quot;');
    expect(plist).not.toContain('a<b&c>');
  });

  it('systemd unit references the env file and restart policy', () => {
    const unit = generateSystemdUnit('/usr/local/bin/claude-beep');
    expect(unit).toContain('Description=claude-beep daemon');
    expect(unit).toContain('ExecStart=/usr/local/bin/claude-beep daemon --foreground');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toMatch(/EnvironmentFile=-.*\.claude-beep\/env/);
  });
});
