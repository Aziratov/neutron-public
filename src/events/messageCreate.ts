import { Client, Message } from 'discord.js';
import { config } from '../config.js';
import { askClaude, downloadImage, cleanupTempImage } from '../ai.js';
import { chunkMessage } from '../utils/chunk.js';
import { isPrimaryInvestor, addInsight } from '../investor.js';
import { detectTrades, processDetectedTrades } from '../auto-journal.js';
import { registerDiscoveredUser } from './ready.js';
import { postTradeToJournal, postAnalysis } from '../channels.js';
import { buildMarketContext } from '../market-data.js';
import { log } from '../index.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * Check if a channel is one we should always listen to (no mention needed).
 */
function isWatchedChannel(channelName: string): boolean {
  return (config.watchedChannels as readonly string[]).includes(channelName);
}

/**
 * Build conversation context from recent messages in the channel.
 */
async function getRecentContext(message: Message, limit = 6): Promise<string> {
  try {
    const messages = await message.channel.messages.fetch({ limit, before: message.id });
    const context = messages
      .reverse()
      .map(m => `${m.author.displayName}: ${m.content.slice(0, 300)}`)
      .join('\n');
    return context || '';
  } catch {
    return '';
  }
}

/**
 * After getting a response from Neutron when talking to the primary investor,
 * check if there are learnable patterns and save them.
 */
function learnFromInteraction(username: string, userMessage: string, _response: string): void {
  if (!isPrimaryInvestor(username)) return;

  // Detect trading style hints from the message
  const lower = userMessage.toLowerCase();

  // Options trading
  if (/\b(puts?|calls?|options?|strike|expir|premium|iv|theta|delta|spread)\b/.test(lower)) {
    // Don't add insight for every message — just note the pattern
    // The trade journal handles structured learning
  }

  // If bertrand shares a thesis or reasoning, save it as an insight
  if (userMessage.length > 100 && /\b(because|thesis|think|believe|strategy|approach|plan)\b/i.test(lower)) {
    const snippet = userMessage.slice(0, 200);
    addInsight(`${new Date().toISOString().split('T')[0]}: "${snippet}"`);
  }
}

