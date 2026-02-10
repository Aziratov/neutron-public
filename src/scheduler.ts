import { Client, TextChannel } from 'discord.js';
import { askClaude, saveToBrain } from './ai.js';
import { getWatchlistTickers } from './watchlist.js';
import { buildWatchlistContext } from './market-data.js';
import { chunkMessage } from './utils/chunk.js';
import {
  getPendingReviews, batchUpdateOutcomes, recordWeeklyScore,
  addStrategyNote, markNightlyReview, markWeeklyReview,
  getLastNightlyReview, getLastWeeklyReview, loadPerformance,
  recordRecommendation,
} from './performance.js';
import { runBrainMaintenance } from './brain-manager.js';
import { exportWeeklySummary } from './cross-learning.js';
import { log } from './index.js';

// US market hours in ET: Pre-market 4:00 AM, Open 9:30 AM, Close 4:00 PM
// Server runs in UTC — ET = UTC-5 (EST) or UTC-4 (EDT)
// We'll use America/New_York for proper DST handling

function getETHour(): number {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours();
}

function getETMinute(): number {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getMinutes();
}

function isWeekday(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  return day >= 1 && day <= 5;
}

function getTodayET(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.toISOString().split('T')[0];
}

/**
 * Find a channel by name in the first guild the bot is in.
 */
function findChannel(client: Client, channelName: string): TextChannel | null {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      ch => ch.isTextBased() && 'name' in ch && ch.name === channelName
    );
    if (channel && channel.isTextBased()) return channel as TextChannel;
  }
  return null;
}

/**
 * Post a message to a named channel.
 */
