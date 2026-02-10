import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { saveToBrain, readFromBrain, listBrainFiles } from '../ai.js';
import { isPrimaryInvestor, recordTrade } from '../investor.js';
import { log } from '../index.js';

export const journalCommand = new SlashCommandBuilder()
  .setName('journal')
  .setDescription('Trade journal — log entries and review history')
  .addSubcommand(sub =>
    sub.setName('log')
      .setDescription('Log a new trade journal entry')
      .addStringOption(opt =>
        opt.setName('ticker')
          .setDescription('Ticker symbol')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('action')
          .setDescription('What did you do?')
          .setRequired(true)
          .addChoices(
            { name: 'Bought', value: 'BUY' },
            { name: 'Sold', value: 'SELL' },
            { name: 'Opened Call', value: 'CALL' },
            { name: 'Opened Put', value: 'PUT' },
            { name: 'Closed Position', value: 'CLOSE' },
            { name: 'Watching', value: 'WATCH' },
          )
      )
      .addStringOption(opt =>
        opt.setName('reasoning')
          .setDescription('Why did you make this trade? What was the thesis?')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('price')
          .setDescription('Entry/exit price')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('stop')
          .setDescription('Stop loss level')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('target')
          .setDescription('Profit target')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('history')
      .setDescription('View recent journal entries')
  );

export async function handleJournal(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'log') {
    const ticker = interaction.options.getString('ticker', true).toUpperCase();
    const action = interaction.options.getString('action', true);
    const reasoning = interaction.options.getString('reasoning', true);
    const price = interaction.options.getString('price');
    const stop = interaction.options.getString('stop');
    const target = interaction.options.getString('target');

    const now = new Date();
    const timestamp = now.toISOString();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

    // Build journal entry
    const entry = [
      `## ${action} ${ticker} — ${dateStr} ${timeStr} ET`,
      `**Action:** ${action}`,
      price ? `**Price:** $${price.replace('$', '')}` : null,
      stop ? `**Stop Loss:** $${stop.replace('$', '')}` : null,
      target ? `**Target:** $${target.replace('$', '')}` : null,
      `**Reasoning:** ${reasoning}`,
      `**Logged by:** ${interaction.user.displayName}`,
      `**Timestamp:** ${timestamp}`,
    ].filter(Boolean).join('\n');

    // Save to brain as a journal file (append to daily journal)
    const journalFile = `journal-${dateStr}.md`;
    const existing = readFromBrain(journalFile);
    const content = existing
      ? `${existing}\n\n---\n\n${entry}`
      : `# Trade Journal — ${dateStr}\n\n${entry}`;
    saveToBrain(journalFile, content);

    // If this is the primary investor, record in their profile
    if (isPrimaryInvestor(interaction.user.username)) {
      recordTrade({
        ticker,
        action,
        reasoning,
        price: price?.replace('$', ''),
        stop: stop?.replace('$', ''),
        target: target?.replace('$', ''),
        date: dateStr,
      });
    }

    // Build embed for Discord
    const actionEmoji: Record<string, string> = {
      BUY: '🟢', SELL: '🔴', CALL: '📈', PUT: '📉', CLOSE: '⬜', WATCH: '👀',
    };

    const embed = new EmbedBuilder()
      .setColor(action === 'SELL' || action === 'PUT' ? 0xf87171 : action === 'WATCH' ? 0xfacc15 : 0x4ade80)
      .setTitle(`${actionEmoji[action] || '📝'} ${action} ${ticker}`)
      .setDescription(reasoning)
      .setTimestamp();

    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (price) fields.push({ name: 'Price', value: `$${price.replace('$', '')}`, inline: true });
    if (stop) fields.push({ name: 'Stop', value: `$${stop.replace('$', '')}`, inline: true });
    if (target) fields.push({ name: 'Target', value: `$${target.replace('$', '')}`, inline: true });
    fields.push({ name: 'By', value: interaction.user.displayName, inline: true });

    if (fields.length > 0) embed.addFields(fields);
    embed.setFooter({ text: 'Neutron Trade Journal' });

    await interaction.reply({ embeds: [embed] });

    // Also post to #journal channel if this wasn't sent from there
    try {
      const guild = interaction.guild;
      if (guild) {
        const journalChannel = guild.channels.cache.find(
          ch => ch.isTextBased() && 'name' in ch && ch.name === 'journal'
        );
        if (journalChannel && journalChannel.isTextBased() && journalChannel.id !== interaction.channelId) {
          await (journalChannel as any).send({ embeds: [embed] });
        }
      }
    } catch { /* non-critical */ }

    log(`[journal] ${interaction.user.displayName} logged ${action} ${ticker}`);

  } else if (sub === 'history') {
    const files = listBrainFiles()
      .filter(f => f.startsWith('journal-'))
      .sort()
      .reverse()
      .slice(0, 5); // Last 5 days

    if (files.length === 0) {
      await interaction.reply('No journal entries yet. Use `/journal log` to record your first trade.');
      return;
    }

    const entries: string[] = [];
    for (const file of files) {
      const content = readFromBrain(file);
      if (content) {
        // Extract just the header lines for a compact summary
        const lines = content.split('\n').filter(l => l.startsWith('## '));
        entries.push(...lines.map(l => l.replace('## ', '')));
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle('Recent Trade Journal')
      .setDescription(entries.slice(0, 15).join('\n') || 'No entries found.')
      .setFooter({ text: `${entries.length} entries across ${files.length} day${files.length !== 1 ? 's' : ''}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    log(`[journal] ${interaction.user.displayName} viewed history (${entries.length} entries)`);
  }
}
