require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ===== CONFIG =====
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;

// ===== CACHE =====
const CACHE = {};
const isFresh = (key, ttl) =>
  CACHE[key] && Date.now() - CACHE[key].at < ttl;

// ===== PRICES =====
async function getPrices() {
  if (isFresh('prices', 60000)) return CACHE.prices.data;

  try {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin,qubic-network&vs_currencies=usd&include_24hr_change=true';

    const r = await fetch(url);
    const data = await r.json();

    CACHE.prices = { data, at: Date.now() };
    return data;
  } catch (e) {
    console.error("Price error:", e.message);
    return CACHE.prices?.data || {};
  }
}

// ===== QUFC =====
async function getQUFCPrice() {
  if (isFresh('qufc', 60000)) return CACHE.qufc.data;

  try {
    const r = await fetch('https://rpc.qubic.org/v1/assets/QUFC/issuances');
    const d = await r.json();

    const price = d?.issuances?.[0]?.price || 0.0000001;

    const data = {
      usd: price,
      usd_24h_change: 0
    };

    CACHE.qufc = { data, at: Date.now() };
    return data;
  } catch {
    return { usd: 0.0000001, usd_24h_change: 0 };
  }
}

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.get('/api/prices', async (req, res) => {
  try {
    const [prices, qufc] = await Promise.all([
      getPrices(),
      getQUFCPrice()
    ]);

    res.json({
      ok: true,
      data: {
        ...prices,
        qufc
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    project: 'QUFC ARENA',
    status: 'running',
    apiSports: !!API_SPORTS_KEY
  });
});

// ===== START =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🥊 QUFC ARENA RUNNING`);
  console.log(`🌐 http://localhost:${PORT}`);
});