async function postToChannel(client: Client, channelName: string, message: string): Promise<void> {
  const channel = findChannel(client, channelName);
  if (!channel) {
    log(`[scheduler] Channel #${channelName} not found`);
    return;
  }

  const chunks = chunkMessage(message);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// Track which scans have run today to avoid duplicates
const ranToday: Record<string, string> = {};

function hasRunToday(scanName: string): boolean {
  return ranToday[scanName] === getTodayET();
}

function markRanToday(scanName: string): void {
  ranToday[scanName] = getTodayET();
}

/**
 * Pre-market morning brief — runs ~8:30 AM ET on weekdays.
 * Posts to #trade-signals with watchlist overview + market outlook.
 */
async function morningBrief(client: Client): Promise<void> {
  const tickers = getWatchlistTickers();
  const watchlistStr = tickers.length > 0
    ? `Current watchlist: ${tickers.join(', ')}`
    : 'No tickers on the watchlist yet.';

  // Fetch live prices for the watchlist
  const watchlistData = tickers.length > 0 ? await buildWatchlistContext(tickers) : '';

  const prompt = `It's pre-market morning. Give a brief morning market outlook for today.

${watchlistStr}
${watchlistData ? `\n${watchlistData}` : ''}

Cover:
1. Pre-market futures and overnight action (S&P, Nasdaq, Dow direction)
2. Any major news or catalysts for today (earnings, economic data, Fed)
3. ${tickers.length > 0 ? `Quick pre-market check on watchlist tickers: ${tickers.join(', ')}` : 'General sectors to watch today'}
4. Your overall market bias for the day (bullish/bearish/cautious)

Keep it punchy — this is a Discord morning brief, not a report. 15-20 lines max.`;

  try {
    log('[scheduler] Running morning brief...');
    const response = await askClaude(prompt);
    await postToChannel(client, 'trade-signals', `**Morning Brief — ${getTodayET()}**\n\n${response}`);

    // Save to brain
    saveToBrain(`morning-brief-${getTodayET()}.md`, `# Morning Brief — ${getTodayET()}\n\n${response}`);

    // Extract and record any directional recommendations
    recordScanRecommendations(response, 'morning-brief');

    log(`[scheduler] Morning brief posted (${response.length} chars)`);
  } catch (err) {
    log(`[scheduler] Morning brief failed: ${err}`);
  }
}

/**
 * EOD recap — runs ~4:30 PM ET on weekdays.
 * Posts to #trade-signals with day's summary.
 */
async function eodRecap(client: Client): Promise<void> {
  const tickers = getWatchlistTickers();
  const watchlistStr = tickers.length > 0
    ? `Watchlist tickers to cover: ${tickers.join(', ')}`
    : 'No specific watchlist — cover major indices.';

  // Fetch live prices for the watchlist
  const watchlistData = tickers.length > 0 ? await buildWatchlistContext(tickers) : '';

  const prompt = `Market just closed. Give an end-of-day recap.

${watchlistStr}
${watchlistData ? `\n${watchlistData}` : ''}

Cover:
1. How the major indices closed (S&P 500, Nasdaq, Dow — direction and magnitude)
2. Key movers — what stood out today?
3. ${tickers.length > 0 ? `How did the watchlist do? Quick scoreboard for: ${tickers.join(', ')}` : 'Notable sector performance'}
4. Volume and breadth — was this conviction or noise?
5. What to watch for tomorrow

Keep it concise — Discord recap, not an essay. 15-20 lines max.`;

  try {
    log('[scheduler] Running EOD recap...');
    const response = await askClaude(prompt);
    await postToChannel(client, 'trade-signals', `**End of Day Recap — ${getTodayET()}**\n\n${response}`);

    saveToBrain(`eod-recap-${getTodayET()}.md`, `# End of Day Recap — ${getTodayET()}\n\n${response}`);

    // Extract and record any directional recommendations
    recordScanRecommendations(response, 'eod-recap');

    log(`[scheduler] EOD recap posted (${response.length} chars)`);
  } catch (err) {
    log(`[scheduler] EOD recap failed: ${err}`);
  }
}

/**
 * Nightly review — 8 PM ET on weekdays.
 * Reviews pending recommendations from the last few days using Claude,
 * scores them, and extracts lessons learned.
 */
async function nightlyReview(client: Client): Promise<void> {
  const today = getTodayET();
  if (getLastNightlyReview() === today) return;

  const pending = getPendingReviews();
  if (pending.length === 0) {
    markNightlyReview();
    log('[scheduler] Nightly review: no pending recommendations to review');
    return;
  }

  // Build the review prompt — list all pending recommendations for Claude to evaluate
  const recList = pending.slice(0, 15).map((r, i) =>
    `${i + 1}. [${r.id}] ${r.date} — ${r.direction} on ${r.ticker} (${r.confidence}% confidence)\n   Summary: ${r.summary}`
  ).join('\n\n');

  const prompt = `You are Neutron doing your nightly self-review. Below are your recent trading recommendations that need outcome evaluation.

For EACH recommendation, evaluate:
1. Was the call CORRECT, WRONG, or PARTIAL? Use today's market data and what you know about recent price action.
2. Brief notes on why (1-2 sentences).

If you genuinely can't evaluate a recommendation (stock hasn't moved enough, too early), say "skip" for that one.

Also, at the end, write ONE strategy lesson you learned from reviewing these calls — something specific and actionable about your own analysis patterns.

## Pending Recommendations
${recList}

## Response Format
For each recommendation, respond with EXACTLY this format (one per line):
REVIEW: [id] | [correct/wrong/partial/skip] | [brief notes]

Then at the end:
LESSON: [your key takeaway]`;

  try {
    log(`[scheduler] Running nightly review (${pending.length} pending)...`);
    const response = await askClaude(prompt);

    // Parse the AI review results
    const updates: { id: string; outcome: 'correct' | 'wrong' | 'partial'; notes: string }[] = [];
    const reviewLines = response.match(/REVIEW:\s*([^\n]+)/gi) || [];

    for (const line of reviewLines) {
      const match = line.match(/REVIEW:\s*\[?([^\]|]+)\]?\s*\|\s*(correct|wrong|partial|skip)\s*\|\s*(.+)/i);
      if (!match) continue;
      const [, id, outcome, notes] = match;
      if (outcome.toLowerCase() === 'skip') continue;
      updates.push({
        id: id.trim(),
        outcome: outcome.toLowerCase() as 'correct' | 'wrong' | 'partial',
        notes: notes.trim(),
      });
    }

    if (updates.length > 0) {
      batchUpdateOutcomes(updates);
      log(`[scheduler] Nightly review: scored ${updates.length} recommendations`);
    }

    // Extract the lesson
    const lessonMatch = response.match(/LESSON:\s*(.+)/i);
    if (lessonMatch) {
      addStrategyNote(lessonMatch[1].trim());
    }

    // Post a brief recap to #strategy channel
    const scored = updates.length;
    const correct = updates.filter(u => u.outcome === 'correct').length;
    const wrong = updates.filter(u => u.outcome === 'wrong').length;
    const recap = [
      `**Nightly Self-Review — ${today}**`,
      `Reviewed ${scored} recommendations: ${correct} correct, ${wrong} wrong, ${scored - correct - wrong} partial`,
      lessonMatch ? `\n**Lesson:** ${lessonMatch[1].trim()}` : '',
    ].filter(Boolean).join('\n');

    await postToChannel(client, 'strategy', recap);

    // Save review to brain
    saveToBrain(`nightly-review-${today}.md`, `# Nightly Review — ${today}\n\n${response}`);
    markNightlyReview();
    log('[scheduler] Nightly review complete');
  } catch (err) {
    log(`[scheduler] Nightly review failed: ${err}`);
  }
}

