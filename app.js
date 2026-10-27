// ============================================================================
// AUTONOMOUS AI STOCK TRADING AGENT (100 EUR PAPER & LIVE ENGINE)
// V3: Deep Ticker Memory + ATR Dynamic Risk + Historical Backtest Trainer
// ============================================================================

const MARKET_PACKS = {
    tech: [
        "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "TSM",
        "PLTR", "ARM", "SMCI", "MU", "INTC", "QCOM", "ASML", "ORCL", "CRM", "ADBE"
    ],
    movers: [
        "COIN", "MSTR", "HOOD", "SOFI", "XYZ", "PYPL", "SHOP", "UBER", "ABNB", "NFLX",
        "SPOT", "RBLX", "DKNG", "RIVN", "LCID", "NIO", "BABA", "PDD", "JD", "SNOW"
    ],
    sp500: [
        "JPM", "BAC", "GS", "V", "MA", "LLY", "NVO", "UNH", "JNJ", "PFE",
        "XOM", "CVX", "LMT", "RTX", "BA", "CAT", "GE", "WMT", "COST", "KO"
    ],
    etf: [
        "SPY", "QQQ", "IWM", "SMH", "XLF", "XLE", "GLD", "TLT"
    ],
    crypto: [
        "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD",
        "DOGE-USD", "ADA-USD", "AVAX-USD", "LINK-USD", "DOT-USD"
    ]
};

const DEFAULT_STATE = {
    version: 3,
    agentActive: true,
    includeCrypto: false,
    packs: {
        tech: true,
        movers: true,
        sp500: true,
        etf: false
    },
    selectedSymbol: "NVDA",
    fxRateEurUsd: 1.08,
    portfolio: {
        initialCapitalEur: 100.00,
        cashEur: 100.00,
        positions: [],
        closedTrades: []
    },
    learning: {
        generation: 1,
        totalTrainedTrades: 0,
        minScoreThreshold: 28,
        stopLossPct: 1.8,
        takeProfitPct: 3.2,
        slAtrMultiplier: 2.4,
        tpAtrMultiplier: 4.5,
        trailingTriggerPct: 1.2,
        trailingDistancePct: 0.8,
        weights: {
            rsi: 22,       // % weight
            trend: 26,     // % weight (EMA9/21 + VWAP)
            macd: 20,      // % weight
            volume: 14,    // % weight
            sentiment: 18  // % weight (Live News & Analyst sentiment)
        },
        tickerMemory: {}, // symbol -> { trades, wins, losses, totalPnlPct, avgPnlPct, winRate, reputationBonus, bestFactor, factorScores: {rsi,trend,macd,volume} }
        lessons: [
            {
                time: new Date().toLocaleTimeString("sk-SK"),
                gen: 1,
                text: "Inicializácia neurónových váh (Gen #1): Vyvážená kombinácia technickej analýzy, ATR volatility a pamäte titulov."
            }
        ]
    },
    settings: {
        executionMode: "simulator",
        marketHoursMode: "extended",
        maxPosEur: 25.00,
        maxPositions: 4,
        watchlist: "NVDA,AAPL,TSLA,MSFT,AMD,META,AMZN,GOOGL,PLTR,COIN",
        brokerKey: "",
        brokerSecret: ""
    }
};

let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let marketCache = {};     // symbol -> chart & indicator data
let newsCache = [];       // list of analyzed news items
let tickerSentiment = {}; // symbol -> { score: -100..100, count, latestHeadline }
let scanTimer = null;
let newsTimer = null;
let isScanning = false;
let isTrainingHistory = false;

// NLP Financial Sentiment Lexicon
const BULLISH_WORDS = [
    { w: "beat", s: 25 }, { w: "beats", s: 25 }, { w: "surge", s: 30 }, { w: "surges", s: 30 },
    { w: "soar", s: 30 }, { w: "soars", s: 30 }, { w: "jump", s: 22 }, { w: "jumps", s: 22 },
    { w: "rally", s: 25 }, { w: "rallies", s: 25 }, { w: "upgrade", s: 32 }, { w: "upgraded", s: 32 },
    { w: "buy", s: 18 }, { w: "outperform", s: 28 }, { w: "strong", s: 18 }, { w: "record", s: 24 },
    { w: "bull", s: 20 }, { w: "bullish", s: 25 }, { w: "growth", s: 16 }, { w: "profit", s: 18 },
    { w: "partnership", s: 24 }, { w: "investment", s: 20 }, { w: "deal", s: 20 }, { w: "breakout", s: 28 },
    { w: "raises", s: 25 }, { w: "raised", s: 25 }, { w: "higher", s: 15 }, { w: "gain", s: 16 },
    { w: "gains", s: 16 }, { w: "boom", s: 24 }, { w: "top", s: 12 }, { w: "win", s: 18 }, { w: "wins", s: 18 }
];

const BEARISH_WORDS = [
    { w: "miss", s: -28 }, { w: "misses", s: -28 }, { w: "plunge", s: -32 }, { w: "plunges", s: -32 },
    { w: "drop", s: -22 }, { w: "drops", s: -22 }, { w: "fall", s: -20 }, { w: "falls", s: -20 },
    { w: "crash", s: -35 }, { w: "downgrade", s: -32 }, { w: "downgraded", s: -32 }, { w: "sell", s: -20 },
    { w: "underperform", s: -28 }, { w: "weak", s: -20 }, { w: "loss", s: -22 }, { w: "losses", s: -22 },
    { w: "bear", s: -20 }, { w: "bearish", s: -25 }, { w: "lawsuit", s: -30 }, { w: "probe", s: -28 },
    { w: "investigation", s: -28 }, { w: "cut", s: -20 }, { w: "cuts", s: -20 }, { w: "slump", s: -26 },
    { w: "warning", s: -26 }, { w: "warns", s: -26 }, { w: "decline", s: -20 }, { w: "declines", s: -20 },
    { w: "layoff", s: -18 }, { w: "layoffs", s: -18 }, { w: "risk", s: -14 }, { w: "down", s: -14 },
    { w: "bubble", s: -22 }, { w: "tariff", s: -20 }, { w: "tariffs", s: -20 }
];

// ============================================================================
// INITIALIZATION & PERSISTENCE
// ============================================================================

window.addEventListener("DOMContentLoaded", async () => {
    addLog("Systém sa štartuje... Načítavam uloženú pamäť agenta a portfólio.", "info");
    await loadStateFromServer();
    syncUiFromState();

    await fetchAllNews();
    await runMarketCycle();

    // Auto-run 5-day historical training if agent hasn't been trained on history yet
    if (!state.learning.totalTrainedTrades || state.learning.totalTrainedTrades < 10) {
        await runHistoricalTraining(true);
    }

    scanTimer = setInterval(() => {
        if (state.agentActive && !isTrainingHistory) {
            runMarketCycle();
        } else {
            updateMarketSessionHeader();
        }
    }, 15000);

    newsTimer = setInterval(() => {
        fetchAllNews();
    }, 90000);

    window.addEventListener("resize", () => renderSelectedChart());
});

async function loadStateFromServer() {
    try {
        const res = await fetch("/api/state");
        const data = await res.json();
        if (data && data.version) {
            state = Object.assign({}, DEFAULT_STATE, data);
            state.packs = Object.assign({}, DEFAULT_STATE.packs, data.packs);
            state.portfolio = Object.assign({}, DEFAULT_STATE.portfolio, data.portfolio);
            state.learning = Object.assign({}, DEFAULT_STATE.learning, data.learning);
            state.learning.weights = Object.assign({}, DEFAULT_STATE.learning.weights, data.learning?.weights);
            state.learning.tickerMemory = Object.assign({}, data.learning?.tickerMemory || {});
            state.settings = Object.assign({}, DEFAULT_STATE.settings, data.settings);
            addLog(`Pamäť načítaná: Hotovosť ${state.portfolio.cashEur.toFixed(2)} €, Gen #${state.learning.generation}, Natrénovaných obchodov: ${state.learning.totalTrainedTrades || 0}.`, "success");
        } else {
            await saveStateToServer();
        }
    } catch (e) {
        console.warn("Nepodarilo sa načítať stav zo servera, používam predvolený:", e);
    }
}

async function saveStateToServer() {
    try {
        await fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(state)
        });
    } catch (e) {
        console.warn("Uloženie stavu zlyhalo:", e);
    }
}

// ============================================================================
// MARKET HOURS & SESSION CHECK
// ============================================================================

