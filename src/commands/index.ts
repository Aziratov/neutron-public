import { analyzeCommand } from './analyze.js';
import { watchlistCommand } from './watchlist.js';
import { scanCommand } from './scan.js';
import { journalCommand } from './journal.js';
import { optionsCommand } from './options.js';
import { sentimentCommand } from './sentiment.js';
import type { SlashCommandBuilder } from 'discord.js';

// Registry of all slash commands
export const commands: SlashCommandBuilder[] = [
  analyzeCommand as any,
  watchlistCommand as any,
  scanCommand as any,
  journalCommand as any,
  optionsCommand as any,
  sentimentCommand as any,
];
