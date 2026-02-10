import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { askClaude, saveToBrain } from '../ai.js';
import { recordRecommendation } from '../performance.js';
import { buildMarketContext } from '../market-data.js';
import { log } from '../index.js';

export const sentimentCommand = new SlashCommandBuilder()
  .setName('sentiment')
  .setDescription('News and sentiment scan for a ticker or the market')
  .addStringOption(opt =>
    opt.setName('ticker')
      .setDescription('Stock ticker (e.g., AAPL) or "market" for broad overview')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('focus')
      .setDescription('What to focus on')
      .setRequired(false)
      .addChoices(
        { name: 'News & Headlines', value: 'news' },
        { name: 'Social Sentiment', value: 'social' },
        { name: 'Earnings & Fundamentals', value: 'earnings' },
        { name: 'Full Sentiment Report', value: 'full' },
      )
  );

export async function handleSentiment(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticker = interaction.options.getString('ticker', true).toUpperCase();
  const focus = interaction.options.getString('focus') || 'full';

  await interaction.deferReply();

  const isMarket = ticker === 'MARKET' || ticker === 'SPY' || ticker === 'QQQ';

  const prompts: Record<string, string> = {
    news: `Search for and summarize the latest news and headlines for ${isMarket ? 'the overall stock market' : ticker}. Cover:
- Top 3-5 most impactful recent headlines
- How each piece of news could affect the stock/market
- Overall news sentiment: positive, negative, or mixed
- Any upcoming events or catalysts on the calendar
Keep it concise — headline + 1-2 sentence analysis for each.`,

    social: `Analyze the current social and retail sentiment around ${isMarket ? 'the stock market' : ticker}:
- What's the buzz? Is it trending on social media / trading forums?
- Retail sentiment direction (bullish/bearish/neutral)
- Any unusual activity — sudden spike in mentions, meme stock energy, short squeeze talk?
- Institutional vs retail positioning if you can gauge it
- Contrarian take: if everyone's bullish, should you be cautious?`,

    earnings: `Analyze ${isMarket ? 'upcoming market-moving earnings' : ticker + "'s"} earnings and fundamentals:
- ${isMarket ? 'Key earnings this week/next week that could move the market' : 'When is the next earnings date?'}
- ${isMarket ? 'Earnings season trends so far' : 'Revenue and EPS expectations vs history'}
- ${isMarket ? 'Sector rotation signals from earnings results' : 'Key fundamental metrics (P/E, P/S, debt, cash flow)'}
- ${isMarket ? 'Guidance trends: are companies guiding up or down?' : 'Management guidance and analyst revisions'}
- Bottom line: is the fundamental story improving or deteriorating?`,

    full: `Give me a comprehensive sentiment and news analysis for ${isMarket ? 'the stock market' : ticker}:

1. **Recent News** (top 3-5 headlines with impact assessment)
2. **Market Sentiment** (fear/greed, retail vs institutional positioning)
3. **Social Buzz** (trending? unusual activity?)
4. **Upcoming Catalysts** (earnings, economic data, Fed, geopolitical)
5. **Sentiment Score**: Rate overall sentiment from -5 (extreme fear/bearish) to +5 (extreme greed/bullish) with reasoning
6. **Contrarian View**: What's the other side of the trade?

Be specific and data-driven, not generic.`,
  };

  try {
    // Fetch real market data for context
    const marketData = isMarket ? '' : await buildMarketContext(ticker);
    const prompt = marketData
      ? `${prompts[focus]}\n\n## Real-Time Market Data\n${marketData}`
      : prompts[focus];
    const response = await askClaude(prompt);

    // Try to extract sentiment score
    const scoreMatch = response.match(/sentiment\s*(?:score)?[:\s]*([+-]?\d)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null;

    const color = score !== null
      ? (score > 2 ? 0x4ade80 : score < -2 ? 0xf87171 : 0xfacc15)
      : 0x3b82f6;

    const sentimentLabel = score !== null
      ? (score > 3 ? 'Extreme Greed' : score > 1 ? 'Bullish' : score > -1 ? 'Neutral' : score > -3 ? 'Bearish' : 'Extreme Fear')
      : '';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${isMarket ? '🌎 Market' : `📊 ${ticker}`} Sentiment`)
      .setDescription(response.slice(0, 4096))
      .setTimestamp()
      .setFooter({ text: `Neutron | ${focus} scan${sentimentLabel ? ' | ' + sentimentLabel : ''}` });

    if (score !== null) {
      embed.addFields({ name: 'Sentiment Score', value: `${score > 0 ? '+' : ''}${score}/5 — ${sentimentLabel}`, inline: true });
    }

    await interaction.editReply({ embeds: [embed] });

    if (response.length > 4096) {
      const remaining = response.slice(4096);
      const chunks = remaining.match(/[\s\S]{1,1950}/g) || [];
      for (const chunk of chunks.slice(0, 3)) {
        await interaction.followUp(chunk);
      }
    }

    // Save to brain
    const today = new Date().toISOString().split('T')[0];
    saveToBrain(
      `sentiment-${ticker}-${today}.md`,
      `# ${ticker} Sentiment — ${today} (${focus})\n\n${response}`,
    );

    // Record recommendation for performance tracking (only if there's a clear direction)
    if (score !== null && Math.abs(score) >= 2 && !isMarket) {
      recordRecommendation({
        date: today,
        ticker,
        direction: score > 0 ? 'bullish' : 'bearish',
        confidence: Math.min(Math.abs(score) * 20, 90),
        type: 'sentiment',
        summary: `Sentiment score ${score}/5: ${response.slice(0, 150)}`,
      });
    }

    log(`[sentiment] ${ticker} (${focus}) — ${response.length} chars`);
  } catch (err) {
    log(`[sentiment] ${ticker} failed: ${err}`);
    await interaction.editReply(`Couldn't run sentiment scan for ${ticker} right now. Try again in a moment.`);
  }
}
