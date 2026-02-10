import YahooFinance from 'yahoo-finance2';
import { log } from './index.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export interface QuoteData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  pe: number | null;
  eps: number | null;
  high52w: number;
  low52w: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  marketState: string;
  shortName: string;
}

export interface HistoricalDay {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionsData {
  expirationDates: string[];
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionContract {
  strike: number;
  expiration: string;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

/**
 * Fetch a real-time quote for a ticker.
 */
export async function getQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const result: any = await yf.quote(ticker);
    if (!result) return null;

    return {
      ticker: result.symbol,
      price: result.regularMarketPrice ?? 0,
      change: result.regularMarketChange ?? 0,
      changePercent: result.regularMarketChangePercent ?? 0,
      volume: result.regularMarketVolume ?? 0,
      avgVolume: result.averageDailyVolume3Month ?? 0,
      marketCap: result.marketCap ?? 0,
      pe: result.trailingPE ?? null,
      eps: result.epsTrailingTwelveMonths ?? null,
      high52w: result.fiftyTwoWeekHigh ?? 0,
      low52w: result.fiftyTwoWeekLow ?? 0,
      dayHigh: result.regularMarketDayHigh ?? 0,
      dayLow: result.regularMarketDayLow ?? 0,
      previousClose: result.regularMarketPreviousClose ?? 0,
      marketState: result.marketState ?? 'UNKNOWN',
      shortName: result.shortName ?? ticker,
    };
  } catch (err) {
    log(`[market-data] Quote failed for ${ticker}: ${err}`);
    return null;
  }
}

/**
 * Fetch historical daily prices.
 */
export async function getHistoricalPrices(ticker: string, days: number = 30): Promise<HistoricalDay[]> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result: any = await yf.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    if (!result?.quotes) return [];

    return result.quotes
      .filter((q: any) => q.close !== null)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().split('T')[0],
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        close: q.close ?? 0,
        volume: q.volume ?? 0,
      }));
  } catch (err) {
    log(`[market-data] Historical data failed for ${ticker}: ${err}`);
    return [];
  }
}

/**
 * Fetch options chain for a ticker.
 */
export async function getOptionsChain(ticker: string): Promise<OptionsData | null> {
  try {
    const result: any = await yf.options(ticker);
    if (!result) return null;

    const expirationDates = (result.expirationDates || []).map((d: any) =>
      new Date(d).toISOString().split('T')[0]
    );

    const mapContracts = (contracts: any[]): OptionContract[] =>
      (contracts || []).map(c => ({
        strike: c.strike ?? 0,
        expiration: c.expiration ? new Date(c.expiration).toISOString().split('T')[0] : '',
        lastPrice: c.lastPrice ?? 0,
        bid: c.bid ?? 0,
        ask: c.ask ?? 0,
        volume: c.volume ?? 0,
        openInterest: c.openInterest ?? 0,
        impliedVolatility: c.impliedVolatility ?? 0,
        inTheMoney: c.inTheMoney ?? false,
      }));

    return {
      expirationDates,
      calls: mapContracts(result.options?.[0]?.calls),
      puts: mapContracts(result.options?.[0]?.puts),
    };
  } catch (err) {
    log(`[market-data] Options chain failed for ${ticker}: ${err}`);
    return null;
  }
}

/**
 * Compute basic technical indicators from historical data.
 */