function getMarketSessionInfo() {
    const now = new Date();
    const nyTimeStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const nyDate = new Date(nyTimeStr);
    const day = nyDate.getDay();
    const hours = nyDate.getHours();
    const mins = nyDate.getMinutes();
    const totalMins = hours * 60 + mins;

    const isWeekend = (day === 0 || day === 6);
    let session = "CLOSED";
    let label = "US Burza zatvorená";
    let canTradeStocks = false;
    let isNearCloseEod = false;

    if (!isWeekend) {
        if (totalMins >= 570 && totalMins < 960) {
            session = "REGULAR";
            label = "🟢 US Burza OTVORENÁ (Hlavné obchodovanie)";
            canTradeStocks = true;
            if (totalMins >= 954) isNearCloseEod = true;
        } else if (totalMins >= 240 && totalMins < 570) {
            session = "PREMARKET";
            const minsToOpen = 570 - totalMins;
            const h = Math.floor(minsToOpen / 60);
            const m = minsToOpen % 60;
            label = `🟡 Pre-Market (Hlavná burza otvorí o ${h}h ${m}m)`;
            canTradeStocks = (state.settings.marketHoursMode !== "strict_us");
        } else if (totalMins >= 960 && totalMins < 1200) {
            session = "AFTERHOURS";
            label = "🟡 After-Hours (Poobchodná fáza)";
            canTradeStocks = (state.settings.marketHoursMode !== "strict_us");
        } else {
            label = "⚪ Mimo obchodných hodín US burzy";
            canTradeStocks = (state.settings.marketHoursMode === "always");
        }
    } else {
        label = "⚪ Víkend – US akciová burza zatvorená";
        canTradeStocks = (state.settings.marketHoursMode === "always");
    }

    return {
        session,
        label,
        canTradeStocks,
        isNearCloseEod,
        nyTimeFormatted: nyDate.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })
    };
}

function updateMarketSessionHeader() {
    const info = getMarketSessionInfo();
    const el = document.getElementById("marketSessionStatus");
    if (el) {
        el.innerHTML = `${info.label} <span style="color:var(--text-muted)">(NY: ${info.nyTimeFormatted})</span>`;
    }
}

// ============================================================================
// TECHNICAL INDICATORS + ATR VOLATILITY ENGINE (5m Intraday Candles)
// ============================================================================

function computeEMA(values, period) {
    if (!values || values.length === 0) return [];
    const k = 2 / (period + 1);
    const ema = [values[0]];
    for (let i = 1; i < values.length; i++) {
        ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

function computeRSI(closes, period = 14) {
    if (!closes || closes.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function computeMACD(closes) {
    if (!closes || closes.length < 26) {
        return { macd: 0, signal: 0, hist: 0, prevHist: 0 };
    }
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
    const signalLine = computeEMA(macdLine, 9);
    const histLine = macdLine.map((m, i) => m - signalLine[i]);
    const len = histLine.length;
    return {
        macd: macdLine[len - 1],
        signal: signalLine[len - 1],
        hist: histLine[len - 1],
        prevHist: len > 1 ? histLine[len - 2] : 0
    };
}

function computeVWAP(candles) {
    if (!candles || candles.length === 0) return [];
    let cumPV = 0;
    let cumV = 0;
    return candles.map(c => {
        const typical = (c.h + c.l + c.c) / 3;
        const vol = c.v > 0 ? c.v : 1;
        cumPV += typical * vol;
        cumV += vol;
        return cumPV / cumV;
    });
}

// ATR (14) Volatility calculation for adaptive Stop-Loss and Take-Profit
function computeATR(candles, period = 14) {
    if (!candles || candles.length < 3) return { atr: 0, atrPct: 0.5 };
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].h;
        const l = candles[i].l;
        const pc = candles[i - 1].c;
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        trs.push(tr);
    }
    const slice = trs.slice(-period);
    const atr = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
    const lastPrice = candles[candles.length - 1].c || 1;
    const atrPct = (atr / lastPrice) * 100;
    return {
        atr,
        atrPct: Math.max(0.15, Math.min(3.0, atrPct))
    };
}

function evaluateTechnicalSlice(candles, symbol, changePct = 0, sentScore = 0) {
    const closes = candles.map(c => c.c);
    const price = closes[closes.length - 1] || 1;

    // 1. RSI (14)
    const rsi = computeRSI(closes, 14);
    let rsiScore = 0;
    if (rsi < 30) rsiScore = 80;
    else if (rsi < 38) rsiScore = 50;
    else if (rsi >= 50 && rsi <= 65) rsiScore = 35;
    else if (rsi > 76) rsiScore = -75;
    else if (rsi > 69) rsiScore = -40;
    else if (rsi < 45) rsiScore = -15;

    // 2. EMA 9 / EMA 21 & VWAP
    const ema9Arr = computeEMA(closes, 9);
    const ema21Arr = computeEMA(closes, 21);
    const vwapArr = computeVWAP(candles);

    const ema9 = ema9Arr.length ? ema9Arr[ema9Arr.length - 1] : price;
    const ema21 = ema21Arr.length ? ema21Arr[ema21Arr.length - 1] : price;
    const vwap = vwapArr.length ? vwapArr[vwapArr.length - 1] : price;

    let trendScore = 0;
    let trendLabel = "Neutrálny";
    if (price > ema9 && ema9 > ema21) {
        trendScore += 55;
        trendLabel = "Silný rast (EMA9>21)";
    } else if (price > ema21) {
        trendScore += 25;
        trendLabel = "Nad EMA21";
    } else if (price < ema9 && ema9 < ema21) {
        trendScore -= 55;
        trendLabel = "Klesajúci (EMA9<21)";
    } else {
        trendScore -= 20;
        trendLabel = "Pod EMA21";
    }

    if (price > vwap) trendScore += 25;
    else trendScore -= 20;
    trendScore = Math.max(-100, Math.min(100, trendScore));

    // 3. MACD Momentum
    const macdObj = computeMACD(closes);
    let macdScore = 0;
    let macdLabel = "Plochý";
    if (macdObj.hist > 0 && macdObj.hist > macdObj.prevHist) {
        macdScore = 75;
        macdLabel = "Býčí impulz ↗";
    } else if (macdObj.hist > 0) {
        macdScore = 30;
        macdLabel = "Kladný";
    } else if (macdObj.hist < 0 && macdObj.hist > macdObj.prevHist) {
        macdScore = 25;
        macdLabel = "Obrat nahor ⤴";
    } else if (macdObj.hist < 0 && macdObj.hist < macdObj.prevHist) {
        macdScore = -70;
        macdLabel = "Medvedí tlak ↘";
    } else {
        macdScore = -30;
        macdLabel = "Záporný";
    }

    // 4. Volume Surge Score
    let volumeScore = 0;
    if (candles.length >= 10) {
        const recentVols = candles.slice(-10).map(c => c.v);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const lastVol = candles[candles.length - 1].v || 0;
        const lastCandleBullish = candles[candles.length - 1].c >= candles[candles.length - 1].o;
        if (avgVol > 0) {
            const ratio = lastVol / avgVol;
            if (ratio > 1.5) volumeScore = lastCandleBullish ? 70 : -60;
            else if (ratio > 1.1) volumeScore = lastCandleBullish ? 35 : -25;
        }
    }
    if (changePct > 1.5) volumeScore = Math.min(100, volumeScore + 25);
    if (changePct < -1.5) volumeScore = Math.max(-100, volumeScore - 25);

    // 5. ATR Dynamic Stop-Loss and Take-Profit for this stock
    const atrObj = computeATR(candles, 14);
    const slMult = state.learning.slAtrMultiplier || 2.4;
    const tpMult = state.learning.tpAtrMultiplier || 4.5;
    const dynamicSlPct = Math.round(Math.max(0.8, Math.min(3.5, atrObj.atrPct * slMult)) * 100) / 100;
    const dynamicTpPct = Math.round(Math.max(1.5, Math.min(6.5, atrObj.atrPct * tpMult)) * 100) / 100;

    // 6. Per-Ticker Reputation Memory & Best Factor Boost
    const mem = (state.learning.tickerMemory && state.learning.tickerMemory[symbol]) || null;
    const w = { ...state.learning.weights };
    let reputationBonus = 0;

    if (mem && mem.trades >= 2) {
        reputationBonus = mem.reputationBonus || 0;
        // Boost the indicator that historically works best for this specific stock!
        if (mem.bestFactor && w[mem.bestFactor] !== undefined) {
            w[mem.bestFactor] += 10;
        }
    }

    const totalWeight = (w.rsi + w.trend + w.macd + w.volume + w.sentiment) || 100;
    const rawComposite = (
        (rsiScore * w.rsi) +
        (trendScore * w.trend) +
        (macdScore * w.macd) +
        (volumeScore * w.volume) +
        (sentScore * w.sentiment)
    ) / totalWeight;

    const finalScore = Math.round(Math.max(-100, Math.min(100, rawComposite + reputationBonus)));

    return {
        rsi: Math.round(rsi * 10) / 10,
        atrPct: Math.round(atrObj.atrPct * 100) / 100,
        dynamicSlPct,
        dynamicTpPct,
        ema9,
        ema21,
        vwap,
        ema9Arr,
        ema21Arr,
        vwapArr,
        trendLabel,
        macdLabel,
        reputationBonus,
        tickerMem: mem,
        factors: {
            rsi: Math.round(rsiScore),
            trend: Math.round(trendScore),
            macd: Math.round(macdScore),
            volume: Math.round(volumeScore),
            sentiment: Math.round(sentScore)
        },
        aiScore: finalScore
    };
}

function analyzeSymbolData(rawChart) {
    const candles = rawChart.candles || [];
    const sentObj = tickerSentiment[rawChart.symbol] || { score: 0, count: 0, latestHeadline: "" };
    const evalRes = evaluateTechnicalSlice(candles, rawChart.symbol, rawChart.changePct || 0, sentObj.score);

    let actionLabel = "ČAKAŤ";
    let actionClass = "badge-neutral";
    if (evalRes.aiScore >= state.learning.minScoreThreshold + 15) {
        actionLabel = "SILNÝ NÁKUP";
        actionClass = "badge-profit";
    } else if (evalRes.aiScore >= state.learning.minScoreThreshold) {
        actionLabel = "NÁKUP";
        actionClass = "badge-profit";
    } else if (evalRes.aiScore <= -25) {
        actionLabel = "PREDAJ / VYHNÚŤ SA";
        actionClass = "badge-loss";
    }

    return {
        ...rawChart,
        ...evalRes,
        sentimentScore: sentObj.score,
        sentimentCount: sentObj.count,
        latestHeadline: sentObj.latestHeadline,
        actionLabel,
        actionClass
    };
}

// ============================================================================
// WALK-FORWARD HISTORICAL TRAINING ENGINE (5 DAYS / ~18,000+ CANDLES)
// ============================================================================

async function runHistoricalTraining(isAutoStartup = false) {
    if (isTrainingHistory) return;
    isTrainingHistory = true;

    const btn = document.getElementById("btnTrainHistory");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ Trénujem AI na histórii...";
    }

    try {
        const watchlist = getActiveWatchlist();
        addLog(`🏋️ Spúšťam hĺbkový tréning AI na 5-dňovej histórii pre ${watchlist.length} akcií (sťahujem 5m sviečky)...`, "info");

        const res = await fetch(`/api/market?symbols=${encodeURIComponent(watchlist.join(","))}&range=5d&maxCandles=320`);
        const payload = await res.json();

        if (!payload || !payload.ok || !payload.data) {
            addLog("⚠️ Tréning na histórii sa nepodarilo dokončiť (dáta nedostupné).", "warn");
            return;
        }

        let totalCandlesProcessed = 0;
        let simTradesCount = 0;
        let simWins = 0;
        let simLosses = 0;

        const symbols = Object.keys(payload.data);
        for (const sym of symbols) {
            const chart = payload.data[sym];
            const candles = chart.candles || [];
            if (candles.length < 45) continue;

            totalCandlesProcessed += candles.length;
            let activeSimPos = null;

            // Walk forward from candle 30 to end
            for (let i = 30; i < candles.length; i += 2) {
                const windowCandles = candles.slice(Math.max(0, i - 45), i + 1);
                const curCandle = candles[i];
                const curPrice = curCandle.c;
                if (!curPrice || curPrice <= 0) continue;

                if (!activeSimPos) {
                    const evalStep = evaluateTechnicalSlice(windowCandles, sym, 0, 0);
                    if (evalStep.aiScore >= state.learning.minScoreThreshold) {
                        activeSimPos = {
                            symbol: sym,
                            entryPriceUsd: curPrice,
                            highPriceUsd: curPrice,
                            stopLossUsd: curPrice * (1 - evalStep.dynamicSlPct / 100),
                            takeProfitUsd: curPrice * (1 + evalStep.dynamicTpPct / 100),
                            dynamicSlPct: evalStep.dynamicSlPct,
                            dynamicTpPct: evalStep.dynamicTpPct,
                            trailingActive: false,
                            entryIdx: i,
                            entryFactors: { ...evalStep.factors }
                        };
                    }
                } else {
                    // Check open simulated trade against candle high/low/close
                    if (curCandle.h > activeSimPos.highPriceUsd) {
                        activeSimPos.highPriceUsd = curCandle.h;
                    }
                    const peakPnlPct = ((activeSimPos.highPriceUsd - activeSimPos.entryPriceUsd) / activeSimPos.entryPriceUsd) * 100;
                    if (peakPnlPct >= state.learning.trailingTriggerPct) {
                        const newTrail = activeSimPos.highPriceUsd * (1 - state.learning.trailingDistancePct / 100);
                        if (newTrail > activeSimPos.stopLossUsd) {
                            activeSimPos.stopLossUsd = newTrail;
                            activeSimPos.trailingActive = true;
                        }
                    }

                    let closed = false;
                    let exitPrice = curPrice;

                    if (curCandle.l <= activeSimPos.stopLossUsd) {
                        exitPrice = activeSimPos.stopLossUsd;
                        closed = true;
                    } else if (curCandle.h >= activeSimPos.takeProfitUsd) {
                        exitPrice = activeSimPos.takeProfitUsd;
                        closed = true;
                    } else if (i - activeSimPos.entryIdx >= 24) {
                        // Time-stop after 2 hours (24 x 5m candles) intraday holding
                        exitPrice = curPrice;
                        closed = true;
                    }

                    if (closed) {
                        // Subtract realistic 0.30% round-trip FX fee
                        const rawPnlPct = ((exitPrice - activeSimPos.entryPriceUsd) / activeSimPos.entryPriceUsd) * 100 - 0.30;
                        const simPnlEur = 25.0 * (rawPnlPct / 100);

                        learnFromClosedTrade(activeSimPos, simPnlEur, rawPnlPct, true);
                        simTradesCount++;
                        if (rawPnlPct > 0) simWins++;
                        else simLosses++;

                        activeSimPos = null;
                    }
                }
            }
        }

        const winRate = simTradesCount > 0 ? ((simWins / simTradesCount) * 100).toFixed(1) : "0.0";
        const summaryText = `Historický tréning dokončený (${totalCandlesProcessed.toLocaleString("sk-SK")} sviečok, ${simTradesCount} simulovaných obchodov, úspešnosť ${winRate}%). Váhy AI, ATR násobitele a pamäť pre ${Object.keys(state.learning.tickerMemory).length} akcií boli aktualizované!`;

        state.learning.lessons.unshift({
            time: new Date().toLocaleTimeString("sk-SK"),
            gen: state.learning.generation,
            text: summaryText
        });
        if (state.learning.lessons.length > 25) state.learning.lessons.length = 25;

        addLog(`✅ ${summaryText}`, "success");

        // Re-evaluate current market cache with newly trained brain
        for (const sym of Object.keys(marketCache)) {
            marketCache[sym] = analyzeSymbolData(marketCache[sym]);
        }

        await saveStateToServer();
        renderAll();
    } catch (e) {
        addLog(`❌ Chyba pri historickom tréningu: ${e.message}`, "error");
    } finally {
        isTrainingHistory = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = "🏋️ Trénovať AI na histórii (5 dní)";
        }
    }
}

