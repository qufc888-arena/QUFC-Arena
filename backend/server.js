require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));

// ── API KEYS ─────────────────────────────────────────────
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const ODDS_API_KEY   = process.env.ODDS_API_KEY;

// ── CACHE ────────────────────────────────────────────────
const CACHE = {
  prices:     { data: null, at: 0, ttl: 60000   },
  football:   { data: null, at: 0, ttl: 300000  },
  basketball: { data: null, at: 0, ttl: 300000  },
  mma:        { data: null, at: 0, ttl: 600000  },
  odds:       { data: null, at: 0, ttl: 120000  },
};
const fresh = k => CACHE[k].data && Date.now()-CACHE[k].at < CACHE[k].ttl;

// ── BET STORE (in-memory Phase 1) ───────────────────────
const BETS     = [];
const BALANCES = {};
const POOLS    = {};

// ════════════════════════════════════════════════════════
// COINGECKO — ราคาเหรียญจริง (ฟรี ไม่ต้อง key)
// ════════════════════════════════════════════════════════
async function getPrices() {
  if (fresh('prices')) return CACHE.prices.data;
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin,cardano&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await r.json();
    CACHE.prices = { data, at: Date.now(), ttl: 60000 };
    return data;
  } catch(e) {
    console.error('CoinGecko:', e.message);
    return CACHE.prices.data || {};
  }
}

