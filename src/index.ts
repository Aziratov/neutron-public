import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';
import { createBot, startBot } from './bot.js';

// Ensure log directory exists
try { mkdirSync(dirname(config.paths.log), { recursive: true }); } catch {}

/** Simple logger — writes to file and stdout. */
export function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    appendFileSync(config.paths.log, line + '\n');
  } catch { /* don't crash on log failure */ }
}

// --- Start ---
log('Neutron starting...');

const client = createBot();

startBot(client).catch((err) => {
  log(`FATAL: Failed to start bot: ${err}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down (SIGINT)...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Shutting down (SIGTERM)...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  log(`FATAL uncaught exception: ${err.message}\n${err.stack}`);
  // Let systemd restart us cleanly
  process.exit(1);
});
