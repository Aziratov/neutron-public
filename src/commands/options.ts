import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { askClaude, saveToBrain } from '../ai.js';
import { recordRecommendation } from '../performance.js';
import { buildMarketContext, buildOptionsContext } from '../market-data.js';
import { log } from '../index.js';

export const optionsCommand = new SlashCommandBuilder()
  .setName('options')
  .setDescription('Options analysis — puts, calls, spreads, Greeks')
  .addStringOption(opt =>
    opt.setName('ticker')
      .setDescription('Stock ticker (e.g., AAPL, TSLA)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('direction')
      .setDescription('Bullish or bearish?')
      .setRequired(true)
      .addChoices(
        { name: 'Bullish (Calls)', value: 'bullish' },
        { name: 'Bearish (Puts)', value: 'bearish' },
        { name: 'Neutral (Spreads/Iron Condors)', value: 'neutral' },
        { name: 'Not sure — analyze both sides', value: 'both' },
      )
  )
  .addStringOption(opt =>
    opt.setName('timeframe')
      .setDescription('How long are you holding?')
      .setRequired(false)
      .addChoices(
        { name: 'This week (0-5 DTE)', value: 'weekly' },
        { name: '2-4 weeks', value: 'monthly' },
        { name: '1-3 months', value: 'quarterly' },
        { name: 'LEAPS (6+ months)', value: 'leaps' },
      )
  )
  .addStringOption(opt =>
    opt.setName('budget')
      .setDescription('Max premium you want to spend (e.g., "500" or "1000")')
      .setRequired(false)
  );

export async function handleOptions(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticker = interaction.options.getString('ticker', true).toUpperCase();
  const direction = interaction.options.getString('direction', true);
  const timeframe = interaction.options.getString('timeframe') || 'monthly';
  const budget = interaction.options.getString('budget');

  await interaction.deferReply();

  const timeframeLabel: Record<string, string> = {
    weekly: '0-5 DTE (this week)',
    monthly: '2-4 weeks out',
    quarterly: '1-3 months out',
    leaps: '6+ months (LEAPS)',
  };

  const directionLabel: Record<string, string> = {
    bullish: 'bullish (looking for calls or bull spreads)',
    bearish: 'bearish (looking for puts or bear spreads)',
    neutral: 'neutral (looking for iron condors, strangles, or credit spreads)',
    both: 'undecided — analyze both bullish and bearish options plays',
  };

  const prompt = `Give me a detailed options analysis for ${ticker}.

Direction: ${directionLabel[direction]}
Timeframe: ${timeframeLabel[timeframe]}
${budget ? `Budget: $${budget} max premium` : ''}

Cover these areas in detail:

1. **Current Setup**: Where is the stock trading? What's the trend? Any upcoming catalysts (earnings, ex-div, FDA, etc.)?

2. **Implied Volatility Assessment**: Is IV high or low relative to historical? Is premium expensive or cheap right now? IV percentile/rank if you can estimate.

3. **Recommended Play**: Specific strategy recommendation with:
   - Strategy name (long call, put spread, iron condor, etc.)
   - Strike price(s) — be specific
   - Expiration date range
   - Estimated premium cost
   - Max profit / max loss / breakeven

4. **Greeks Breakdown**:
   - Delta: directional exposure
   - Theta: time decay per day (is this working for or against you?)
   - Vega: IV sensitivity (will you benefit from IV expansion or get crushed?)
   - Gamma: how fast delta changes (relevant for weeklies)

5. **Risk/Reward**:
   - Probability of profit (estimate)
   - R:R ratio
   - What invalidates this trade?
   - Where would you cut losses?

6. **Alternative Play**: One alternative strategy if the primary doesn't fit.

Be specific with numbers. This is for an experienced options trader who wants actionable data, not theory.`;

  try {
    // Fetch real market data + options chain
    const [marketData, optionsData] = await Promise.all([
      buildMarketContext(ticker),
      buildOptionsContext(ticker),
    ]);

    const fullPrompt = `${prompt}\n\n## Real-Time Market Data\n${marketData}\n\n${optionsData}`;
    const response = await askClaude(fullPrompt);

    // Parse direction for embed color
    const color = direction === 'bullish' ? 0x4ade80
      : direction === 'bearish' ? 0xf87171
      : 0xfacc15;

    const dirEmoji = direction === 'bullish' ? '📈'
      : direction === 'bearish' ? '📉'
      : direction === 'neutral' ? '⚖️' : '🔍';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${dirEmoji} ${ticker} Options Analysis`)
      .setDescription(response.slice(0, 4096))
      .setFooter({ text: `Neutron | ${timeframeLabel[timeframe]} | ${direction}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // If response was truncated, send the rest as follow-up
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
      `options-${ticker}-${today}.md`,
      `# ${ticker} Options Analysis — ${today}\nDirection: ${direction} | Timeframe: ${timeframe}\n\n${response}`,
    );

    // Record recommendation for performance tracking
    if (direction !== 'both') {
      recordRecommendation({
        date: today,
        ticker,
        direction: direction as 'bullish' | 'bearish' | 'neutral',
        confidence: 60,
        type: 'options',
        summary: `${direction} ${timeframe} options play: ${response.slice(0, 150)}`,
      });
    }

    log(`[options] ${ticker} (${direction}/${timeframe}) — ${response.length} chars`);
  } catch (err) {
    log(`[options] ${ticker} failed: ${err}`);
    await interaction.editReply(`Couldn't analyze options for ${ticker} right now. Try again in a moment.`);
  }
}
