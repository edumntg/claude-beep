import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CLI = path.resolve('dist/cli.js');

describe('hook event-type normalization', () => {
  it('normalizes camelCase aliases to kebab-case before logging', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-hook-'));
    try {
      const payload = JSON.stringify({ session_id: 'x', cwd: '/tmp', hook_event_name: 'UserPromptSubmit' });
      // hook with the lowercase form Claude Code would have invoked us with before the fix
      const res = spawnSync('node', [CLI, 'hook', 'userpromptsubmit'], {
        input: payload,
        env: { ...process.env, CLAUDE_BEEP_HOME: home },
        encoding: 'utf8',
        timeout: 4000,
      });
      expect(res.status).toBe(0);
      const log = fs.readFileSync(path.join(home, 'logs', 'events.jsonl'), 'utf8');
      const entry = JSON.parse(log.split('\n').filter(Boolean)[0]);
      expect(entry.event_type).toBe('user-prompt-submit');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('passes already-kebab-case forms through unchanged', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-hook-'));
    try {
      const payload = JSON.stringify({ session_id: 'x', cwd: '/tmp', hook_event_name: 'SubagentStop' });
      const res = spawnSync('node', [CLI, 'hook', 'subagent-stop'], {
        input: payload,
        env: { ...process.env, CLAUDE_BEEP_HOME: home },
        encoding: 'utf8',
        timeout: 4000,
      });
      expect(res.status).toBe(0);
      const log = fs.readFileSync(path.join(home, 'logs', 'events.jsonl'), 'utf8');
      const entry = JSON.parse(log.split('\n').filter(Boolean)[0]);
      expect(entry.event_type).toBe('subagent-stop');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
