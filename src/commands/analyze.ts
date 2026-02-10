import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { askClaude, saveToBrain } from '../ai.js';
import { buildAnalysisEmbed, parseAnalysisResponse } from '../utils/embeds.js';
import { chunkMessage } from '../utils/chunk.js';
import { recordRecommendation } from '../performance.js';
import { buildMarketContext } from '../market-data.js';
import { log } from '../index.js';

export const analyzeCommand = new SlashCommandBuilder()
  .setName('analyze')
  .setDescription('Get AI-powered analysis on a stock or ticker')
  .addStringOption(option =>
    option
      .setName('ticker')
      .setDescription('Stock ticker symbol (e.g., AAPL, NVDA, SPY)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Type of analysis')
      .setRequired(false)
      .addChoices(
        { name: 'Full Analysis', value: 'full' },
        { name: 'Technical Only', value: 'technical' },
        { name: 'Options (Puts/Calls)', value: 'options' },
        { name: 'Quick Take', value: 'quick' },
      )
  );

export async function handleAnalyze(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticker = interaction.options.getString('ticker', true).toUpperCase();
  const analysisType = interaction.options.getString('type') || 'full';

  // Defer reply — AI takes a few seconds
  await interaction.deferReply();

  const prompts: Record<string, string> = {
    full: `Give me a comprehensive analysis of ${ticker}. Include:
- Current technical setup (trend, support/resistance, volume, momentum indicators)
- Key catalysts or upcoming events
- Sentiment and market positioning
- Your directional bias (bullish/bearish/neutral) with a confidence percentage
- Key risk factors
Format your response clearly with sections.`,

    technical: `Give me a pure technical analysis of ${ticker}. Focus on:
- Price action and trend (higher highs/lows or lower?)
- Key support and resistance levels with specific prices
- Volume analysis
- RSI, MACD, moving averages
- Chart pattern if any (head & shoulders, triangle, etc.)
- Your technical bias with confidence percentage`,

    options: `Analyze ${ticker} from an options trading perspective:
- Is this a good candidate for puts or calls right now? Why?
- Suggested strike price range and expiration timeframe
- Implied volatility assessment — is premium expensive or cheap?
- Risk/reward ratio for the suggested play
- Key levels that would invalidate the thesis
- Greeks considerations (delta, theta exposure)`,

    quick: `Quick take on ${ticker} — in 2-3 sentences, what's the setup and which way do you lean? Include a confidence percentage.`,
  };

  try {
    // Fetch real market data for this ticker
    const marketData = await buildMarketContext(ticker);

    const prompt = `${prompts[analysisType] || prompts.full}\n\n## Real-Time Market Data\n${marketData}`;
    const response = await askClaude(prompt);

    // Parse the response into structured data
    const analysisData = parseAnalysisResponse(ticker, response);

    // For quick takes, just send text. For full analysis, use embed + text.
    if (analysisType === 'quick') {
      await interaction.editReply(response.slice(0, 2000));
    } else {
      const embed = buildAnalysisEmbed(analysisData);

      // If analysis text is long, put summary in embed and full text as follow-up
      if (response.length > 1000) {
        // Embed gets the summary
        embed.setDescription(response.slice(0, 1000) + '...');
        await interaction.editReply({ embeds: [embed] });

        // Full text as follow-up chunks
        const chunks = chunkMessage(response);
        for (const chunk of chunks.slice(0, 3)) { // Max 3 follow-up chunks
          await interaction.followUp(chunk);
        }
      } else {
        await interaction.editReply({ embeds: [embed] });
      }
    }

    // Save analysis to brain for future reference
    const today = new Date().toISOString().split('T')[0];
    saveToBrain(`analysis-${ticker}-${today}.md`, `# ${ticker} Analysis — ${today} (${analysisType})\n\n${response}`);

    // Record recommendation for performance tracking
    const direction = analysisData.signal?.toLowerCase().includes('bull') ? 'bullish'
      : analysisData.signal?.toLowerCase().includes('bear') ? 'bearish'
      : 'neutral';
    recordRecommendation({
      date: today,
      ticker,
      direction: direction as 'bullish' | 'bearish' | 'neutral',
      confidence: analysisData.confidence || 50,
      type: analysisType,
      summary: response.slice(0, 200),
    });

    log(`[analyze] ${ticker} (${analysisType}) — ${response.length} chars`);
  } catch (err) {
    log(`[analyze] ${ticker} failed: ${err}`);
    await interaction.editReply(`Couldn't analyze ${ticker} right now. Try again in a moment.`);
  }
}
