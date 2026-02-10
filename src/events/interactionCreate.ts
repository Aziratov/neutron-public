import { Client, ChatInputCommandInteraction } from 'discord.js';
import { handleAnalyze } from '../commands/analyze.js';
import { handleWatchlist } from '../commands/watchlist.js';
import { handleScan } from '../commands/scan.js';
import { handleJournal } from '../commands/journal.js';
import { handleOptions } from '../commands/options.js';
import { handleSentiment } from '../commands/sentiment.js';
import { log } from '../index.js';

export function registerInteractionCreate(client: Client): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction as ChatInputCommandInteraction;
    log(`[slash] /${cmd.commandName} by ${cmd.user.displayName}`);

    try {
      switch (cmd.commandName) {
        case 'analyze':
          await handleAnalyze(cmd);
          break;
        case 'watchlist':
          await handleWatchlist(cmd);
          break;
        case 'scan':
          await handleScan(cmd);
          break;
        case 'journal':
          await handleJournal(cmd);
          break;
        case 'options':
          await handleOptions(cmd);
          break;
        case 'sentiment':
          await handleSentiment(cmd);
          break;
        default:
          await cmd.reply({ content: `Unknown command: ${cmd.commandName}`, ephemeral: true });
      }
    } catch (err) {
      log(`[slash] /${cmd.commandName} error: ${err}`);
      try {
        if (cmd.deferred || cmd.replied) {
          await cmd.editReply('Something went wrong. Try again.');
        } else {
          await cmd.reply({ content: 'Something went wrong. Try again.', ephemeral: true });
        }
      } catch { /* can't reply */ }
    }
  });
}