// ============================================================================
// LIVE NEWS & SENTIMENT ANALYSIS ENGINE
// ============================================================================

function scoreHeadlineSentiment(title) {
    if (!title) return 0;
    const lower = title.toLowerCase();
    let score = 0;

    for (const item of BULLISH_WORDS) {
        if (lower.includes(item.w)) score += item.s;
    }
    for (const item of BEARISH_WORDS) {
        if (lower.includes(item.w)) score += item.s;
    }
    return Math.max(-100, Math.min(100, score));
}

async function fetchAllNews() {
    const watchlist = getActiveWatchlist();
    const query = watchlist.slice(0, 6).join(" OR ");
    try {
        const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.news)) {
            newsCache = data.news.map(n => {
                const rawScore = scoreHeadlineSentiment(n.title);
                return {
                    ...n,
                    sentimentScore: rawScore
                };
            });

            const map = {};
            for (const sym of watchlist) {
                map[sym] = { score: 0, count: 0, latestHeadline: "" };
            }

            for (const item of newsCache) {
                const titleUpper = (item.title || "").toUpperCase();
                for (const sym of watchlist) {
                    const cleanSym = sym.replace("-USD", "");
                    const isRelated = (item.relatedTickers && item.relatedTickers.includes(sym)) || titleUpper.includes(cleanSym);
                    if (isRelated) {
                        map[sym].count++;
                        map[sym].score = Math.max(-100, Math.min(100, map[sym].score + item.sentimentScore));
                        if (!map[sym].latestHeadline) {
                            map[sym].latestHeadline = item.title;
                        }
                    }
                }
            }
            tickerSentiment = map;
            renderNewsFeed();
        }
    } catch (e) {
        console.warn("Chyba pri sťahovaní správ:", e);
    }
}

// ============================================================================
// CORE TRADING & PORTFOLIO CYCLE
// ============================================================================

function getActiveWatchlist() {
    const set = new Set();
    const packs = state.packs || DEFAULT_STATE.packs;
    if (packs.tech) MARKET_PACKS.tech.forEach(s => set.add(s));
    if (packs.movers) MARKET_PACKS.movers.forEach(s => set.add(s));
    if (packs.sp500) MARKET_PACKS.sp500.forEach(s => set.add(s));
    if (packs.etf) MARKET_PACKS.etf.forEach(s => set.add(s));
    if (state.includeCrypto) MARKET_PACKS.crypto.forEach(s => set.add(s));

    if (state.settings.watchlist) {
        state.settings.watchlist
            .split(",")
            .map(s => s.trim().toUpperCase())
            .filter(Boolean)
            .forEach(s => set.add(s));
    }
    return Array.from(set);
}

