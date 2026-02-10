import { EmbedBuilder } from 'discord.js';

export interface AnalysisData {
  ticker: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  analysis: string;
  confidence?: number;
  price?: string;
  support?: string;
  resistance?: string;
  riskReward?: string;
}

const SIGNAL_COLORS = {
  bullish: 0x4ade80,  // green
  bearish: 0xf87171,  // red
  neutral: 0xfacc15,  // yellow
} as const;

const SIGNAL_LABELS = {
  bullish: 'BULLISH',
  bearish: 'BEARISH',
  neutral: 'NEUTRAL',
} as const;

/**
 * Build a rich embed for a trade analysis card.
 */
export function buildAnalysisEmbed(data: AnalysisData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SIGNAL_COLORS[data.signal])
    .setTitle(`${data.ticker.toUpperCase()}`)
    .setDescription(data.analysis.slice(0, 4096))
    .setTimestamp()
    .setFooter({ text: `Neutron | ${data.confidence ? `Confidence: ${data.confidence}%` : 'AI Analysis'}` });

  const fields: { name: string; value: string; inline: boolean }[] = [];

  fields.push({
    name: 'Signal',
    value: `${SIGNAL_LABELS[data.signal]} ${data.signal === 'bullish' ? '🟢' : data.signal === 'bearish' ? '🔴' : '🟡'}`,
    inline: true,
  });

  if (data.price) {
    fields.push({ name: 'Price', value: data.price, inline: true });
  }

  if (data.riskReward) {
    fields.push({ name: 'R:R', value: data.riskReward, inline: true });
  }

  if (data.support || data.resistance) {
    const levels = [];
    if (data.support) levels.push(`Support: ${data.support}`);
    if (data.resistance) levels.push(`Resistance: ${data.resistance}`);
    fields.push({ name: 'Key Levels', value: levels.join(' | '), inline: false });
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}

/**
 * Try to parse structured analysis from Claude's response.
 * Falls back to plain text if no structure detected.
 */
export function parseAnalysisResponse(ticker: string, response: string): AnalysisData {
  const lower = response.toLowerCase();

  // Detect signal direction
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  const bullishTerms = ['bullish', 'buy', 'long', 'upside', 'breakout'];
  const bearishTerms = ['bearish', 'sell', 'short', 'downside', 'breakdown'];

  const bullishCount = bullishTerms.filter(t => lower.includes(t)).length;
  const bearishCount = bearishTerms.filter(t => lower.includes(t)).length;

  if (bullishCount > bearishCount) signal = 'bullish';
  else if (bearishCount > bullishCount) signal = 'bearish';

  // Try to extract confidence
  const confMatch = response.match(/confidence[:\s]*(\d{1,3})%/i);
  const confidence = confMatch ? parseInt(confMatch[1]) : undefined;

  // Try to extract price
  const priceMatch = response.match(/(?:price|trading at|currently at)[:\s]*\$?([\d,.]+)/i);
  const price = priceMatch ? `$${priceMatch[1]}` : undefined;

  // Try to extract support/resistance
  const supportMatch = response.match(/support[:\s]*\$?([\d,.]+)/i);
  const resistMatch = response.match(/resistance[:\s]*\$?([\d,.]+)/i);

  // Try to extract R:R
  const rrMatch = response.match(/(?:r[:/]r|risk[- \/]reward)[:\s]*([\d.]+[:\s]*[\d.]+)/i);

  return {
    ticker,
    signal,
    analysis: response,
    confidence,
    price,
    support: supportMatch ? `$${supportMatch[1]}` : undefined,
    resistance: resistMatch ? `$${resistMatch[1]}` : undefined,
    riskReward: rrMatch ? rrMatch[1] : undefined,
  };
}