function computeTechnicals(history: HistoricalDay[]): string {
  if (history.length < 5) return 'Insufficient data for technicals.';

  const closes = history.map(h => h.close);
  const latest = closes[closes.length - 1];
  const parts: string[] = [];

  // Simple Moving Averages
  if (closes.length >= 10) {
    const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    parts.push(`SMA(10): $${sma10.toFixed(2)} ${latest > sma10 ? '(above)' : '(below)'}`);
  }
  if (closes.length >= 20) {
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    parts.push(`SMA(20): $${sma20.toFixed(2)} ${latest > sma20 ? '(above)' : '(below)'}`);
  }

  // RSI (14-period)
  if (closes.length >= 15) {
    const changes = closes.slice(-15).map((c, i, arr) => i === 0 ? 0 : c - arr[i - 1]).slice(1);
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0.001;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    const rsiLabel = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'neutral';
    parts.push(`RSI(14): ${rsi.toFixed(1)} (${rsiLabel})`);
  }

  // Volume trend (last 5 days vs average)
  if (history.length >= 10) {
    const recentVol = history.slice(-5).reduce((a, b) => a + b.volume, 0) / 5;
    const olderVol = history.slice(-10, -5).reduce((a, b) => a + b.volume, 0) / 5;
    const volRatio = recentVol / (olderVol || 1);
    const volLabel = volRatio > 1.5 ? 'HIGH (expanding)' : volRatio < 0.7 ? 'LOW (contracting)' : 'normal';
    parts.push(`Volume trend: ${volLabel} (${volRatio.toFixed(1)}x avg)`);
  }

  // 5-day price change
  if (closes.length >= 5) {
    const fiveDayChange = ((latest - closes[closes.length - 5]) / closes[closes.length - 5] * 100);
    parts.push(`5-day change: ${fiveDayChange > 0 ? '+' : ''}${fiveDayChange.toFixed(2)}%`);
  }

  // Support/Resistance from recent highs/lows
  if (history.length >= 10) {
    const recentHighs = history.slice(-10).map(h => h.high);
    const recentLows = history.slice(-10).map(h => h.low);
    const resistance = Math.max(...recentHighs);
    const support = Math.min(...recentLows);
    parts.push(`10-day support: $${support.toFixed(2)} | resistance: $${resistance.toFixed(2)}`);
  }

  return parts.join('\n');
}

/**
 * Build a complete market context string for a ticker.
 * This gets injected into the AI prompt so Claude has real data.
 */
export async function buildMarketContext(ticker: string): Promise<string> {
  const [quote, history] = await Promise.all([
    getQuote(ticker),
    getHistoricalPrices(ticker, 30),
  ]);

  if (!quote) return `[No market data available for ${ticker}]`;

  const parts: string[] = [];

  // Current quote
  const changeSign = quote.change >= 0 ? '+' : '';
  parts.push(`## Live Market Data: ${quote.shortName} (${quote.ticker})`);
  parts.push(`Price: $${quote.price.toFixed(2)} (${changeSign}${quote.change.toFixed(2)}, ${changeSign}${quote.changePercent.toFixed(2)}%)`);
  parts.push(`Day Range: $${quote.dayLow.toFixed(2)} - $${quote.dayHigh.toFixed(2)}`);
  parts.push(`52-Week Range: $${quote.low52w.toFixed(2)} - $${quote.high52w.toFixed(2)}`);
  parts.push(`Volume: ${formatNumber(quote.volume)} (avg: ${formatNumber(quote.avgVolume)})`);
  if (quote.marketCap) parts.push(`Market Cap: $${formatNumber(quote.marketCap)}`);
  if (quote.pe) parts.push(`P/E: ${quote.pe.toFixed(2)}`);
  if (quote.eps) parts.push(`EPS: $${quote.eps.toFixed(2)}`);
  parts.push(`Previous Close: $${quote.previousClose.toFixed(2)}`);
  parts.push(`Market State: ${quote.marketState}`);

  // Technical indicators
  if (history.length > 0) {
    parts.push('');
    parts.push('## Technical Indicators');
    parts.push(computeTechnicals(history));

    // Recent price action (last 5 days)
    parts.push('');
    parts.push('## Recent Price Action (last 5 trading days)');
    for (const day of history.slice(-5)) {
      const dayChange = ((day.close - day.open) / day.open * 100);
      parts.push(`${day.date}: O:$${day.open.toFixed(2)} H:$${day.high.toFixed(2)} L:$${day.low.toFixed(2)} C:$${day.close.toFixed(2)} (${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(2)}%) Vol:${formatNumber(day.volume)}`);
    }
  }

  return parts.join('\n');
}