// ════════════════════════════════════════════════════════
// API-SPORTS — Football
// ════════════════════════════════════════════════════════
async function getFootball() {
  if (fresh('football')) return CACHE.football.data;
  if (!API_SPORTS_KEY) return mockFootball();
  try {
    const today = new Date().toISOString().split('T')[0];
    const [live, upcoming] = await Promise.all([
      fetch('https://v3.football.api-sports.io/fixtures?live=all',
        { headers: { 'x-apisports-key': API_SPORTS_KEY } }).then(r=>r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures?date=${today}&league=39,140,78,135,61&season=2024`,
        { headers: { 'x-apisports-key': API_SPORTS_KEY } }).then(r=>r.json()),
    ]);
    const all = [
      ...(live.response||[]).map(f=>({...f,isLive:true})),
      ...(upcoming.response||[]).filter(f=>f.fixture.status.short==='NS').map(f=>({...f,isLive:false})),
    ].slice(0,12);
    const matches = all.map(f => ({
      id:        `s-${f.fixture.id}`,
      cat:       'soccer',
      league:    f.league.name,
      country:   f.league.country,
      isLive:    f.isLive,
      status:    f.fixture.status.short,
      elapsed:   f.fixture.status.elapsed,
      date:      f.fixture.date,
      home:      f.teams.home.name,
      homeLogo:  f.teams.home.logo,
      away:      f.teams.away.name,
      awayLogo:  f.teams.away.logo,
      scoreHome: f.goals.home,
      scoreAway: f.goals.away,
      source:    'API-Sports ✓',
    }));
    CACHE.football = { data: matches, at: Date.now(), ttl: 300000 };
    return matches;
  } catch(e) {
    console.error('Football API:', e.message);
    return mockFootball();
  }
}

// ════════════════════════════════════════════════════════
// API-SPORTS — Basketball (NBA)
// ════════════════════════════════════════════════════════
async function getBasketball() {
  if (fresh('basketball')) return CACHE.basketball.data;
  if (!API_SPORTS_KEY) return mockBasketball();
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(
      `https://v1.basketball.api-sports.io/games?date=${today}&league=12&season=2024-2025`,
      { headers: { 'x-apisports-key': API_SPORTS_KEY } }
    );
    const d = await r.json();
    const matches = (d.response||[]).slice(0,6).map(g => ({
      id:        `b-${g.id}`,
      cat:       'basketball',
      league:    g.league.name,
      isLive:    g.status.short === 'LIVE',
      status:    g.status.short,
      date:      g.date,
      home:      g.teams.home.name,
      away:      g.teams.visitors.name,
      scoreHome: g.scores.home.total,
      scoreAway: g.scores.visitors.total,
      quarter:   g.status.short==='LIVE'?`Q${g.periods.current}`:null,
      source:    'API-Sports ✓',
    }));
    CACHE.basketball = { data: matches, at: Date.now(), ttl: 300000 };
    return matches;
  } catch(e) {
    console.error('Basketball API:', e.message);
    return mockBasketball();
  }
}

// ════════════════════════════════════════════════════════
// API-SPORTS — MMA
// ════════════════════════════════════════════════════════
async function getMMA() {
  if (fresh('mma')) return CACHE.mma.data;
  if (!API_SPORTS_KEY) return mockMMA();
  try {
    const r = await fetch(
      'https://v1.mma.api-sports.io/fights?next=10',
      { headers: { 'x-apisports-key': API_SPORTS_KEY } }
    );
    const d = await r.json();
    const fights = (d.response||[]).slice(0,5).map(f => ({
      id:          `mma-${f.id}`,
      cat:         'mma',
      league:      f.league?.name || 'MMA',
      isLive:      false,
      date:        f.date,
      home:        f.fighters?.first?.name  || 'Fighter 1',
      away:        f.fighters?.second?.name || 'Fighter 2',
      weightClass: f.weightClass || 'Middleweight',
      source:      'API-Sports ✓',
    }));
    CACHE.mma = { data: fights, at: Date.now(), ttl: 600000 };
    return fights;
  } catch(e) {
    console.error('MMA API:', e.message);
    return mockMMA();
  }
}

// ════════════════════════════════════════════════════════
// THE ODDS API — Live odds จาก bookmaker
// ════════════════════════════════════════════════════════
async function getOdds(sport='soccer_epl') {
  if (fresh('odds')) return CACHE.odds.data;
  if (!ODDS_API_KEY) return null;
  try {
    const r = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,spreads,totals&oddsFormat=decimal`
    );
    const data = await r.json();
    const odds = {};
    (data||[]).forEach(game => {
      const key = `${game.home_team}__${game.away_team}`;
      odds[key] = {};
      (game.bookmakers||[]).forEach(bm => {
        (bm.markets||[]).forEach(mkt => {
          if (!odds[key][mkt.key]) odds[key][mkt.key] = {};
          (mkt.outcomes||[]).forEach(o => {
            odds[key][mkt.key][o.name] = o.price;
            if (o.point !== undefined) odds[key][mkt.key][o.name+'_point'] = o.point;
          });
        });
      });
    });
    CACHE.odds = { data: odds, at: Date.now(), ttl: 120000 };
    return odds;
  } catch(e) {
    console.error('Odds API:', e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════
// ODDS BUILDER — Parimutuel style
// ════════════════════════════════════════════════════════
function buildMarkets(home, away, cat, liveOdds) {
  const key = `${home}__${away}`;
  const real = liveOdds?.[key];

  if (cat === 'soccer') {
    return {
      '1X2': {
        h: { l: home.split(' ').slice(-1)[0], o: real?.h2h?.[home] || +(1.5+Math.random()*1.5).toFixed(2) },
        d: { l: 'Draw',                        o: real?.h2h?.Draw   || +(3.0+Math.random()*1.5).toFixed(2) },
        a: { l: away.split(' ').slice(-1)[0], o: real?.h2h?.[away] || +(1.8+Math.random()*2.0).toFixed(2) },
      },
      'Handicap': {
        h: { l: home.split(' ').slice(-1)[0], hc:'-0.5', o: +(1.82+Math.random()*.2).toFixed(2) },
        a: { l: away.split(' ').slice(-1)[0], hc:'+0.5', o: +(1.82+Math.random()*.2).toFixed(2) },
      },
      'Over/Under': {
        ov: { l:'Over 2.5',  o: +(1.75+Math.random()*.3).toFixed(2) },
        un: { l:'Under 2.5', o: +(1.90+Math.random()*.3).toFixed(2) },
      },
    };
  }
  if (cat === 'basketball') {
    const sp = (Math.floor(Math.random()*10)+2)+'.5';
    return {
      'Handicap':  { h:{l:home.split(' ').slice(-1)[0],hc:`-${sp}`,o:+(1.85+Math.random()*.15).toFixed(2)}, a:{l:away.split(' ').slice(-1)[0],hc:`+${sp}`,o:+(1.85+Math.random()*.15).toFixed(2)} },
      'Over/Under':{ ov:{l:`Over ${200+~~(Math.random()*25)}.5`,o:+(1.85+Math.random()*.15).toFixed(2)}, un:{l:`Under ${200+~~(Math.random()*25)}.5`,o:+(1.85+Math.random()*.15).toFixed(2)} },
      'Moneyline': { h:{l:home.split(' ').slice(-1)[0]+' Win',o:+(1.5+Math.random()*1.2).toFixed(2)}, a:{l:away.split(' ').slice(-1)[0]+' Win',o:+(1.8+Math.random()*1.5).toFixed(2)} },
    };
  }
  if (cat === 'mma') {
    return {
      'Winner': { h:{l:home.split(' ').slice(-1)[0]+' Win',o:+(1.4+Math.random()*2).toFixed(2)}, a:{l:away.split(' ').slice(-1)[0]+' Win',o:+(1.6+Math.random()*2.5).toFixed(2)} },
      'Method':  { ko:{l:'KO/TKO',o:+(2.0+Math.random()*1.5).toFixed(2)}, sub:{l:'Submission',o:+(3.5+Math.random()*2).toFixed(2)}, dec:{l:'Decision',o:+(2.5+Math.random()*1.5).toFixed(2)} },
    };
  }
  return {};
}

// ════════════════════════════════════════════════════════
// MOCK FALLBACKS (ถ้าไม่มี API key)
// ════════════════════════════════════════════════════════
function mockFootball() {
  return [
    {id:'s-m1',cat:'soccer',league:'Premier League',isLive:true, status:'1H',elapsed:34,home:'Manchester Utd',away:'Liverpool',    scoreHome:1,scoreAway:0,source:'Demo'},
    {id:'s-m2',cat:'soccer',league:'Premier League',isLive:false,status:'NS',elapsed:null,home:'Arsenal',       away:'Chelsea',      scoreHome:null,scoreAway:null,source:'Demo'},
    {id:'s-m3',cat:'soccer',league:'La Liga',        isLive:false,status:'NS',elapsed:null,home:'Barcelona',    away:'Real Madrid',  scoreHome:null,scoreAway:null,source:'Demo'},
    {id:'s-m4',cat:'soccer',league:'Bundesliga',     isLive:false,status:'NS',elapsed:null,home:'Bayern Munich',away:'Dortmund',     scoreHome:null,scoreAway:null,source:'Demo'},
    {id:'s-m5',cat:'soccer',league:'La Liga',        isLive:false,status:'NS',elapsed:null,home:'Atletico',     away:'Sevilla',      scoreHome:null,scoreAway:null,source:'Demo'},
  ];
}
function mockBasketball() {
  return [
    {id:'b-m1',cat:'basketball',league:'NBA',isLive:true, status:'LIVE',home:'LA Lakers',    away:'Boston Celtics',scoreHome:98,scoreAway:94,quarter:'Q3',source:'Demo'},
    {id:'b-m2',cat:'basketball',league:'NBA',isLive:false,status:'NS',  home:'Golden State', away:'Miami Heat',    scoreHome:null,scoreAway:null,source:'Demo'},
    {id:'b-m3',cat:'basketball',league:'NBA',isLive:false,status:'NS',  home:'Chicago Bulls',away:'Brooklyn Nets', scoreHome:null,scoreAway:null,source:'Demo'},
  ];
}
function mockMMA() {
  return [
    {id:'mma-m1',cat:'mma',league:'ONE Championship',isLive:true, home:'Rodtang Jitmuangnon',away:'Demetrious Johnson',weightClass:'Flyweight',    date:'2026-03-16',source:'Demo'},
    {id:'mma-m2',cat:'mma',league:'UFC',             isLive:false,home:'Conor McGregor',      away:'Dustin Poirier',   weightClass:'Lightweight',   date:'2026-04-12',source:'Demo'},
    {id:'mma-m3',cat:'mma',league:'Muay Thai',       isLive:false,home:'Buakaw Banchamek',    away:'Anderson Silva',   weightClass:'Super Welter',  date:'2026-04-19',source:'Demo'},
  ];
}
function mockEsport() {
  return [
    {id:'es-1',cat:'esport',league:'LoL Worlds',isLive:true, home:'T1',          away:'G2 Esports',  score:'1-0',time:'Map 2',source:'Demo'},
    {id:'es-2',cat:'esport',league:'CS2 Major', isLive:false,home:'NaVi',         away:'Team Liquid', score:'',   time:'20:00',source:'Demo'},
    {id:'es-3',cat:'esport',league:'Dota 2 TI', isLive:false,home:'Team Spirit',  away:'OG',          score:'',   time:'22:00',source:'Demo'},
  ];
}

// ════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    project: 'QUFC ARENA',
    apis: {
      coingecko:  true,
      apiSports:  !!API_SPORTS_KEY,
      oddsApi:    !!ODDS_API_KEY,
    },
    cache: {
      prices:     fresh('prices'),
      football:   fresh('football'),
      basketball: fresh('basketball'),
      mma:        fresh('mma'),
      odds:       fresh('odds'),
    },
    uptime: process.uptime(),
    bets:   BETS.length,
  });
});

// ราคาเหรียญ
app.get('/api/prices', async (req, res) => {
  try {
    const data = await getPrices();
    res.json({ ok:true, data, source:'CoinGecko', updatedAt: new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// แมตช์ทุกกีฬา
app.get('/api/matches', async (req, res) => {
  try {
    const { sport } = req.query;
    const load = s => !sport || sport==='all' || sport===s;

    const [football, basketball, mma, prices, odds] = await Promise.all([
      load('soccer')     ? getFootball()   : [],
      load('basketball') ? getBasketball() : [],
      load('mma')        ? getMMA()        : [],
      getPrices(),
      getOdds(),
    ]);

    // ใส่ markets ให้แต่ละแมตช์
    const withMkt = (arr, cat) => arr.map(m => ({
      ...m,
      markets: buildMarkets(m.home, m.away, cat, odds),
      pool: POOLS[m.id] || { r: 50000+~~(Math.random()*200000), b: 40000+~~(Math.random()*180000) },
    }));

    // Crypto prediction markets
    const coinIds = { bitcoin:'BTC₿', ethereum:'ETHΞ', solana:'SOL◎' };
    const crypto = Object.entries(coinIds).map(([id,sym]) => {
      const d = prices[id]; if (!d) return null;
      const s = sym.slice(0,-1); const i = sym.slice(-1);
      const u = d.usd_24h_change >= 0;
      return {
        id: `c-${id}`, cat: 'crypto', league: '📈 Crypto Prediction',
        isLive: true, time: '1 hour', icon: i, sym: s,
        home: `${s} Higher`, away: `${s} Lower`,
        curPrice: d.usd, chg24: d.usd_24h_change,
        source: 'CoinGecko ✓',
        markets: { 'Price Prediction': {
          up: { l:`📈 Higher > $${d.usd>=1000?~~(d.usd*1.01):(d.usd*1.01).toFixed(4)}`, o:+(1.80+(u?-.05:.05)+(~~(Math.random()*15))/100).toFixed(2) },
          dn: { l:`📉 Lower < $${d.usd>=1000?~~(d.usd*.99):(d.usd*.99).toFixed(4)}`,   o:+(1.80+(u?.05:-.05)+(~~(Math.random()*15))/100).toFixed(2) },
        }},
        pool: POOLS[`c-${id}`] || { r: 40000+~~(Math.random()*30000), b: 32000+~~(Math.random()*25000) },
      };
    }).filter(Boolean);

    // Esport (static for now)
    const esport = withMkt(mockEsport(), 'esport');

    res.json({
      ok: true,
      matches: {
        soccer:     withMkt(football,   'soccer'),
        basketball: withMkt(basketball, 'basketball'),
        mma:        withMkt(mma,        'mma'),
        crypto,
        esport,
      },
      counts: {
        soccer:     football.length,
        basketball: basketball.length,
        mma:        mma.length,
        crypto:     crypto.length,
        esport:     esport.length,
        total:      football.length+basketball.length+mma.length+crypto.length+esport.length,
      },
      sources: {
        soccer:     API_SPORTS_KEY ? 'API-Sports ✓' : 'Demo',
        basketball: API_SPORTS_KEY ? 'API-Sports ✓' : 'Demo',
        mma:        API_SPORTS_KEY ? 'API-Sports ✓' : 'Demo',
        odds:       ODDS_API_KEY   ? 'The Odds API ✓' : 'Generated',
        crypto:     'CoinGecko ✓',
        esport:     'Demo',
      },
    });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// วางเดิมพัน
app.post('/api/bet', (req, res) => {
  try {
    const { wallet, matchId, market, selection, odd, stake } = req.body;
    if (!wallet || !matchId || !odd || !stake)
      return res.status(400).json({ ok:false, error:'Missing fields' });
    if (stake < 100)
      return res.status(400).json({ ok:false, error:'Min stake 100 QUFC' });

    const bet = {
      id:        `bet-${Date.now()}`,
      wallet, matchId, market, selection,
      odd:       parseFloat(odd),
      stake:     parseInt(stake),
      payout:    Math.round(parseInt(stake)*parseFloat(odd)),
      status:    'pending',
      placedAt:  new Date().toISOString(),
    };
    BETS.push(bet);
    BALANCES[wallet] = (BALANCES[wallet] || 50000) - parseInt(stake);

    // อัปเดต pool
    if (!POOLS[matchId]) POOLS[matchId] = { r:50000, b:50000 };
    POOLS[matchId].r += parseInt(stake);

    res.json({ ok:true, bet, balance: BALANCES[wallet] });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ประวัติเดิมพัน
app.get('/api/bets/:wallet', (req, res) => {
  const bets = BETS.filter(b => b.wallet === req.params.wallet);
  res.json({ ok:true, bets, total: bets.length });
});

// ยอด balance
app.get('/api/balance/:wallet', (req, res) => {
  res.json({ ok:true, balance: BALANCES[req.params.wallet] || 50000 });
});

// ════════════════════════════════════════════════════════
// CRON — Refresh ข้อมูลอัตโนมัติ
// ════════════════════════════════════════════════════════
cron.schedule('*/1 * * * *',  () => getPrices().catch(()=>{}));
cron.schedule('*/5 * * * *',  () => getFootball().catch(()=>{}));
cron.schedule('*/10 * * * *', () => { getMMA().catch(()=>{}); getOdds().catch(()=>{}); });

// ════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log('\n🥊  QUFC ARENA Backend');
  console.log(`✅  Running  : http://localhost:${PORT}`);
  console.log(`📊  Status   : http://localhost:${PORT}/api/status`);
  console.log(`💰  Prices   : http://localhost:${PORT}/api/prices`);
  console.log(`⚽  Matches  : http://localhost:${PORT}/api/matches`);
  console.log('\n🔑  API Keys:');
  console.log(`  CoinGecko  : ✅ Free`);
  console.log(`  API-Sports : ${API_SPORTS_KEY ? '✅ OK' : '❌ Missing'}`);
  console.log(`  Odds API   : ${ODDS_API_KEY   ? '✅ OK' : '❌ Missing'}\n`);
  await Promise.all([getPrices(), getFootball()]).catch(()=>{});
  console.log('✅  Initial data loaded\n');
});