/**
 * Weekly review — Friday 8:30 PM ET.
 * Compiles weekly score, identifies best/worst calls, generates strategy insights.
 */
async function weeklyReview(client: Client): Promise<void> {
  const today = getTodayET();
  if (getLastWeeklyReview() === today) return;

  const perf = loadPerformance();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get this week's reviewed recommendations
  const thisWeek = perf.recommendations.filter(r =>
    r.date >= oneWeekAgo && r.outcome && r.outcome !== 'pending'
  );

  if (thisWeek.length < 2) {
    markWeeklyReview();
    log('[scheduler] Weekly review: not enough reviewed calls this week');
    return;
  }

  const correct = thisWeek.filter(r => r.outcome === 'correct').length;
  const wrong = thisWeek.filter(r => r.outcome === 'wrong').length;
  const partial = thisWeek.filter(r => r.outcome === 'partial').length;
  const accuracy = Math.round((correct + partial * 0.5) / thisWeek.length * 100);

  const callList = thisWeek.map(r =>
    `- ${r.date}: ${r.direction} on ${r.ticker} (${r.confidence}%) → ${r.outcome}${r.reviewNotes ? ` — ${r.reviewNotes}` : ''}`
  ).join('\n');

  const prompt = `You are Neutron doing your weekly performance review. Here's your week:

## This Week's Calls
${callList}

## Stats
- Total: ${thisWeek.length} | Correct: ${correct} | Wrong: ${wrong} | Partial: ${partial}
- Accuracy: ${accuracy}%

Based on this week's performance:
1. What was your BEST call and why?
2. What was your WORST call and why?
3. What is the ONE most important lesson from this week?
4. What pattern should you watch for next week?

Be specific and self-critical. This is for your own improvement.`;

  try {
    log('[scheduler] Running weekly review...');
    const response = await askClaude(prompt);

    // Extract best/worst calls and lesson from the AI response
    const bestMatch = response.match(/best\s*call[:\s]*(.{10,200})/i);
    const worstMatch = response.match(/worst\s*call[:\s]*(.{10,200})/i);
    const lessonMatch = response.match(/lesson[:\s]*(.{10,200})/i);

    recordWeeklyScore({
      weekOf: oneWeekAgo,
      totalCalls: thisWeek.length,
      correct,
      wrong,
      partial,
      accuracy,
      bestCall: bestMatch ? bestMatch[1].trim().slice(0, 200) : 'N/A',
      worstCall: worstMatch ? worstMatch[1].trim().slice(0, 200) : 'N/A',
      lesson: lessonMatch ? lessonMatch[1].trim().slice(0, 200) : 'Keep refining analysis approach',
    });

    // Post weekly report to #strategy
    await postToChannel(client, 'strategy', `**Weekly Performance Report — Week of ${oneWeekAgo}**\n\n${response}`);

    // Save to brain
    saveToBrain(`weekly-review-${today}.md`, `# Weekly Review — ${today}\n\n${response}`);

    // Export summary for Jarvis
    exportWeeklySummary();

    // Run brain maintenance
    runBrainMaintenance();

    markWeeklyReview();
    log(`[scheduler] Weekly review complete — ${accuracy}% accuracy this week`);
  } catch (err) {
    log(`[scheduler] Weekly review failed: ${err}`);
  }
}