async function runMarketCycle() {
    if (isScanning) return;
    isScanning = true;

    try {
        updateMarketSessionHeader();
        const watchlist = getActiveWatchlist();
        for (const pos of state.portfolio.positions) {
            if (!watchlist.includes(pos.symbol)) watchlist.push(pos.symbol);
        }

        const res = await fetch(`/api/market?symbols=${encodeURIComponent(watchlist.join(","))}`);
        const payload = await res.json();

        if (!payload || !payload.ok || !payload.data) {
            addLog("Upozornenie: Nepodarilo sa načítať dáta z burzy.", "warn");
            isScanning = false;
            return;
        }

        if (payload.eurUsd && payload.eurUsd > 0.5) {
            state.fxRateEurUsd = payload.eurUsd;
            document.getElementById("fxRateLabel").textContent = state.fxRateEurUsd.toFixed(4);
        }

        for (const sym of Object.keys(payload.data)) {
            marketCache[sym] = analyzeSymbolData(payload.data[sym]);
        }

        document.getElementById("lastScanTime").textContent = new Date().toLocaleTimeString("sk-SK");

        if (state.agentActive) {
            evaluateOpenPositions();
            evaluateNewEntries();
        }

        await saveStateToServer();
        renderAll();
    } catch (e) {
        addLog(`Chyba počas skenovacieho cyklu: ${e.message}`, "error");
    } finally {
        isScanning = false;
    }
}

function evaluateOpenPositions() {
    const sessionInfo = getMarketSessionInfo();

    if (state.settings.marketHoursMode === "strict_us" && sessionInfo.isNearCloseEod && state.portfolio.positions.length > 0) {
        closeAllPositions("Automatický predaj pred záverečnou US burzy (EOD ochrana)");
        return;
    }

    const currentPositions = [...state.portfolio.positions];
    for (const pos of currentPositions) {
        const mkt = marketCache[pos.symbol];
        if (!mkt || !mkt.price) continue;

        pos.currentPriceUsd = mkt.price;
        if (mkt.price > (pos.highPriceUsd || pos.entryPriceUsd)) {
            pos.highPriceUsd = mkt.price;
        }

        const pnlPct = ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

        // 1. Check Trailing Stop activation & update
        if (pnlPct >= state.learning.trailingTriggerPct) {
            const newTrailStop = pos.highPriceUsd * (1 - state.learning.trailingDistancePct / 100);
            if (newTrailStop > pos.stopLossUsd) {
                pos.stopLossUsd = Math.round(newTrailStop * 10000) / 10000;
                if (!pos.trailingActive) {
                    pos.trailingActive = true;
                    addLog(`🔒 [${pos.symbol}] Aktivovaný Trailing Stop! Stop-Loss posunutý na ochranu zisku (${pos.stopLossUsd.toFixed(2)} $).`, "info");
                }
            }
        }

        // 2. Check Stop-Loss / Trailing Stop hit
        if (pos.currentPriceUsd <= pos.stopLossUsd) {
            const reason = pos.trailingActive
                ? `Trailing Stop zasiahnutý na ${pos.currentPriceUsd.toFixed(2)} $ (uzamknutý zisk)`
                : `Ochranný ATR Stop-Loss zasiahnutý na ${pos.currentPriceUsd.toFixed(2)} $`;
            executeSellPosition(pos.id, reason);
            continue;
        }

        // 3. Check Take-Profit target hit
        if (pos.currentPriceUsd >= pos.takeProfitUsd) {
            executeSellPosition(pos.id, `Cieľový ATR Take-Profit (+${pnlPct.toFixed(2)} %) dosiahnutý!`);
            continue;
        }

        // 4. Check AI Signal Reversal
        if (mkt.aiScore <= -30) {
            executeSellPosition(pos.id, `Obrat AI signálu do záporu (Skóre ${mkt.aiScore}, RSI ${mkt.rsi})`);
            continue;
        }
    }
}

function evaluateNewEntries() {
    const sessionInfo = getMarketSessionInfo();
    const maxPositions = Number(state.settings.maxPositions) || 4;
    if (state.portfolio.positions.length >= maxPositions) return;
    if (state.portfolio.cashEur < 5.0) return;

    const candidates = Object.values(marketCache)
        .filter(m => {
            if (state.portfolio.positions.some(p => p.symbol === m.symbol)) return false;
            const isCrypto = m.symbol.endsWith("-USD");
            if (!isCrypto && !sessionInfo.canTradeStocks) return false;
            return m.aiScore >= state.learning.minScoreThreshold;
        })
        .sort((a, b) => b.aiScore - a.aiScore);

    for (const cand of candidates) {
        if (state.portfolio.positions.length >= maxPositions) break;
        if (state.portfolio.cashEur < 5.0) break;

        const maxPosEur = Number(state.settings.maxPosEur) || 25;
        const desiredEur = Math.min(maxPosEur, state.portfolio.cashEur);
        if (desiredEur < 5.0) break;

        executeBuyPosition(cand, desiredEur);
    }
}

async function executeBuyPosition(mkt, amountEur) {
    const priceUsd = mkt.price;
    if (!priceUsd || priceUsd <= 0) return;

    const fxFeeEur = amountEur * 0.0015;
    const netInvestedEur = amountEur - fxFeeEur;
    const amountUsd = netInvestedEur * state.fxRateEurUsd;
    const shares = amountUsd / priceUsd;

    // Use dynamic ATR-based Stop-Loss & Take-Profit tailored to this stock's volatility
    const slPct = mkt.dynamicSlPct || state.learning.stopLossPct || 1.8;
    const tpPct = mkt.dynamicTpPct || state.learning.takeProfitPct || 3.2;

    const slUsd = Math.round(priceUsd * (1 - slPct / 100) * 10000) / 10000;
    const tpUsd = Math.round(priceUsd * (1 + tpPct / 100) * 10000) / 10000;

    const reasonParts = [`AI +${mkt.aiScore}`];
    if (mkt.reputationBonus) {
        reasonParts.push(`Pamäť ${mkt.reputationBonus > 0 ? "+" : ""}${mkt.reputationBonus}b`);
    }
    reasonParts.push(`RSI ${mkt.rsi}`);
    reasonParts.push(`ATR SL -${slPct}%`);

    const newPos = {
        id: "pos_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        symbol: mkt.symbol,
        shares: shares,
        investedEur: Math.round(amountEur * 100) / 100,
        entryPriceUsd: priceUsd,
        currentPriceUsd: priceUsd,
        highPriceUsd: priceUsd,
        stopLossUsd: slUsd,
        takeProfitUsd: tpUsd,
        dynamicSlPct: slPct,
        dynamicTpPct: tpPct,
        trailingActive: false,
        openedAt: new Date().toLocaleTimeString("sk-SK"),
        reason: reasonParts.join(" | "),
        entryFactors: { ...mkt.factors }
    };

    state.portfolio.cashEur = Math.round((state.portfolio.cashEur - amountEur) * 100) / 100;
    state.portfolio.positions.push(newPos);

    addLog(`🟢 NÁKUP [${mkt.symbol}]: Vložené ${amountEur.toFixed(2)} € (${shares.toFixed(4)} ks @ ${priceUsd.toFixed(2)} $). ${newPos.reason}`, "success");

    if (state.settings.executionMode !== "simulator" && state.settings.brokerKey) {
        forwardOrderToBroker(mkt.symbol, "buy", amountUsd);
    }

    await saveStateToServer();
    renderAll();
}

async function executeSellPosition(posId, exitReason) {
    const idx = state.portfolio.positions.findIndex(p => p.id === posId);
    if (idx === -1) return;

    const pos = state.portfolio.positions[idx];
    const mkt = marketCache[pos.symbol];
    const exitPriceUsd = (mkt && mkt.price) ? mkt.price : pos.currentPriceUsd;

    const grossValueUsd = pos.shares * exitPriceUsd;
    const grossValueEur = grossValueUsd / state.fxRateEurUsd;
    const netReturnedEur = grossValueEur * (1 - 0.0015);

    const pnlEur = netReturnedEur - pos.investedEur;
    const pnlPct = (pnlEur / pos.investedEur) * 100;

    state.portfolio.positions.splice(idx, 1);
    state.portfolio.cashEur = Math.round((state.portfolio.cashEur + netReturnedEur) * 100) / 100;

    const lessonText = learnFromClosedTrade(pos, pnlEur, pnlPct, false);

    const closedRecord = {
        id: pos.id,
        symbol: pos.symbol,
        investedEur: pos.investedEur,
        entryPriceUsd: pos.entryPriceUsd,
        exitPriceUsd: exitPriceUsd,
        pnlEur: Math.round(pnlEur * 100) / 100,
        pnlPct: Math.round(pnlPct * 100) / 100,
        openedAt: pos.openedAt,
        closedAt: new Date().toLocaleTimeString("sk-SK"),
        exitReason: exitReason,
        lesson: lessonText
    };

    state.portfolio.closedTrades.unshift(closedRecord);
    if (state.portfolio.closedTrades.length > 100) {
        state.portfolio.closedTrades.pop();
    }

    const emoji = pnlEur >= 0 ? "💰 ZISK" : "🔻 STRATA";
    addLog(`${emoji} PREDAJ [${pos.symbol}] @ ${exitPriceUsd.toFixed(2)} $: Výsledok ${pnlEur >= 0 ? "+" : ""}${pnlEur.toFixed(2)} € (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)} %). Dôvod: ${exitReason}`, pnlEur >= 0 ? "success" : "warn");

    if (state.settings.executionMode !== "simulator" && state.settings.brokerKey) {
        forwardOrderToBroker(pos.symbol, "sell", grossValueUsd);
    }

    await saveStateToServer();
    renderAll();
}

