import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { askClaude } from '../ai.js';
import { saveToBrain } from '../ai.js';
import { getWatchlistTickers } from '../watchlist.js';
import { chunkMessage } from '../utils/chunk.js';
import { log } from '../index.js';

export const scanCommand = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('Run an on-demand market scan')
  .addStringOption(opt =>
    opt.setName('type')
      .setDescription('Type of scan to run')
      .setRequired(true)
      .addChoices(
        { name: 'Morning Brief', value: 'morning' },
        { name: 'EOD Recap', value: 'eod' },
        { name: 'Watchlist Check', value: 'watchlist' },
        { name: 'Sector Overview', value: 'sectors' },
      )
  );

export async function handleScan(interaction: ChatInputCommandInteraction): Promise<void> {
  const scanType = interaction.options.getString('type', true);
  await interaction.deferReply();

  const tickers = getWatchlistTickers();
  const watchlistStr = tickers.length > 0
    ? `Current watchlist: ${tickers.join(', ')}`
    : 'No tickers on the watchlist.';

  const prompts: Record<string, string> = {
    morning: `Give a morning market outlook right now.\n\n${watchlistStr}\n\nCover: futures, key catalysts, watchlist pre-market levels, overall market bias. Keep it under 20 lines.`,

    eod: `Give a market recap as of right now.\n\n${watchlistStr}\n\nCover: index performance, key movers, watchlist scoreboard, volume assessment, what to watch next. Keep it under 20 lines.`,

    watchlist: tickers.length > 0
      ? `Quick check on all watchlist tickers: ${tickers.join(', ')}\n\nFor each one, give: current setup (1-2 sentences), direction bias, and one key level to watch. Be concise.`
      : 'The watchlist is empty. Suggest 5 interesting tickers to watch right now with a brief reason for each.',

    sectors: `Give a sector-by-sector overview of the market right now. Cover: Technology, Healthcare, Financials, Energy, Consumer, Industrials. For each: direction, momentum, and any notable movers. Keep it concise — 2-3 lines per sector.`,
  };

  try {
    const response = await askClaude(prompts[scanType]);
    const chunks = chunkMessage(response);

    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1, 4)) {
      await interaction.followUp(chunk);
    }

    // Save scans to brain for learning
    const today = new Date().toISOString().split('T')[0];
    saveToBrain(`scan-${scanType}-${today}.md`, `# ${scanType} Scan — ${today}\n\n${response}`);

    log(`[scan] ${scanType} — ${response.length} chars`);
  } catch (err) {
    log(`[scan] ${scanType} failed: ${err}`);
    await interaction.editReply(`Scan failed. Try again in a moment.`);
  }
}
