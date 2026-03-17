require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// CACHE
const CACHE = {};
const fresh = (k, ttl) => CACHE[k] && Date.now() - CACHE[k].at < ttl;

// ══ COINGECKO — BTC ETH SOL BNB QUBIC ══
async function getPrices() {
  if (fresh('prices', 60000)) return CACHE.prices.data;
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin,qubic-network&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await r.json();
    CACHE.prices = { data, at: Date.now() };
    return data;
  } catch(e) {
    return CACHE.prices?.data || {};
  }
}

// ══ QUFC PRICE จาก Qubic RPC ══
async function getQUFCPrice() {
  if (fresh('qufc', 60000)) return CACHE.qufc.data;
  try {
    const r = await fetch('https://rpc.qubic.org/v1/assets/QUFC/issuances');
    const d = await r.json();
    const price = d?.issuances?.[0]?.price || 0;
    const data = { usd: price, usd_24h_change: 0 };
    CACHE.qufc = { data, at: Date.now() };
    return data;
  } catch(e) {
    return { usd: 0.0000001, usd_24h_change: 0 };
  }
}

// ══ FOOTBALL ══
async function getFootball() {
  if (fresh('football', 300000)) return CACHE.football.data;
  if (!API_SPORTS_KEY) return mockFootball();
  try {
    const today = new Date().toISOString().split('T')[0];
    const [live, upcoming] = await Promise.all([
      fetch('https://v3.football.api-sports.io/fixtures?live=all',
        { headers: { 'x-apisports-key': API_SPORTS_KEY } }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures?date=${today}&league=39,140,78,135,61&season=2024`,
        { headers: { 'x-apisports-key': API_SPORTS_KEY } }).then(r => r.json()),
    ]);
    const all = [
      ...(live.response || []).map(f => ({ ...f, isLive: true })),
      ...(upcoming.response || []).filter(f => f.fixture.status.short === 'NS').map(f => ({ ...f, isLive: false })),
    ].slice(0, 10);
    const data = all.map(f => ({
      id: `s-${f.fixture.id}`,
      cat: 'soccer',
      league: f.league.name,
      isLive: f.isLive,
      elapsed: f.fixture.status.elapsed,
      date: f.fixture.date,
      home: f.teams.home.name,
      away: f.teams.away.name,
      scoreHome: f.goals.home,
      scoreAway: f.goals.away,
      source: 'API-Sports ✓',
    }));
    CACHE.football = { data, at: Date.now() };
    return data;
  } catch(e) {
    return mockFootball();
  }
}

// ══ BASKETBALL ══
async function getBasketball() {
  if (fresh('basketball', 300000)) return CACHE.basketball.data;
  if (!API_SPORTS_KEY) return mockBasketball();
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(
      `https://v1.basketball.api-sports.io/games?date=${today}&league=12&season=2024-2025`,
      { headers: { 'x-apisports-key': API_SPORTS_KEY } }
    );
    const d = await r.json();
    const data = (d.response || []).slice(0, 6).map(g => ({
      id: `b-${g.id}`,
      cat: 'basketball',
      league: g.league.name,
      isLive: g.status.short === 'LIVE',
      home: g.teams.home.name,
      away: g.teams.visitors.name,
      scoreHome: g.scores.home.total,
      scoreAway: g.scores.visitors.total,
      quarter: g.status.short === 'LIVE' ? `Q${g.periods.current}` : null,
      source: 'API-Sports ✓',
    }));
    CACHE.basketball = { data, at: Date.now() };
    return data;
  } catch(e) {
    return mockBasketball();
  }
}

// ══ MMA ══
async function getMMA() {
  if (fresh('mma', 600000)) return CACHE.mma.data;
  if (!API_SPORTS_KEY) return mockMMA();
  try {
    const r = await fetch('https://v1.mma.api-sports.io/fights?next=10',
      { headers: { 'x-apisports-key': API_SPORTS_KEY } });
    const d = await r.json();
    const data = (d.response || []).slice(0, 5).map(f => ({
      id: `mma-${f.id}`,
      cat: 'mma',
      league: f.league?.name || 'MMA',
      isLive: false,
      home: f.fighters?.first?.name || 'Fighter 1',
      away: f.fighters?.second?.name || 'Fighter 2',
      source: 'API-Sports ✓',
    }));
    CACHE.mma = { data, at: Date.now() };
    return data;
  } catch(e) {
    return mockMMA();
  }
}

// ══ BUILD BINARY MARKETS จากราคาเหรียญ ══
function buildBinaryMarkets(prices, qufcPrice) {
  const coins = [
    { id: 'bitcoin',       sym: 'BTC', icon: '₿',  tier: 1 },
    { id: 'ethereum',      sym: 'ETH', icon: 'Ξ',  tier: 1 },
    { id: 'solana',        sym: 'SOL', icon: '◎',  tier: 1 },
    { id: 'binancecoin',   sym: 'BNB', icon: '⬡',  tier: 1 },
    { id: 'qubic-network', sym: 'QUBIC',icon: '⚡', tier: 2 },
  ];

  const timeframes = [
    { label: '5 MIN',  minutes: 5,  reward: '2,000 QUFC'  },
    { label: '15 MIN', minutes: 15, reward: '5,000 QUFC'  },
    { label: '1 HOUR', minutes: 60, reward: '10,000 QUFC' },
  ];

  const markets = [];
  coins.forEach(coin => {
    const d = prices[coin.id];
    if (!d) return;
    timeframes.forEach(tf => {
      const closeTime = new Date(Date.now() + tf.minutes * 60000).toISOString();
      markets.push({
        id: `binary-${coin.id}-${tf.minutes}`,
        cat: 'binary',
        icon: coin.icon,
        sym: coin.sym,
        tier: coin.tier,
        league: `🎯 Binary · ${coin.sym}/USDT`,
        isLive: true,
        timeframe: tf.label,
        minutes: tf.minutes,
        closeTime,
        curPrice: d.usd,
        chg24: d.usd_24h_change,
        reward: tf.reward,
        rp: 30000 + Math.floor(Math.random() * 50000),
        bp: 28000 + Math.floor(Math.random() * 45000),
        source: 'CoinGecko ✓',
      });
    });
  });

  // เพิ่ม QUFC binary ถ้ามีราคา
  if (qufcPrice?.usd > 0) {
    markets.push({
      id: 'binary-qufc-60',
      cat: 'binary',
      icon: '🥊',
      sym: 'QUFC',
      tier: 3,
      league: '🥊 Binary · QUFC/QUBIC',
      isLive: true,
      timeframe: '1 HOUR',
      minutes: 60,
      closeTime: new Date(Date.now() + 3600000).toISOString(),
      curPrice: qufcPrice.usd,
      chg24: qufcPrice.usd_24h_change,
      reward: '5,000 QUFC',
      rp: 20000,
      bp: 18000,
      source: 'Qubic RPC ✓',
    });
  }

  return markets;
}

// ══ MOCK DATA ══
function mockFootball() {
  return [
    { id:'s-m1', cat:'soccer', league:'Premier League', isLive:true,  elapsed:45, home:'Man United',   away:'Liverpool',   scoreHome:1, scoreAway:0, source:'Demo' },
    { id:'s-m2', cat:'soccer', league:'Premier League', isLive:false, elapsed:null, home:'Arsenal',     away:'Chelsea',     scoreHome:null, scoreAway:null, source:'Demo' },
    { id:'s-m3', cat:'soccer', league:'La Liga',        isLive:false, elapsed:null, home:'Barcelona',   away:'Real Madrid', scoreHome:null, scoreAway:null, source:'Demo' },
    { id:'s-m4', cat:'soccer', league:'Bundesliga',     isLive:false, elapsed:null, home:'Bayern',      away:'Dortmund',    scoreHome:null, scoreAway:null, source:'Demo' },
  ];
}
function mockBasketball() {
  return [
    { id:'b-m1', cat:'basketball', league:'NBA', isLive:true,  home:'LA Lakers',   away:'Boston Celtics', scoreHome:98, scoreAway:94, quarter:'Q3', source:'Demo' },
    { id:'b-m2', cat:'basketball', league:'NBA', isLive:false, home:'Golden State', away:'Miami Heat',     scoreHome:null, scoreAway:null, source:'Demo' },
  ];
}
function mockMMA() {
  return [
    { id:'mma-m1', cat:'mma', league:'ONE Championship', isLive:true,  home:'Rodtang', away:'Demetrious J.', source:'Demo' },
    { id:'mma-m2', cat:'mma', league:'UFC',              isLive:false, home:'McGregor', away:'Poirier',       source:'Demo' },
  ];
}

// ══ ODDS BUILDER ══
function buildOdds(home, away, cat) {
  if (cat === 'soccer') return {
    '1X2':     { h:{l:home,o:+(1.5+Math.random()*1.5).toFixed(2)}, d:{l:'Draw',o:+(3.0+Math.random()).toFixed(2)}, a:{l:away,o:+(1.8+Math.random()*2).toFixed(2)} },
    'Handicap':{ h:{l:home,hc:'-0.5',o:+(1.82+Math.random()*.2).toFixed(2)}, a:{l:away,hc:'+0.5',o:+(1.82+Math.random()*.2).toFixed(2)} },
    'Over/Under':{ ov:{l:'Over 2.5',o:+(1.75+Math.random()*.3).toFixed(2)}, un:{l:'Under 2.5',o:+(1.90+Math.random()*.3).toFixed(2)} },
  };
  if (cat === 'basketball') return {
    'Handicap':  { h:{l:home,hc:'-5.5',o:1.85}, a:{l:away,hc:'+5.5',o:1.85} },
    'Moneyline': { h:{l:home+' Win',o:+(1.5+Math.random()*1.2).toFixed(2)}, a:{l:away+' Win',o:+(1.8+Math.random()*1.5).toFixed(2)} },
  };
  if (cat === 'mma') return {
    'Winner': { h:{l:home+' Win',o:+(1.4+Math.random()*2).toFixed(2)}, a:{l:away+' Win',o:+(1.6+Math.random()*2.5).toFixed(2)} },
    'Method': { ko:{l:'KO/TKO',o:2.10}, sub:{l:'Submission',o:4.50}, dec:{l:'Decision',o:2.80} },
  };
  return {};
}

// ══ ROUTES ══

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    project: 'QUFC ARENA',
    apis: {
      coingecko:  true,
      apiSports:  !!API_SPORTS_KEY,
      oddsApi:    !!ODDS_API_KEY,
      qubicRpc:   true,
    },
  });
});

