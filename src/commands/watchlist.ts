import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { addToWatchlist, removeFromWatchlist, getWatchlist } from '../watchlist.js';
import { isPrimaryInvestor, addToPersonalWatchlist, removeFromPersonalWatchlist } from '../investor.js';
import { log } from '../index.js';

export const watchlistCommand = new SlashCommandBuilder()
  .setName('watchlist')
  .setDescription('Manage your trading watchlist')
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Add a ticker to the watchlist')
      .addStringOption(opt =>
        opt.setName('ticker')
          .setDescription('Stock ticker (e.g., AAPL, NVDA)')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('notes')
          .setDescription('Why you\'re watching this ticker')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove a ticker from the watchlist')
      .addStringOption(opt =>
        opt.setName('ticker')
          .setDescription('Stock ticker to remove')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Show the current watchlist')
  );

export async function handleWatchlist(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const ticker = interaction.options.getString('ticker', true);
    const notes = interaction.options.getString('notes') || undefined;
    const result = addToWatchlist(ticker, interaction.user.displayName, notes);

    if (result.success) {
      // Also update investor profile if this is the primary investor
      if (isPrimaryInvestor(interaction.user.username)) {
        addToPersonalWatchlist(ticker);
      }
      await interaction.reply(`${result.message} Neutron will track it in morning briefs and EOD recaps.`);
    } else {
      await interaction.reply(result.message);
    }
    log(`[watchlist] ${interaction.user.displayName} added ${ticker.toUpperCase()}`);

  } else if (sub === 'remove') {
    const ticker = interaction.options.getString('ticker', true);
    const result = removeFromWatchlist(ticker);
    if (result.success && isPrimaryInvestor(interaction.user.username)) {
      removeFromPersonalWatchlist(ticker);
    }
    await interaction.reply(result.message);
    log(`[watchlist] ${interaction.user.displayName} removed ${ticker.toUpperCase()}`);

  } else if (sub === 'show') {
    const list = getWatchlist();

    if (list.length === 0) {
      await interaction.reply('Watchlist is empty. Use `/watchlist add TICKER` to start tracking.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle('Watchlist')
      .setDescription(list.map((entry, i) => {
        const notes = entry.notes ? ` — _${entry.notes}_` : '';
        const date = new Date(entry.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `**${i + 1}.** \`${entry.ticker}\`${notes} (added ${date} by ${entry.addedBy})`;
      }).join('\n'))
      .setFooter({ text: `${list.length} ticker${list.length !== 1 ? 's' : ''} | Tracked in morning briefs & EOD recaps` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    log(`[watchlist] ${interaction.user.displayName} viewed watchlist (${list.length} tickers)`);
  }
}