/**
 * Build options context for a ticker.
 */
export async function buildOptionsContext(ticker: string): Promise<string> {
  const [quote, chain] = await Promise.all([
    getQuote(ticker),
    getOptionsChain(ticker),
  ]);

  if (!quote) return `[No market data available for ${ticker}]`;
  if (!chain) return `[No options data available for ${ticker}]`;

  const parts: string[] = [];
  parts.push(`## Live Options Data: ${ticker} @ $${quote.price.toFixed(2)}`);
  parts.push(`Available expirations: ${chain.expirationDates.slice(0, 6).join(', ')}`);

  // Show ATM options (closest strikes to current price)
  const atm = quote.price;
  const nearCalls = chain.calls
    .filter(c => Math.abs(c.strike - atm) / atm < 0.1) // within 10% of ATM
    .slice(0, 8);
  const nearPuts = chain.puts
    .filter(p => Math.abs(p.strike - atm) / atm < 0.1)
    .slice(0, 8);

  if (nearCalls.length > 0) {
    parts.push('');
    parts.push('### Near-ATM Calls');
    parts.push('Strike | Last | Bid | Ask | Volume | OI | IV');
    for (const c of nearCalls) {
      parts.push(`$${c.strike} | $${c.lastPrice.toFixed(2)} | $${c.bid.toFixed(2)} | $${c.ask.toFixed(2)} | ${c.volume} | ${c.openInterest} | ${(c.impliedVolatility * 100).toFixed(1)}%`);
    }
  }

  if (nearPuts.length > 0) {
    parts.push('');
    parts.push('### Near-ATM Puts');
    parts.push('Strike | Last | Bid | Ask | Volume | OI | IV');
    for (const p of nearPuts) {
      parts.push(`$${p.strike} | $${p.lastPrice.toFixed(2)} | $${p.bid.toFixed(2)} | $${p.ask.toFixed(2)} | ${p.volume} | ${p.openInterest} | ${(p.impliedVolatility * 100).toFixed(1)}%`);
    }
  }

  // Average IV
  const allIVs = [...chain.calls, ...chain.puts]
    .map(c => c.impliedVolatility)
    .filter(iv => iv > 0);
  if (allIVs.length > 0) {
    const avgIV = allIVs.reduce((a, b) => a + b, 0) / allIVs.length;
    parts.push('');
    parts.push(`Average IV: ${(avgIV * 100).toFixed(1)}%`);
  }

  return parts.join('\n');
}

/**
 * Get multiple quotes at once (for watchlist, morning brief, etc).
 */
export async function getMultipleQuotes(tickers: string[]): Promise<Map<string, QuoteData>> {
  const results = new Map<string, QuoteData>();
  // Fetch in parallel, max 5 concurrent
  const chunks: string[][] = [];
  for (let i = 0; i < tickers.length; i += 5) {
    chunks.push(tickers.slice(i, i + 5));
  }
  for (const chunk of chunks) {
    const promises = chunk.map(async t => {
      const q = await getQuote(t);
      if (q) results.set(t, q);
    });
    await Promise.all(promises);
  }
  return results;
}

/**
 * Build a watchlist summary with real prices.
 */
export async function buildWatchlistContext(tickers: string[]): Promise<string> {
  if (tickers.length === 0) return '';
  const quotes = await getMultipleQuotes(tickers);
  if (quotes.size === 0) return '';

  const lines: string[] = ['## Watchlist (Live Data)'];
  for (const [ticker, q] of quotes) {
    const sign = q.change >= 0 ? '+' : '';
    lines.push(`- **${ticker}**: $${q.price.toFixed(2)} (${sign}${q.changePercent.toFixed(2)}%) Vol: ${formatNumber(q.volume)}`);
  }
  return lines.join('\n');
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
