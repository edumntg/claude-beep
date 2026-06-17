import fs from 'node:fs';
import { DAEMON_LOG } from '../config/paths.js';

interface TailOptions {
  lines?: string;
}

export async function tailCommand(opts: TailOptions): Promise<void> {
  if (!fs.existsSync(DAEMON_LOG)) {
    console.error(`no log at ${DAEMON_LOG}`);
    process.exit(1);
  }

  const lineCount = Number.parseInt(opts.lines ?? '20', 10);
  const initial = fs.readFileSync(DAEMON_LOG, 'utf8').split('\n');
  for (const line of initial.slice(Math.max(0, initial.length - 1 - lineCount), -1)) {
    process.stdout.write(line + '\n');
  }

  let position = fs.statSync(DAEMON_LOG).size;
  let flushing = false;

  const flush = () => {
    if (flushing) return;
    flushing = true;
    try {
      const stat = fs.statSync(DAEMON_LOG);
      if (stat.size < position) {
        position = 0;
      }
      if (stat.size > position) {
        const stream = fs.createReadStream(DAEMON_LOG, { start: position, end: stat.size - 1 });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        stream.on('end', () => {
          position = stat.size;
          flushing = false;
        });
        stream.on('error', () => {
          flushing = false;
        });
        return;
      }
    } catch {
      /* ignore */
    }
    flushing = false;
  };

  const watcher = fs.watch(DAEMON_LOG, flush);

  const shutdown = () => {
    watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