function closeAllPositions(reason = "Manuálny predaj všetkých pozícií") {
    if (state.portfolio.positions.length === 0) {
        addLog("Žiadne otvorené pozície na predaj.", "info");
        return;
    }
    const ids = state.portfolio.positions.map(p => p.id);
    for (const id of ids) {
        executeSellPosition(id, reason);
    }
}

// ============================================================================
// DEEP SELF-LEARNING ENGINE (GLOBAL WEIGHTS + PER-STOCK MEMORY + ATR TUNING)
// ============================================================================

function learnFromClosedTrade(pos, pnlEur, pnlPct, isBacktest = false) {
    const factors = pos.entryFactors || { rsi: 20, trend: 20, macd: 20, volume: 20, sentiment: 20 };
    const w = state.learning.weights;
    state.learning.generation += 1;
    state.learning.totalTrainedTrades = (state.learning.totalTrainedTrades || 0) + 1;
    const gen = state.learning.generation;

    const reward = Math.max(-1.2, Math.min(1.2, pnlPct / 1.5));
    const learningRate = isBacktest ? 0.025 : 0.08;

    const factorNames = {
        rsi: "RSI",
        trend: "Trend EMA/VWAP",
        macd: "MACD",
        volume: "Objem (Volume)",
        sentiment: "Sentiment správ"
    };

    let bestFactor = "trend";
    let maxContribution = -999;

    for (const key of Object.keys(w)) {
        const fVal = (factors[key] || 0) / 100;
        if (fVal > maxContribution) {
            maxContribution = fVal;
            bestFactor = key;
        }
        const delta = reward * fVal * learningRate * 100;
        w[key] = Math.max(8, Math.min(45, w[key] + delta));
    }

    // Normalize global weights to sum to 100
    const sumW = w.rsi + w.trend + w.macd + w.volume + w.sentiment;
    for (const key of Object.keys(w)) {
        w[key] = Math.round((w[key] / sumW) * 100);
    }
    const diff = 100 - (w.rsi + w.trend + w.macd + w.volume + w.sentiment);
    w.trend += diff;

    // Update Per-Ticker Memory (Ticker Reputation & Best Indicator per Stock)
    if (!state.learning.tickerMemory) state.learning.tickerMemory = {};
    const sym = pos.symbol;
    if (!state.learning.tickerMemory[sym]) {
        state.learning.tickerMemory[sym] = {
            trades: 0,
            wins: 0,
            losses: 0,
            totalPnlPct: 0,
            avgPnlPct: 0,
            winRate: 50,
            reputationBonus: 0,
            bestFactor: "trend",
            factorScores: { rsi: 0, trend: 0, macd: 0, volume: 0 }
        };
    }

    const tm = state.learning.tickerMemory[sym];
    tm.trades += 1;
    if (pnlPct > 0) tm.wins += 1;
    else tm.losses += 1;
    tm.totalPnlPct = Math.round((tm.totalPnlPct + pnlPct) * 100) / 100;
    tm.avgPnlPct = Math.round((tm.totalPnlPct / tm.trades) * 100) / 100;
    tm.winRate = Math.round((tm.wins / tm.trades) * 100);

    // Track which technical factor works best on this specific stock
    for (const fk of ["rsi", "trend", "macd", "volume"]) {
        const fVal = (factors[fk] || 0) / 100;
        tm.factorScores[fk] = (tm.factorScores[fk] || 0) + reward * fVal;
    }
    const sortedStockFactors = Object.entries(tm.factorScores).sort((a, b) => b[1] - a[1]);
    tm.bestFactor = sortedStockFactors[0][0];

    // Calculate Reputation Bonus (-18 to +18 points)
    // High win-rate & positive avgPnl stocks get boosted; choppy money-losers get penalized
    if (tm.trades >= 2) {
        const winRateDelta = (tm.winRate - 50) * 0.25; // -12.5 to +12.5
        const pnlDelta = tm.avgPnlPct * 4.5;
        tm.reputationBonus = Math.round(Math.max(-18, Math.min(18, winRateDelta + pnlDelta)));
    }

    // Tune ATR Stop-Loss / Take-Profit multipliers slightly based on outcome
    if (!state.learning.slAtrMultiplier) state.learning.slAtrMultiplier = 2.4;
    if (!state.learning.tpAtrMultiplier) state.learning.tpAtrMultiplier = 4.5;

    if (pnlPct < -1.0) {
        // Tightened slightly or widen if premature stop
        state.learning.slAtrMultiplier = Math.round(Math.min(3.2, state.learning.slAtrMultiplier + 0.03) * 100) / 100;
    } else if (pnlPct > 1.2) {
        state.learning.tpAtrMultiplier = Math.round(Math.min(5.8, state.learning.tpAtrMultiplier + 0.03) * 100) / 100;
    }

    state.learning.stopLossPct = Math.round(state.learning.slAtrMultiplier * 0.75 * 10) / 10;
    state.learning.takeProfitPct = Math.round(state.learning.tpAtrMultiplier * 0.75 * 10) / 10;

    let lesson = "";
    if (!isBacktest) {
        if (pnlEur > 0) {
            state.learning.minScoreThreshold = Math.max(23, state.learning.minScoreThreshold - 1);
            lesson = `Gen #${gen} (${sym} +${pnlPct.toFixed(2)}%): Potvrdený faktor ${factorNames[bestFactor]}. Reputácia ${sym}: ${tm.winRate}% Win (${tm.reputationBonus >= 0 ? "+" : ""}${tm.reputationBonus}b).`;
        } else {
            state.learning.minScoreThreshold = Math.min(40, state.learning.minScoreThreshold + 1);
            lesson = `Gen #${gen} (${sym} ${pnlPct.toFixed(2)}%): Falošný signál pri ${factorNames[bestFactor]}. Reputácia ${sym} upravená na ${tm.reputationBonus}b, prah istoty ${state.learning.minScoreThreshold}b.`;
        }

        state.learning.lessons.unshift({
            time: new Date().toLocaleTimeString("sk-SK"),
            gen: gen,
            text: lesson
        });
        if (state.learning.lessons.length > 25) {
            state.learning.lessons.pop();
        }
    }

    return lesson;
}

// ============================================================================
// UI RENDERING & INTERACTIVE CHART
// ============================================================================

function renderAll() {
    renderKpis();
    renderScannerTable();
    renderPositionsTable();
    renderLearningPanel();
    renderHistoryTable();
    renderSelectedChart();
}

function renderKpis() {
    let openPositionsValueEur = 0;
    let investedEurTotal = 0;

    for (const pos of state.portfolio.positions) {
        const mkt = marketCache[pos.symbol];
        const priceUsd = (mkt && mkt.price) ? mkt.price : pos.currentPriceUsd;
        const valEur = (pos.shares * priceUsd) / state.fxRateEurUsd;
        openPositionsValueEur += valEur;
        investedEurTotal += pos.investedEur;
    }

    const totalEquityEur = state.portfolio.cashEur + openPositionsValueEur;
    const totalPnlEur = totalEquityEur - state.portfolio.initialCapitalEur;
    const totalPnlPct = (totalPnlEur / state.portfolio.initialCapitalEur) * 100;

    document.getElementById("kpiEquity").textContent = `${totalEquityEur.toFixed(2)} €`;
    const pnlEl = document.getElementById("kpiTotalPnl");
    pnlEl.textContent = `${totalPnlEur >= 0 ? "+" : ""}${totalPnlEur.toFixed(2)} €`;
    pnlEl.className = totalPnlEur >= 0 ? "text-green" : "text-red";

    const badgeEl = document.getElementById("totalPnlBadge");
    badgeEl.textContent = `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)} %`;
    badgeEl.className = `badge ${totalPnlEur > 0.01 ? "badge-profit" : totalPnlEur < -0.01 ? "badge-loss" : "badge-neutral"}`;

    document.getElementById("kpiCash").textContent = `${state.portfolio.cashEur.toFixed(2)} €`;
    document.getElementById("kpiInvested").textContent = `${investedEurTotal.toFixed(2)} €`;
    const exposurePct = Math.min(100, Math.round((investedEurTotal / Math.max(1, totalEquityEur)) * 100));
    document.getElementById("kpiExposurePct").textContent = `${exposurePct} % kapitálu`;
    document.getElementById("exposureBar").style.width = `${exposurePct}%`;
    document.getElementById("openPosCountBadge").textContent = `${state.portfolio.positions.length} / ${state.settings.maxPositions} pozície`;

    const closed = state.portfolio.closedTrades;
    const wins = closed.filter(t => t.pnlEur > 0).length;
    const losses = closed.filter(t => t.pnlEur <= 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    const grossProfit = closed.filter(t => t.pnlEur > 0).reduce((a, b) => a + b.pnlEur, 0);
    const grossLoss = Math.abs(closed.filter(t => t.pnlEur < 0).reduce((a, b) => a + b.pnlEur, 0));
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? "∞" : "--");

    document.getElementById("kpiWinRate").textContent = `${winRate.toFixed(1)} %`;
    document.getElementById("kpiTotalTrades").textContent = `${closed.length}`;
    document.getElementById("kpiWinsLosses").textContent = `${wins}W / ${losses}L`;
    document.getElementById("profitFactorBadge").textContent = `PF: ${pf}`;

    document.getElementById("learningGenBadge").textContent = `Gen #${state.learning.generation}`;
    document.getElementById("kpiThreshold").textContent = `${state.learning.minScoreThreshold} bodov`;
    document.getElementById("kpiSlTp").textContent = `ATR ${state.learning.slAtrMultiplier || 2.4}x / ${state.learning.tpAtrMultiplier || 4.5}x`;

    const w = state.learning.weights;
    const entries = Object.entries(w).sort((a, b) => b[1] - a[1]);
    const labelsMap = { rsi: "Technické RSI", trend: "Trend EMA/VWAP", macd: "MACD Momentum", volume: "Objemové špičky", sentiment: "Sentiment Správ" };
    document.getElementById("kpiDominantFactor").textContent = `Líder: ${labelsMap[entries[0][0]]} (${entries[0][1]}%)`;
}

