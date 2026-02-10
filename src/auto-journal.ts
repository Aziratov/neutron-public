import { isPrimaryInvestor, recordTrade, addInsight, updateStyle, updateSectors } from './investor.js';
import { saveToBrain, readFromBrain } from './ai.js';
import { log } from './index.js';

interface DetectedTrade {
  ticker: string;
  action: string;
  price?: string;
  reasoning: string;
}

// Sector keywords for auto-detection
const SECTOR_MAP: Record<string, string[]> = {
  'Tech': ['AAPL', 'MSFT', 'GOOG', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AMD', 'TSLA', 'CRM', 'INTC', 'AVGO', 'ORCL', 'ADBE', 'NFLX', 'QCOM', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL', 'SMCI', 'PLTR', 'SNOW', 'DDOG', 'NET', 'CRWD', 'ZS', 'PANW'],
  'Finance': ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW', 'AXP', 'V', 'MA', 'PYPL', 'SQ', 'COIN'],
  'Healthcare': ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'BMY', 'AMGN', 'GILD', 'ISRG', 'MRNA', 'BNTX'],
  'Energy': ['XOM', 'CVX', 'COP', 'SLB', 'OXY', 'EOG', 'MPC', 'VLO', 'PSX', 'HAL'],
  'Consumer': ['WMT', 'COST', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP', 'PG', 'DIS'],
  'Industrial': ['CAT', 'DE', 'BA', 'HON', 'UPS', 'FDX', 'GE', 'RTX', 'LMT', 'NOC'],
};

/**
 * Detect if a message contains a trade action from the primary investor.
 * Returns detected trades or null if none found.
 */
export function detectTrades(username: string, message: string): DetectedTrade[] | null {
  if (!isPrimaryInvestor(username)) return null;

  const trades: DetectedTrade[] = [];
  const lower = message.toLowerCase();

  // Ticker pattern: 1-5 uppercase letters (often preceded by $ or standalone)
  const tickerPattern = /\$?([A-Z]{1,5})\b/g;
  const tickers: string[] = [];
  let match;

  // Extract tickers from original (not lowered) message
  while ((match = tickerPattern.exec(message)) !== null) {
    const t = match[1];
    // Filter out common English words that look like tickers
    if (!['I', 'A', 'AM', 'PM', 'AT', 'TO', 'IN', 'ON', 'IS', 'IT', 'IF', 'OR', 'AN', 'SO', 'DO', 'UP', 'THE', 'FOR', 'AND', 'BUT', 'NOT', 'ALL', 'CAN', 'HAS', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'ARE', 'HIS', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET', 'HIM', 'GOT', 'SAY', 'SHE', 'TOO', 'USE', 'DAY', 'BIG', 'FEW', 'PUT', 'RUN', 'SET', 'TRY', 'ASK', 'MEN', 'END', 'WHY', 'FAR', 'JUST', 'LIKE', 'LONG', 'MAKE', 'MANY', 'OVER', 'SUCH', 'TAKE', 'THAN', 'THEM', 'VERY', 'WHEN', 'COME', 'BEEN', 'HAVE', 'HIGH', 'THAT', 'THIS', 'WILL', 'EACH', 'FROM', 'GOOD', 'KNOW', 'LAST', 'LOOK', 'MOST', 'MUCH', 'NEED', 'ONLY', 'SOME', 'THEN', 'WHAT', 'WITH', 'ALSO', 'BACK', 'BEEN', 'CALL', 'YEAR', 'WELL', 'EVEN', 'GIVE', 'KEEP', 'WENT', 'STILL', 'GOING', 'THINK', 'ABOUT'].includes(t)) {
      tickers.push(t);
    }
  }

  if (tickers.length === 0) return null;

  // Detect buy actions
  if (/\b(bought|buying|just bought|picked up|going long|entered long|added|grabbed)\b/i.test(lower)) {
    const priceMatch = message.match(/(?:at|@|for)\s*\$?([\d,.]+)/i);
    for (const ticker of tickers) {
      trades.push({
        ticker,
        action: 'BUY',
        price: priceMatch?.[1],
        reasoning: message.slice(0, 200),
      });
    }
  }

  // Detect sell actions
  if (/\b(sold|selling|just sold|exited|dumped|closed out|took profit|cut)\b/i.test(lower)) {
    const priceMatch = message.match(/(?:at|@|for)\s*\$?([\d,.]+)/i);
    for (const ticker of tickers) {
      trades.push({
        ticker,
        action: 'SELL',
        price: priceMatch?.[1],
        reasoning: message.slice(0, 200),
      });
    }
  }

  // Detect options — puts
  if (/\b(bought puts?|opened puts?|going.*puts?|grabbed puts?|put contract|puts? on)\b/i.test(lower)) {
    for (const ticker of tickers) {
      trades.push({
        ticker,
        action: 'PUT',
        reasoning: message.slice(0, 200),
      });
    }
  }

  // Detect options — calls
  if (/\b(bought calls?|opened calls?|going.*calls?|grabbed calls?|call contract|calls? on)\b/i.test(lower)) {
    for (const ticker of tickers) {
      trades.push({
        ticker,
        action: 'CALL',
        reasoning: message.slice(0, 200),
      });
    }
  }

  // Detect watching/interested
  if (/\b(watching|eyeing|looking at|interested in|keeping an eye|tracking)\b/i.test(lower) && trades.length === 0) {
    for (const ticker of tickers) {
      trades.push({
        ticker,
        action: 'WATCH',
        reasoning: message.slice(0, 200),
      });
    }
  }

  return trades.length > 0 ? trades : null;
}

/**
 * Process detected trades — record them and update the investor profile.
 * Returns a summary string for Neutron to acknowledge.
 */
export function processDetectedTrades(trades: DetectedTrade[]): string {
  const today = new Date().toISOString().split('T')[0];
  const logged: string[] = [];

  for (const trade of trades) {
    // Record in investor profile
    recordTrade({
      ticker: trade.ticker,
      action: trade.action,
      reasoning: trade.reasoning,
      price: trade.price,
      date: today,
    });

    // Auto-detect sectors
    for (const [sector, tickers] of Object.entries(SECTOR_MAP)) {
      if (tickers.includes(trade.ticker)) {
        updateSectors([sector]);
        break;
      }
    }

    // Auto-detect trading style
    if (trade.action === 'PUT' || trade.action === 'CALL') {
      updateStyle(['Options']);
    }

    logged.push(`${trade.action} ${trade.ticker}${trade.price ? ' @ $' + trade.price : ''}`);
  }

  // Append to daily journal in brain
  const journalFile = `journal-${today}.md`;
  const existing = readFromBrain(journalFile);
  const entries = trades.map(t => {
    const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
    return `## ${t.action} ${t.ticker} — ${today} ${time} ET (auto-detected)\n**Price:** ${t.price ? '$' + t.price : 'N/A'}\n**Context:** ${t.reasoning}`;
  }).join('\n\n---\n\n');

  const content = existing
    ? `${existing}\n\n---\n\n${entries}`
    : `# Trade Journal — ${today}\n\n${entries}`;
  saveToBrain(journalFile, content);

  log(`[auto-journal] Detected and logged: ${logged.join(', ')}`);
  return logged.join(', ');
}
