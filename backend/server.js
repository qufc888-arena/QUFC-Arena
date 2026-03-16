require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    project: 'QUFC ARENA',
    apis: {
      coingecko: true,
      apiSports: !!process.env.API_SPORTS_KEY,
      oddsApi: !!process.env.ODDS_API_KEY,
    }
  });
});

app.get('/api/prices', async (req, res) => {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin&vs_currencies=usd&include_24hr_change=true');
    const data = await r.json();
    res.json({ ok: true, data });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/matches', async (req, res) => {
  res.json({
    ok: true,
    matches: { soccer: [], basketball: [], mma: [], crypto: [], esport: [] },
    message: 'Server running! Full data coming soon.'
  });
});

app.listen(PORT, () => {
  console.log('QUFC ARENA running at http://localhost:' + PORT);
  console.log('API-Sports:', process.env.API_SPORTS_KEY ? 'OK' : 'Missing');
  console.log('Odds API:', process.env.ODDS_API_KEY ? 'OK' : 'Missing');
});