app.get('/api/prices', async (req, res) => {
  try {
    const [prices, qufc] = await Promise.all([getPrices(), getQUFCPrice()]);
    res.json({ ok: true, data: { ...prices, qufc: { usd: qufc.usd, usd_24h_change: qufc.usd_24h_change } } });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/matches', async (req, res) => {
  try {
    const [football, basketball, mma, prices, qufc] = await Promise.all([
      getFootball(), getBasketball(), getMMA(), getPrices(), getQUFCPrice(),
    ]);

    const withOdds = (arr, cat) => arr.map(m => ({
      ...m,
      markets: buildOdds(m.home, m.away, cat),
      pool: { r: 50000 + Math.floor(Math.random()*200000), b: 40000 + Math.floor(Math.random()*180000) },
    }));

    // Crypto prediction markets
    const cryptoCoins = ['bitcoin','ethereum','solana','qubic-network'];
    const crypto = cryptoCoins.map(id => {
      const d = prices[id]; if (!d) return null;
      const symMap = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', 'qubic-network':'QUBIC' };
      const iconMap = { bitcoin:'₿', ethereum:'Ξ', solana:'◎', 'qubic-network':'⚡' };
      return {
        id: `c-${id}`, cat: 'crypto',
        league: '📈 Crypto Prediction',
        icon: iconMap[id], sym: symMap[id],
        isLive: true, time: '1 hour',
        curPrice: d.usd, chg24: d.usd_24h_change,
        source: 'CoinGecko ✓',
        pool: { r: 40000, b: 32000 },
        markets: { 'Price Prediction': {
          up: { l:`📈 Higher`, o: +(1.80 + Math.random()*.2).toFixed(2) },
          dn: { l:`📉 Lower`,  o: +(1.80 + Math.random()*.2).toFixed(2) },
        }},
      };
    }).filter(Boolean);

    // Binary markets
    const binary = buildBinaryMarkets(prices, qufc);

    // Esport
    const esport = [
      { id:'es-1', cat:'esport', league:'🎮 LoL Worlds', isLive:true,  home:'T1', away:'G2 Esports', source:'Demo',
        markets:{ 'Winner':{ h:{l:'T1 Win',o:1.55}, a:{l:'G2 Win',o:2.50} } }, pool:{r:160000,b:95000} },
      { id:'es-2', cat:'esport', league:'🎮 CS2 Major',  isLive:false, home:'NaVi', away:'Liquid', source:'Demo',
        markets:{ 'Winner':{ h:{l:'NaVi Win',o:1.60}, a:{l:'Liquid Win',o:2.30} } }, pool:{r:80000,b:70000} },
    ];

    res.json({
      ok: true,
      matches: {
        soccer:     withOdds(football, 'soccer'),
        basketball: withOdds(basketball, 'basketball'),
        mma:        withOdds(mma, 'mma'),
        crypto,
        binary,
        esport,
      },
      counts: {
        soccer: football.length, basketball: basketball.length,
        mma: mma.length, crypto: crypto.length,
        binary: binary.length, esport: esport.length,
      },
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// BET STORE
const BETS = [];
const BALANCES = {};

app.post('/api/bet', (req, res) => {
  const { wallet, matchId, selection, odd, stake } = req.body;
  if (!wallet || !stake || stake < 100)
    return res.status(400).json({ ok: false, error: 'Invalid bet' });
  BETS.push({ id:`bet-${Date.now()}`, wallet, matchId, selection, odd, stake, status:'pending', at: new Date().toISOString() });
  BALANCES[wallet] = (BALANCES[wallet] || 50000) - stake;
  res.json({ ok: true, balance: BALANCES[wallet] });
});

app.get('/api/balance/:wallet', (req, res) => {
  res.json({ ok: true, balance: BALANCES[req.params.wallet] || 50000 });
});

app.listen(PORT, async () => {
  console.log(`\n🥊 QUFC ARENA`);
  console.log(`✅ http://localhost:${PORT}`);
  console.log(`🔑 API-Sports: ${API_SPORTS_KEY ? 'OK' : 'Missing'}`);
  console.log(`🔑 Odds API:   ${ODDS_API_KEY   ? 'OK' : 'Missing'}`);
  console.log(`⚡ Qubic RPC:  OK\n`);
});
