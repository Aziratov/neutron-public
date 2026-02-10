import { Client, TextChannel, ChannelType, EmbedBuilder } from 'discord.js';
import { log } from './index.js';

/**
 * Find a text channel by name across all guilds.
 */
function findChannel(client: Client, channelName: string): TextChannel | null {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && 'name' in ch && ch.name === channelName
    );
    if (channel) return channel as TextChannel;
  }
  return null;
}

/**
 * Post a text message to a named channel.
 */
export async function postToChannel(client: Client, channelName: string, message: string): Promise<void> {
  const channel = findChannel(client, channelName);
  if (!channel) {
    log(`[channels] #${channelName} not found`);
    return;
  }
  try {
    // Split long messages
    if (message.length <= 2000) {
      await channel.send(message);
    } else {
      const chunks = message.match(/[\s\S]{1,1950}/g) || [];
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    }
  } catch (err) {
    log(`[channels] Failed to post to #${channelName}: ${err}`);
  }
}

/**
 * Post an embed to a named channel.
 */
export async function postEmbedToChannel(client: Client, channelName: string, embed: EmbedBuilder): Promise<void> {
  const channel = findChannel(client, channelName);
  if (!channel) {
    log(`[channels] #${channelName} not found`);
    return;
  }
  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    log(`[channels] Failed to post embed to #${channelName}: ${err}`);
  }
}

/**
 * Post a trade journal entry to #journal.
 */
export async function postTradeToJournal(
  client: Client,
  trades: { ticker: string; action: string; price?: string; reasoning: string }[],
): Promise<void> {
  for (const trade of trades) {
    const actionEmoji: Record<string, string> = {
      BUY: '🟢', SELL: '🔴', CALL: '📈', PUT: '📉', CLOSE: '⬜', WATCH: '👀',
    };

    const embed = new EmbedBuilder()
      .setColor(trade.action === 'SELL' || trade.action === 'PUT' ? 0xf87171 : trade.action === 'WATCH' ? 0xfacc15 : 0x4ade80)
      .setTitle(`${actionEmoji[trade.action] || '📝'} ${trade.action} ${trade.ticker}`)
      .setDescription(trade.reasoning.slice(0, 200))
      .setTimestamp()
      .setFooter({ text: 'Auto-detected by Neutron' });

    if (trade.price) {
      embed.addFields({ name: 'Price', value: `$${trade.price}`, inline: true });
    }

    await postEmbedToChannel(client, 'journal', embed);
  }
}

/**
 * Post analysis to #market-analysis.
 */
export async function postAnalysis(client: Client, ticker: string, analysis: string): Promise<void> {
  const header = `**${ticker} Analysis**\n\n`;
  const content = header + analysis;

  if (content.length > 2000) {
    await postToChannel(client, 'market-analysis', header + analysis.slice(0, 1900) + '...');
  } else {
    await postToChannel(client, 'market-analysis', content);
  }
}

/**
 * Post a signal/alert to #trade-signals.
 */
export async function postSignal(client: Client, message: string): Promise<void> {
  await postToChannel(client, 'trade-signals', message);
}