function renderScannerTable() {
    const tbody = document.getElementById("scannerTableBody");
    const watchlist = getActiveWatchlist();
    const searchVal = (document.getElementById("scannerSearchInput")?.value || "").trim().toUpperCase();
    const sortMode = document.getElementById("scannerSortSelect")?.value || "score_desc";

    const items = [];
    for (const sym of watchlist) {
        const m = marketCache[sym];
        if (!m) continue;
        if (searchVal && !sym.includes(searchVal)) continue;
        items.push(m);
    }

    const countBadge = document.getElementById("scannerCountBadge");
    if (countBadge) {
        countBadge.textContent = `${items.length} titulov`;
    }

    items.sort((a, b) => {
        if (sortMode === "score_desc") return b.aiScore - a.aiScore;
        if (sortMode === "change_desc") return b.changePct - a.changePct;
        if (sortMode === "change_asc") return a.changePct - b.changePct;
        if (sortMode === "rsi_asc") return a.rsi - b.rsi;
        if (sortMode === "symbol_asc") return a.symbol.localeCompare(b.symbol);
        return b.aiScore - a.aiScore;
    });

    const rows = [];

    for (const m of items) {
        const sym = m.symbol;
        const isSelected = (state.selectedSymbol === sym);
        const chgClass = m.changePct >= 0 ? "text-green" : "text-red";
        const rsiClass = m.rsi < 35 ? "text-green" : (m.rsi > 70 ? "text-red" : "");
        const scoreColor = m.aiScore >= state.learning.minScoreThreshold ? "var(--profit-green)" : (m.aiScore < 0 ? "var(--loss-red)" : "var(--accent-blue)");
        const barWidth = Math.min(100, Math.max(5, (m.aiScore + 100) / 2));
        const alreadyHeld = state.portfolio.positions.some(p => p.symbol === sym);

        // Per-Stock Memory Cell
        let memHtml = `<span class="text-muted" style="font-size:11px;">Nový titul</span>`;
        if (m.tickerMem && m.tickerMem.trades > 0) {
            const tm = m.tickerMem;
            const repColor = tm.reputationBonus > 0 ? "text-green" : (tm.reputationBonus < 0 ? "text-red" : "text-muted");
            const icon = tm.reputationBonus >= 4 ? "⭐" : (tm.reputationBonus <= -4 ? "⚠️" : "📊");
            memHtml = `
                <span class="${repColor}" title="Počet natrénovaných obchodov: ${tm.trades} | Priemerný výsledok: ${tm.avgPnlPct}% | Najlepší indikátor: ${tm.bestFactor.toUpperCase()}">
                    ${icon} ${tm.winRate}% W <small>(${tm.reputationBonus >= 0 ? "+" : ""}${tm.reputationBonus}b)</small>
                </span>
            `;
        }

        rows.push(`
            <tr class="clickable-row ${isSelected ? "selected-row" : ""}" onclick="selectSymbol('${sym}')">
                <td>
                    <span class="ticker-symbol">${sym}</span>
                    ${alreadyHeld ? '<span class="badge badge-profit" style="margin-left:4px;font-size:9px;">V PORTFÓLIU</span>' : ''}
                </td>
                <td><strong>${m.price.toFixed(2)} $</strong></td>
                <td class="${chgClass}">${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(2)} %</td>
                <td>
                    <span class="${rsiClass}">${m.rsi.toFixed(1)}</span>
                    <span class="text-muted" style="font-size:11px;" title="Adaptívny Stop-Loss podľa volatility ATR"> / -${m.dynamicSlPct}%</span>
                </td>
                <td><span style="font-size:12px;">${m.trendLabel}</span></td>
                <td><span style="font-size:12px;">${m.macdLabel}</span></td>
                <td>${memHtml}</td>
                <td>
                    <div class="score-meter">
                        <strong style="width:32px; color:${scoreColor}">${m.aiScore > 0 ? "+" : ""}${m.aiScore}</strong>
                        <div class="score-bar-bg">
                            <div class="score-bar-fill" style="width:${barWidth}%; background:${scoreColor};"></div>
                        </div>
                    </div>
                </td>
                <td><span class="badge ${m.actionClass}">${m.actionLabel}</span></td>
                <td onclick="event.stopPropagation()">
                    <button class="btn btn-sm" onclick="manualBuy('${sym}')" ${alreadyHeld ? "disabled" : ""} title="Manuálne nakúpiť pozíciu za nastavenú sumu">
                        Kúpiť
                    </button>
                </td>
            </tr>
        `);
    }

    tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="10" style="text-align:center;padding:20px;">Žiadne dáta pre zvolený filter</td></tr>`;
}

function renderPositionsTable() {
    const tbody = document.getElementById("positionsTableBody");
    const positions = state.portfolio.positions;

    if (positions.length === 0) {
        document.getElementById("openPnlSummary").textContent = "Otvorený P&L: 0.00 €";
        document.getElementById("openPnlSummary").className = "badge badge-neutral";
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding:24px; color:var(--text-secondary);">
                    Zatiaľ žiadne otvorené pozície. Agent priebežne skenuje trh a nakúpi hneď, ako AI skóre prekročí ${state.learning.minScoreThreshold} bodov.
                </td>
            </tr>
        `;
        return;
    }

    let totalOpenPnlEur = 0;
    const rows = positions.map(pos => {
        const mkt = marketCache[pos.symbol];
        const currUsd = (mkt && mkt.price) ? mkt.price : pos.currentPriceUsd;
        const currValEur = ((pos.shares * currUsd) / state.fxRateEurUsd) * (1 - 0.0015);
        const pnlEur = currValEur - pos.investedEur;
        const pnlPct = (pnlEur / pos.investedEur) * 100;
        totalOpenPnlEur += pnlEur;

        const pnlClass = pnlEur >= 0 ? "text-green" : "text-red";

        return `
            <tr>
                <td>
                    <strong class="ticker-symbol" style="cursor:pointer;" onclick="selectSymbol('${pos.symbol}')">${pos.symbol}</strong>
                    <div class="text-muted" style="font-size:11px;">${pos.shares.toFixed(4)} ks</div>
                </td>
                <td><strong>${pos.investedEur.toFixed(2)} €</strong></td>
                <td>
                    <div>${pos.entryPriceUsd.toFixed(2)} $ → <strong>${currUsd.toFixed(2)} $</strong></div>
                    <div class="text-muted" style="font-size:11px;">Otvorené: ${pos.openedAt}</div>
                </td>
                <td class="${pnlClass}">
                    <div><strong>${pnlEur >= 0 ? "+" : ""}${pnlEur.toFixed(2)} €</strong></div>
                    <div style="font-size:11px;">(${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)} %)</div>
                </td>
                <td>
                    <div style="font-size:12px;">
                        <span class="text-red">SL: ${pos.stopLossUsd.toFixed(2)} $</span>
                        ${pos.trailingActive ? '<span class="badge badge-profit" style="font-size:9px;padding:1px 4px;">TRAIL</span>' : ''}
                    </div>
                    <div style="font-size:12px;" class="text-green">TP: ${pos.takeProfitUsd.toFixed(2)} $</div>
                </td>
                <td style="max-width:210px; overflow:hidden; text-overflow:ellipsis;" title="${pos.reason}">
                    <span style="font-size:11px; color:var(--text-secondary);">${pos.reason}</span>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="executeSellPosition('${pos.id}', 'Manuálne uzavretie používateľom')">
                        Predať
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rows.join("");
    const sumEl = document.getElementById("openPnlSummary");
    sumEl.textContent = `Otvorený P&L: ${totalOpenPnlEur >= 0 ? "+" : ""}${totalOpenPnlEur.toFixed(2)} €`;
    sumEl.className = `badge ${totalOpenPnlEur >= 0 ? "badge-profit" : "badge-loss"}`;
}

function renderLearningPanel() {
    const w = state.learning.weights;
    const items = [
        { key: "trend", label: "Trend (EMA 9/21 & VWAP)", val: w.trend },
        { key: "rsi", label: "RSI (14) Prepredanosť", val: w.rsi },
        { key: "macd", label: "MACD Momentum", val: w.macd },
        { key: "sentiment", label: "NLP Sentiment správ", val: w.sentiment },
        { key: "volume", label: "Objemové špičky (Volume)", val: w.volume }
    ];

    const lblTrained = document.getElementById("lblTrainedTrades");
    if (lblTrained) {
        lblTrained.textContent = (state.learning.totalTrainedTrades || 0).toLocaleString("sk-SK");
    }

    const container = document.getElementById("weightsContainer");
    container.innerHTML = items.map(item => `
        <div class="weight-item">
            <div class="weight-header">
                <span>${item.label}</span>
                <span class="weight-val">${item.val} %</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width:${Math.min(100, item.val * 2.2)}%;"></div>
            </div>
        </div>
    `).join("");

    // Render Ticker Reputation Memory Badges
    const memObj = state.learning.tickerMemory || {};
    const memList = Object.entries(memObj)
        .filter(([_, m]) => m.trades >= 1)
        .sort((a, b) => b[1].reputationBonus - a[1].reputationBonus);

    const memCountEl = document.getElementById("lblTickerMemoryCount");
    if (memCountEl) memCountEl.textContent = `${memList.length} akcií v pamäti`;

    const memContainer = document.getElementById("tickerMemoryBadges");
    if (memContainer) {
        if (memList.length === 0) {
            memContainer.innerHTML = `<span class="text-muted" style="font-size:12px;">Kliknite na "🏋️ Trénovať AI na histórii", aby si agent vytvoril pamäť pre jednotlivé akcie.</span>`;
        } else {
            memContainer.innerHTML = memList.map(([sym, m]) => {
                const cls = m.reputationBonus >= 3 ? "badge-profit" : (m.reputationBonus <= -3 ? "badge-loss" : "badge-neutral");
                return `<span class="badge ${cls}" style="cursor:pointer;" onclick="selectSymbol('${sym}')" title="${sym}: ${m.trades} obchodov, Win Rate ${m.winRate}%, Priemer ${m.avgPnlPct}%, Najlepší faktor: ${m.bestFactor.toUpperCase()}">
                    ${sym}: ${m.winRate}% W (${m.reputationBonus >= 0 ? "+" : ""}${m.reputationBonus}b)
                </span>`;
            }).join("");
        }
    }

    const logContainer = document.getElementById("learningLogList");
    logContainer.innerHTML = state.learning.lessons.map(l => `
        <div class="feed-item" style="padding:8px 12px;">
            <div class="feed-meta">
                <span class="badge badge-profit">Gen #${l.gen}</span>
                <span>${l.time}</span>
            </div>
            <div style="font-size:12px; color:var(--text-primary); margin-top:2px;">${l.text}</div>
        </div>
    `).join("");
}

function renderNewsFeed() {
    const container = document.getElementById("newsFeedList");
    if (!newsCache || newsCache.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;">Žiadne správy k dispozícii.</div>`;
        return;
    }

    container.innerHTML = newsCache.map(n => {
        let badge = `<span class="badge badge-neutral">NEUTRÁLNE (0)</span>`;
        if (n.sentimentScore > 0) {
            badge = `<span class="badge badge-profit">POZITÍVNE (+${n.sentimentScore})</span>`;
        } else if (n.sentimentScore < 0) {
            badge = `<span class="badge badge-loss">NEGATÍVNE (${n.sentimentScore})</span>`;
        }

        const timeStr = n.publishedAt ? new Date(n.publishedAt * 1000).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : "";
        const tickers = (n.relatedTickers || []).slice(0, 5).map(t => `<span class="badge badge-neutral" style="font-size:10px;">${t}</span>`).join(" ");

        return `
            <div class="feed-item">
                <div class="feed-meta">
                    <span><strong>${n.publisher || "Market News"}</strong> • ${timeStr}</span>
                    ${badge}
                </div>
                <a href="${n.link}" target="_blank" rel="noopener noreferrer">${n.title}</a>
                ${tickers ? `<div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap;">${tickers}</div>` : ""}
            </div>
        `;
    }).join("");
}

function renderHistoryTable() {
    const tbody = document.getElementById("historyTableBody");
    const closed = state.portfolio.closedTrades;

    const totalRealized = closed.reduce((acc, t) => acc + t.pnlEur, 0);
    const badge = document.getElementById("realizedPnlBadge");
    badge.textContent = `Realizovaný zisk: ${totalRealized >= 0 ? "+" : ""}${totalRealized.toFixed(2)} €`;
    badge.className = `badge ${totalRealized > 0 ? "badge-profit" : totalRealized < 0 ? "badge-loss" : "badge-neutral"}`;

    if (closed.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-secondary);">Zatiaľ žiadne uzavreté živé obchody.</td></tr>`;
        return;
    }

    tbody.innerHTML = closed.map(t => {
        const cls = t.pnlEur >= 0 ? "text-green" : "text-red";
        return `
            <tr>
                <td class="text-muted">${t.closedAt}</td>
                <td><strong class="ticker-symbol">${t.symbol}</strong></td>
                <td>${t.investedEur.toFixed(2)} €</td>
                <td>${t.entryPriceUsd.toFixed(2)} $ → ${t.exitPriceUsd.toFixed(2)} $</td>
                <td class="${cls}">
                    <strong>${t.pnlEur >= 0 ? "+" : ""}${t.pnlEur.toFixed(2)} €</strong>
                    <span style="font-size:11px;">(${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)} %)</span>
                </td>
                <td style="max-width:260px; white-space:normal; font-size:11px;">
                    <div><strong>${t.exitReason}</strong></div>
                    <div class="text-muted">${t.lesson || ""}</div>
                </td>
            </tr>
        `;
    }).join("");
}

// ============================================================================
// INTERACTIVE CANVAS CANDLESTICK + EMA/VWAP CHART
// ============================================================================

function selectSymbol(sym) {
    state.selectedSymbol = sym;
    renderScannerTable();
    renderSelectedChart();
}

function renderSelectedChart() {
    const canvas = document.getElementById("priceChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width - 16);
    canvas.height = Math.max(180, rect.height - 16);

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const sym = state.selectedSymbol || "NVDA";
    document.getElementById("chartSymbolTitle").textContent = sym;

    const m = marketCache[sym];
    if (!m || !m.candles || m.candles.length < 2) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "13px Segoe UI";
        ctx.fillText(`Načítavam sviečkový graf pre ${sym}...`, 20, h / 2);
        return;
    }

    document.getElementById("chartIndicatorsSummary").innerHTML =
        `Cena: <strong>${m.price.toFixed(2)} $</strong> | <span style="color:#06b6d4">EMA9: ${m.ema9.toFixed(2)}</span> | <span style="color:#8b5cf6">EMA21: ${m.ema21.toFixed(2)}</span> | <span style="color:#f59e0b">VWAP: ${m.vwap.toFixed(2)}</span> | RSI: <strong>${m.rsi}</strong> | ATR SL: <strong>-${m.dynamicSlPct}%</strong>`;

    const candles = m.candles;
    const count = candles.length;
    const padLeft = 12;
    const padRight = 62;
    const padTop = 14;
    const padBottom = 22;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const c of candles) {
        if (c.l < minP) minP = c.l;
        if (c.h > maxP) maxP = c.h;
    }

    const openPos = state.portfolio.positions.find(p => p.symbol === sym);
    if (openPos) {
        minP = Math.min(minP, openPos.stopLossUsd * 0.999);
        maxP = Math.max(maxP, openPos.takeProfitUsd * 1.001);
    }

    const range = Math.max(0.01, maxP - minP);
    const yForPrice = (p) => padTop + plotH - ((p - minP) / range) * plotH;
    const stepX = plotW / count;

    ctx.strokeStyle = "rgba(35, 48, 77, 0.5)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Consolas, monospace";

    for (let i = 0; i <= 4; i++) {
        const y = padTop + (plotH / 4) * i;
        const pVal = maxP - (range / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);
        ctx.stroke();
        ctx.fillText(pVal.toFixed(2), w - padRight + 6, y + 4);
    }

    const candleWidth = Math.max(2, Math.min(10, stepX * 0.65));
    for (let i = 0; i < count; i++) {
        const c = candles[i];
        const x = padLeft + i * stepX + stepX / 2;
        const isBull = c.c >= c.o;
        ctx.strokeStyle = isBull ? "#10b981" : "#ef4444";
        ctx.fillStyle = isBull ? "#10b981" : "#ef4444";

        ctx.beginPath();
        ctx.moveTo(x, yForPrice(c.h));
        ctx.lineTo(x, yForPrice(c.l));
        ctx.stroke();

        const yOpen = yForPrice(c.o);
        const yClose = yForPrice(c.c);
        const top = Math.min(yOpen, yClose);
        const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
        ctx.fillRect(x - candleWidth / 2, top, candleWidth, bodyH);
    }

    const drawLine = (arr, color, dashed = false) => {
        if (!arr || arr.length !== count) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        if (dashed) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            const x = padLeft + i * stepX + stepX / 2;
            const y = yForPrice(arr[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    };

    drawLine(m.vwapArr, "#f59e0b", true);
    drawLine(m.ema21Arr, "#8b5cf6", false);
    drawLine(m.ema9Arr, "#06b6d4", false);

    if (openPos) {
        const drawHorizLevel = (price, color, label) => {
            const y = yForPrice(price);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = "bold 10px Segoe UI";
            ctx.fillText(`${label}: ${price.toFixed(2)}$`, padLeft + 6, y - 4);
            ctx.restore();
        };
        drawHorizLevel(openPos.entryPriceUsd, "#3b82f6", "VSTUP");
        drawHorizLevel(openPos.stopLossUsd, "#ef4444", "STOP-LOSS");
        drawHorizLevel(openPos.takeProfitUsd, "#10b981", "TAKE-PROFIT");
    }
}

// ============================================================================
// USER CONTROLS, LOGGING & BROKER SETTINGS
// ============================================================================

function toggleAgent() {
    state.agentActive = !state.agentActive;
    syncUiFromState();
    saveStateToServer();
    addLog(state.agentActive ? "▶️ Autonómny agent bol SPUSTENÝ." : "⏸️ Autonómny agent bol POZASTAVENÝ.", "info");
}

function toggleCryptoTickers() {
    const chk = document.getElementById("chkIncludeCrypto");
    state.includeCrypto = chk.checked;
    saveStateToServer();
    runMarketCycle();
}

function toggleMarketPacks() {
    state.packs = {
        tech: !!document.getElementById("packTech")?.checked,
        movers: !!document.getElementById("packMovers")?.checked,
        sp500: !!document.getElementById("packSp500")?.checked,
        etf: !!document.getElementById("packEtf")?.checked
    };
    saveStateToServer();
    addLog(`📡 Aktualizovaný zoznam balíkov trhov (${getActiveWatchlist().length} titulov). Spúšťam paralelný sken...`, "info");
    runMarketCycle();
}

function runCycleNow() {
    addLog("⚡ Manuálne vyvolaný okamžitý sken burzy a správ...", "info");
    runMarketCycle();
}

function manualBuy(symbol) {
    const mkt = marketCache[symbol];
    if (!mkt) return;
    const maxPosEur = Number(state.settings.maxPosEur) || 25;
    const amountEur = Math.min(maxPosEur, state.portfolio.cashEur);
    if (amountEur < 2) {
        alert("Nedostatok voľného kapitálu (Cash) na nákup.");
        return;
    }
    executeBuyPosition(mkt, amountEur);
}

function syncUiFromState() {
    const pulse = document.getElementById("agentPulse");
    const statusText = document.getElementById("agentStatusText");
    const btnToggle = document.getElementById("btnToggleAgent");

    if (state.agentActive) {
        pulse.classList.remove("paused");
        statusText.textContent = "AGENT AKTÍVNY";
        btnToggle.textContent = "⏸️ Pozastaviť agenta";
        btnToggle.className = "btn btn-primary";
    } else {
        pulse.classList.add("paused");
        statusText.textContent = "AGENT POZASTAVENÝ";
        btnToggle.textContent = "▶️ Spustiť agenta";
        btnToggle.className = "btn btn-success";
    }

    document.getElementById("chkIncludeCrypto").checked = !!state.includeCrypto;
    const packs = state.packs || DEFAULT_STATE.packs;
    if (document.getElementById("packTech")) document.getElementById("packTech").checked = !!packs.tech;
    if (document.getElementById("packMovers")) document.getElementById("packMovers").checked = !!packs.movers;
    if (document.getElementById("packSp500")) document.getElementById("packSp500").checked = !!packs.sp500;
    if (document.getElementById("packEtf")) document.getElementById("packEtf").checked = !!packs.etf;

    const modeBadge = document.getElementById("modeBadge");
    const modeMap = {
        simulator: "PAPER TRADING SIMULÁTOR (100 €)",
        trading212_paper: "TRADING 212 (PRACTICE API)",
        alpaca_paper: "ALPACA MARKETS (PAPER API)",
        trading212_live: "🔴 TRADING 212 LIVE",
        alpaca_live: "🔴 ALPACA LIVE"
    };
    modeBadge.textContent = modeMap[state.settings.executionMode] || "PAPER TRADING";
}

function addLog(msg, type = "info") {
    const box = document.getElementById("agentLogConsole");
    if (!box) return;
    const time = new Date().toLocaleTimeString("sk-SK");
    let color = "#f0f4f8";
    if (type === "success") color = "#10b981";
    else if (type === "warn") color = "#f59e0b";
    else if (type === "error") color = "#ef4444";

    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = `<span class="log-time">[${time}]</span> <span style="color:${color}">${msg}</span>`;
    box.prepend(div);

    while (box.children.length > 60) {
        box.removeChild(box.lastChild);
    }
}

function clearLogs() {
    document.getElementById("agentLogConsole").innerHTML = "";
}

function openSettingsModal() {
    document.getElementById("cfgExecutionMode").value = state.settings.executionMode;
    document.getElementById("cfgMarketHoursMode").value = state.settings.marketHoursMode;
    document.getElementById("cfgMaxPosEur").value = state.settings.maxPosEur;
    document.getElementById("cfgMaxPositions").value = state.settings.maxPositions;
    document.getElementById("cfgWatchlist").value = state.settings.watchlist;
    document.getElementById("cfgBrokerKey").value = state.settings.brokerKey || "";
    document.getElementById("cfgBrokerSecret").value = state.settings.brokerSecret || "";
    document.getElementById("settingsModal").classList.add("open");
}

function closeSettingsModal() {
    document.getElementById("settingsModal").classList.remove("open");
}

async function saveSettings() {
    state.settings.executionMode = document.getElementById("cfgExecutionMode").value;
    state.settings.marketHoursMode = document.getElementById("cfgMarketHoursMode").value;
    state.settings.maxPosEur = Number(document.getElementById("cfgMaxPosEur").value) || 25;
    state.settings.maxPositions = Number(document.getElementById("cfgMaxPositions").value) || 4;
    state.settings.watchlist = document.getElementById("cfgWatchlist").value;
    state.settings.brokerKey = document.getElementById("cfgBrokerKey").value.trim();
    state.settings.brokerSecret = document.getElementById("cfgBrokerSecret").value.trim();

    syncUiFromState();
    closeSettingsModal();
    await saveStateToServer();
    addLog("⚙️ Nastavenia agenta a watchlist boli uložené.", "info");
    runMarketCycle();
}

async function resetSimulatorAccount() {
    if (!confirm("Naozaj chcete zresetovať Paper Trading účet späť na 100.00 €? (Naučené váhy AI a pamäť akcií zostanú zachované)")) {
        return;
    }
    state.portfolio.cashEur = 100.00;
    state.portfolio.positions = [];
    state.portfolio.closedTrades = [];
    await saveStateToServer();
    renderAll();
    closeSettingsModal();
    addLog("🔄 Paper Trading účet bol zresetovaný na štartovacích 100.00 €.", "info");
}

async function testBrokerConnection() {
    const mode = document.getElementById("cfgExecutionMode").value;
    const apiKey = document.getElementById("cfgBrokerKey").value.trim();
    const apiSecret = document.getElementById("cfgBrokerSecret").value.trim();

    if (mode === "simulator") {
        alert("Aktuálne máte zvolený vstavaný Paper Trading Simulátor – nepotrebujete žiadne API kľúče, všetko beží rovno na živých dátach!");
        return;
    }
    if (!apiKey) {
        alert("Zadajte prosím API Key pre zvoleného brokera.");
        return;
    }

    const broker = mode.startsWith("trading212") ? "trading212" : "alpaca";
    const envMode = mode.endsWith("live") ? "live" : "paper";

    try {
        const res = await fetch("/api/broker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                broker,
                mode: envMode,
                action: "status",
                apiKey,
                apiSecret
            })
        });
        const data = await res.json();
        if (data.ok) {
            alert(`✅ Pripojenie k brokerovi (${broker.toUpperCase()} - ${envMode}) bolo ÚSPEŠNÉ!`);
            addLog(`🔌 Broker ${broker.toUpperCase()} (${envMode}) úspešne overený.`, "success");
        } else {
            alert(`❌ Chyba pripojenia k brokerovi: ${data.error}`);
        }
    } catch (e) {
        alert(`❌ Chyba komunikácie: ${e.message}`);
    }
}

async function forwardOrderToBroker(symbol, side, notionalUsd) {
    const mode = state.settings.executionMode;
    const broker = mode.startsWith("trading212") ? "trading212" : "alpaca";
    const envMode = mode.endsWith("live") ? "live" : "paper";

    try {
        const res = await fetch("/api/broker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                broker,
                mode: envMode,
                action: "order",
                apiKey: state.settings.brokerKey,
                apiSecret: state.settings.brokerSecret,
                symbol,
                side,
                notionalUsd
            })
        });
        const data = await res.json();
        if (data.ok) {
            addLog(`📡 Príkaz (${side.toUpperCase()} ${symbol}) odoslaný na ${broker.toUpperCase()} API.`, "success");
        } else {
            addLog(`⚠️ Broker API upozornenie: ${data.error}`, "warn");
        }
    } catch (e) {
        addLog(`⚠️ Zlyhalo odoslanie príkazu na brokera: ${e.message}`, "error");
    }
}
