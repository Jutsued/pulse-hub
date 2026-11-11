// ------------------------------------------------------------------
// Headline sentiment scorer (simple word lists, no AI, no API)
// ------------------------------------------------------------------
// How it works:
//   1. Lowercase the headline and split it into words.
//   2. Each word found in POSITIVE adds its weight, each in NEGATIVE subtracts.
//   3. A word right after "not", "no", "never", "without" flips its sign.
//   4. The total is squashed into the range -1 (very negative) .. +1 (very positive).
//
// It's not perfect (sarcasm, context and numbers are ignored), but it's
// consistent, which is what matters when COMPARING sources against each other.
// ------------------------------------------------------------------

const POSITIVE = {
  surge: 2, surges: 2, surged: 2, soar: 2, soars: 2, soared: 2, jump: 1.5, jumps: 1.5, jumped: 1.5,
  rally: 2, rallies: 2, rallied: 2, gain: 1, gains: 1, gained: 1, rise: 1, rises: 1, rose: 1, rising: 1,
  climb: 1, climbs: 1, climbed: 1, rebound: 1.5, rebounds: 1.5, rebounded: 1.5, recover: 1, recovers: 1, recovery: 1,
  beat: 1.5, beats: 1.5, tops: 1, top: 0.5, record: 1, high: 0.5, highs: 0.5, boom: 1.5, booming: 1.5,
  strong: 1, stronger: 1, strength: 1, robust: 1, solid: 0.5, upbeat: 1.5, optimism: 1.5, optimistic: 1.5,
  upgrade: 1.5, upgrades: 1.5, upgraded: 1.5, outperform: 1.5, bullish: 2, bull: 1, buy: 0.5,
  growth: 1, grow: 1, grows: 1, expand: 1, expands: 1, expansion: 1, profit: 1, profits: 1, profitable: 1,
  win: 1, wins: 1, won: 1, success: 1, breakthrough: 1.5, deal: 0.5, agreement: 0.5, peace: 1.5, ceasefire: 1,
  approve: 1, approves: 1, approved: 1, approval: 1, boost: 1.5, boosts: 1.5, boosted: 1.5, lifts: 1, lift: 1,
  improve: 1, improves: 1, improved: 1, easing: 0.5, eases: 0.5, relief: 1, raises: 0.5, raised: 0.5,
  hire: 0.5, hiring: 0.5, launch: 0.5, launches: 0.5, celebrate: 1, celebrates: 1, award: 1,
};

const NEGATIVE = {
  plunge: 2, plunges: 2, plunged: 2, plummet: 2, plummets: 2, crash: 2.5, crashes: 2.5, crashed: 2.5,
  tumble: 2, tumbles: 2, tumbled: 2, sink: 1.5, sinks: 1.5, sank: 1.5, slump: 2, slumps: 2, slide: 1.5,
  slides: 1.5, slid: 1.5, fall: 1, falls: 1, fell: 1, falling: 1, drop: 1, drops: 1, dropped: 1, decline: 1,
  declines: 1, declined: 1, lose: 1, loses: 1, lost: 1, loss: 1, losses: 1, selloff: 2, "sell-off": 2,
  miss: 1.5, misses: 1.5, missed: 1.5, weak: 1, weaker: 1, weakness: 1, slow: 0.5, slows: 1, slowdown: 1.5,
  downgrade: 1.5, downgrades: 1.5, downgraded: 1.5, bearish: 2, bear: 1, sell: 0.5, cut: 1, cuts: 1,
  fear: 1.5, fears: 1.5, worry: 1, worries: 1, worried: 1, concern: 1, concerns: 1, risk: 0.5, risks: 0.5,
  warn: 1.5, warns: 1.5, warning: 1.5, crisis: 2, recession: 2, inflation: 1, hike: 0.5, hikes: 0.5,
  tariff: 0.5, tariffs: 0.5, war: 2, attack: 2, attacks: 2, strike: 1, strikes: 1, killed: 2.5, dead: 2.5,
  deaths: 2.5, kill: 2, kills: 2, conflict: 1.5, violence: 2, shooting: 2, earthquake: 2, flood: 2,
  floods: 2, storm: 1, wildfire: 2, disaster: 2, collapse: 2, collapses: 2, bankruptcy: 2.5, bankrupt: 2.5,
  layoffs: 2, layoff: 2, fired: 1, lawsuit: 1.5, sues: 1.5, sued: 1.5, probe: 1.5, investigation: 1.5,
  scandal: 2, fraud: 2.5, charged: 1.5, arrest: 1.5, arrested: 1.5, ban: 1, bans: 1, banned: 1,
  shutdown: 1.5, default: 2, volatile: 1, volatility: 1, turmoil: 2, chaos: 2, slashes: 1.5, slash: 1.5,
  lower: 0.5, low: 0.5, lows: 1, worst: 2, bad: 1, threat: 1.5, threatens: 1.5, sanctions: 1, protest: 1,
  protests: 1, delay: 0.5, delays: 0.5, recall: 1, recalls: 1, glut: 1.5, oversupply: 1.5, bubble: 1.5,
};

const NEGATORS = new Set(["not", "no", "never", "without", "isn't", "wasn't", "don't", "doesn't", "won't", "can't"]);

export function scoreText(text = "") {
  const words = text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .split(/[^a-z\-']+/)
    .filter(Boolean);

  let total = 0;
  let hits = 0;
  words.forEach((word, i) => {
    let weight = 0;
    if (POSITIVE[word]) weight = POSITIVE[word];
    else if (NEGATIVE[word]) weight = -NEGATIVE[word];
    if (!weight) return;
    if (i > 0 && NEGATORS.has(words[i - 1])) weight = -weight;
    total += weight;
    hits++;
  });

  // Squash: total / sqrt(total^2 + 4) keeps the result between -1 and 1.
  const score = hits ? total / Math.sqrt(total * total + 4) : 0;
  return { score: Number(score.toFixed(3)), hits };
}