export function registerMessageCreate(client: Client): void {
  client.on('messageCreate', async (message: Message) => {
    // Ignore bots (including ourselves)
    if (message.author.bot) return;

    // Discover user IDs for bertrand and Mo (lazy — happens on first message)
    registerDiscoveredUser(message.author.username, message.author.id, client);

    // Determine if we should respond
    const isMentioned = message.mentions.has(client.user!);
    const channelName = 'name' in message.channel ? (message.channel as any).name : '';
    const isWatched = isWatchedChannel(channelName);

    // Only respond to mentions or watched channels
    if (!isMentioned && !isWatched) return;

    const username = message.author.username;

    // Strip the bot mention from the message for cleaner prompting
    let userMessage = message.content
      .replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), '')
      .trim();

    // Check for image attachments (charts, screenshots)
    const imageAttachment = message.attachments.find(att => {
      const ext = att.name?.split('.').pop()?.toLowerCase() || '';
      return IMAGE_EXTENSIONS.has(ext) || (att.contentType?.startsWith('image/') ?? false);
    });

    // If the message is empty after stripping mention, prompt for input
    if (!userMessage && !imageAttachment) {
      userMessage = 'The user mentioned you but didn\'t ask anything specific. Say hi and offer to help with trading analysis.';
    }
    if (!userMessage && imageAttachment) {
      userMessage = 'The user sent a chart/screenshot. Analyze what you see.';
    }

    log(`[${channelName || 'DM'}] ${message.author.displayName} (${username}): ${userMessage.slice(0, 100)}`);

    // Show typing indicator while we work
    const channel = message.channel;
    if ('sendTyping' in channel) {
      try { await channel.sendTyping(); } catch { /* ignore */ }
    }

    // Keep typing indicator alive during long AI calls
    const typingInterval = setInterval(() => {
      if ('sendTyping' in channel) {
        try { (channel as any).sendTyping(); } catch { /* ignore */ }
      }
    }, 8000);

    let imagePath: string | undefined;

    try {
      // Get recent conversation context
      const context = await getRecentContext(message);

      // Add channel context to help the AI understand where the message came from
      const channelContext = channelName
        ? `This message is from the #${channelName} channel in Discord.`
        : 'This is a direct message.';

      // Detect tickers in the message and fetch live market data
      let marketContext = '';
      const tickerPattern = /\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
      const commonWords = new Set(['I', 'A', 'AM', 'PM', 'AT', 'TO', 'IN', 'ON', 'IS', 'IT', 'THE', 'AND', 'BUT', 'FOR', 'NOT', 'DO', 'IF', 'OR', 'SO', 'UP', 'MY', 'NO', 'GO', 'HE', 'ME', 'WE', 'US', 'AN', 'OF', 'BY', 'AS', 'BE', 'HAS', 'WAS', 'ARE', 'ALL', 'ANY', 'CAN', 'HAD', 'HER', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'OUR', 'OUT', 'OWN', 'SAY', 'SHE', 'TOO', 'USE', 'DAY', 'GET', 'HAS', 'GOT', 'DID', 'MAN', 'BIG', 'END', 'PUT', 'RUN', 'SET', 'TRY', 'ASK', 'MEN', 'READ', 'NEED', 'LONG', 'MAKE', 'LIKE', 'BACK', 'ONLY', 'COME', 'MADE', 'GOOD', 'LOOK', 'MOST', 'WHAT', 'WHEN', 'WILL', 'WITH', 'HAVE', 'THIS', 'THAT', 'FROM', 'THEY', 'BEEN', 'SAID', 'EACH', 'TELL', 'DOES', 'WANT', 'BEEN']);
      const detectedTickers = new Set<string>();
      let match;
      while ((match = tickerPattern.exec(userMessage)) !== null) {
        const t = (match[1] || match[2]).toUpperCase();
        if (!commonWords.has(t) && t.length >= 2) detectedTickers.add(t);
      }

      // Fetch market data for up to 3 tickers mentioned
      if (detectedTickers.size > 0) {
        const tickers = Array.from(detectedTickers).slice(0, 3);
        try {
          const dataPromises = tickers.map(t => buildMarketContext(t));
          const results = await Promise.all(dataPromises);
          const validResults = results.filter(r => !r.includes('No market data'));
          if (validResults.length > 0) {
            marketContext = '\n\n## Live Market Data\n' + validResults.join('\n\n');
          }
        } catch { /* don't block on market data failures */ }
      }

      const fullContext = [channelContext, context, marketContext].filter(Boolean).join('\n\n');

      // Download image if attached
      if (imageAttachment) {
        try {
          log(`[${channelName || 'DM'}] Downloading image: ${imageAttachment.name} (${imageAttachment.size} bytes)`);
          imagePath = await downloadImage(imageAttachment.url);
          log(`[${channelName || 'DM'}] Image saved to: ${imagePath}`);
        } catch (err) {
          log(`[${channelName || 'DM'}] Failed to download image: ${err}`);
        }
      }

      // Auto-detect trades from the primary investor's message
      let tradeNote = '';
      const detectedTrades = detectTrades(username, userMessage);
      if (detectedTrades) {
        const summary = processDetectedTrades(detectedTrades);
        tradeNote = `\n\n[SYSTEM: Auto-logged trade activity from ${username}: ${summary}. Briefly acknowledge this in your response — something like "Logged that" or "Got it, noted the trade." Don't make it the whole response.]`;

        // Cross-post to #journal
        postTradeToJournal(client, detectedTrades).catch(err =>
          log(`[cross-post] Failed to post trades to #journal: ${err}`)
        );
      }

      // Ask Claude — pass the username and optional image path
      const response = await askClaude(userMessage + tradeNote, fullContext, username, imagePath);

      // Learn from the interaction if it's the primary investor
      learnFromInteraction(username, userMessage, response);

      // Send response (chunked if needed)
      const chunks = chunkMessage(response);
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i]);
        } else {
          if ('send' in message.channel) {
            await (message.channel as any).send(chunks[i]);
          }
        }
        // Small delay between chunks to maintain order
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Cross-post analysis to #market-analysis when Neutron gives a detailed take
      // (only from the private chat or ask-neutron, and only for substantial responses)
      if (isPrimaryInvestor(username) && response.length > 500) {
        const tickerMatch = userMessage.match(/\$?([A-Z]{1,5})\b/g);
        const hasTicker = tickerMatch && tickerMatch.some(t => {
          const clean = t.replace('$', '');
          return !['I', 'A', 'AM', 'PM', 'AT', 'TO', 'IN', 'ON', 'IS', 'IT', 'THE', 'AND', 'BUT', 'FOR', 'NOT'].includes(clean);
        });
        const isAnalysis = /\b(analy|outlook|think about|what do you|setup|levels|support|resistance|technical)\b/i.test(userMessage);

        if (hasTicker && isAnalysis) {
          const ticker = (tickerMatch!.find(t => {
            const clean = t.replace('$', '');
            return !['I', 'A', 'AM', 'PM', 'AT', 'TO', 'IN', 'ON', 'IS', 'IT', 'THE', 'AND', 'BUT', 'FOR', 'NOT'].includes(clean);
          }) || '').replace('$', '');
          if (ticker) {
            postAnalysis(client, ticker, response).catch(err =>
              log(`[cross-post] Failed to post analysis to #market-analysis: ${err}`)
            );
          }
        }
      }

      log(`[${channelName || 'DM'}] Responded to ${username} (${response.length} chars, ${chunks.length} chunk(s))`);
    } catch (err) {
      log(`[${channelName || 'DM'}] Error: ${err}`);
      try {
        await message.reply("Hit a snag on that one. Give me a sec and try again.");
      } catch { /* can't even reply */ }
    } finally {
      clearInterval(typingInterval);
      // Clean up temp image
      if (imagePath) cleanupTempImage(imagePath);
    }
  });
}