/**
 * Record recommendations from scheduled scans (morning brief / EOD recap).
 * Extracts directional calls from the AI response.
 */
function recordScanRecommendations(response: string, type: string): void {
  const today = getTodayET();
  // Look for bullish/bearish signals on specific tickers
  const patterns = [
    /\b(bullish|bearish|neutral)\s+(?:on\s+)?(?:\$?)([A-Z]{1,5})\b/gi,
    /(?:\$?)([A-Z]{1,5})\b[^.]*?\b(bullish|bearish|neutral)\b/gi,
  ];

  const seen = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      // Normalize: first pattern has direction first, second has ticker first
      const direction = (match[1].length <= 5 && /^[A-Z]+$/.test(match[1])) ? match[2] : match[1];
      const ticker = (match[1].length <= 5 && /^[A-Z]+$/.test(match[1])) ? match[1] : match[2];
      const dir = direction.toLowerCase() as 'bullish' | 'bearish' | 'neutral';

      // Skip common words that look like tickers
      if (['I', 'A', 'AM', 'PM', 'AT', 'TO', 'IN', 'ON', 'IS', 'IT', 'THE', 'AND', 'BUT', 'FOR', 'NOT', 'ALL', 'UP', 'ANY'].includes(ticker)) continue;
      if (seen.has(ticker)) continue;
      seen.add(ticker);

      recordRecommendation({
        date: today,
        ticker,
        direction: dir,
        confidence: 50, // scheduled scans are moderate confidence
        type,
        summary: `${type}: ${response.slice(0, 150)}`,
      });
    }
  }
}

/**
 * Start the scheduler. Checks every minute for scheduled tasks.
 */
export function startScheduler(client: Client): void {
  log('[scheduler] Market scan scheduler started');

  setInterval(() => {
    const hour = getETHour();
    const minute = getETMinute();
    const weekday = isWeekday();

    // === Weekday-only tasks ===
    if (weekday) {
      // Morning brief at 8:30 AM ET
      if (hour === 8 && minute >= 30 && minute <= 35 && !hasRunToday('morning')) {
        markRanToday('morning');
        morningBrief(client);
      }

      // EOD recap at 4:30 PM ET
      if (hour === 16 && minute >= 30 && minute <= 35 && !hasRunToday('eod')) {
        markRanToday('eod');
        eodRecap(client);
      }

      // Nightly review at 8:00 PM ET
      if (hour === 20 && minute >= 0 && minute <= 5 && !hasRunToday('nightly-review')) {
        markRanToday('nightly-review');
        nightlyReview(client);
      }
    }

    // === Friday-only: weekly review at 8:30 PM ET ===
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (et.getDay() === 5 && hour === 20 && minute >= 30 && minute <= 35 && !hasRunToday('weekly-review')) {
      markRanToday('weekly-review');
      weeklyReview(client);
    }

    // === Saturday morning: brain maintenance + cross-learning export ===
    if (et.getDay() === 6 && hour === 9 && minute >= 0 && minute <= 5 && !hasRunToday('maintenance')) {
      markRanToday('maintenance');
      try {
        runBrainMaintenance();
        exportWeeklySummary();
        log('[scheduler] Saturday maintenance complete');
      } catch (err) {
        log(`[scheduler] Saturday maintenance failed: ${err}`);
      }
    }
  }, 60_000); // Check every minute
}
