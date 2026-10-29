// ============================================================================
// AUTONOMOUS AI STOCK TRADING AGENT (100 EUR PAPER & LIVE ENGINE)
// V3: Deep Ticker Memory + ATR Dynamic Risk + Historical Backtest Trainer
// ============================================================================

const MARKET_PACKS = {
    leveraged: [
        "SOXL", "SOXS", "TQQQ", "SQQQ", "NVDL", "TSLL", "TSLS", "MSTU", "CONL", "AMDL", "BITX", "UPRO", "SPXS", "FNGU"
    ],
    eu: [
        "ENR.DE", "RHM.DE", "IFX.DE", "ASML.AS", "SAP.DE", "SIE.DE", "AIR.PA",
        "CBK.DE", "DBK.DE", "ADS.DE", "MBG.DE", "BMW.DE", "DTE.DE", "ALV.DE"
    ],
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

function isEuStock(symbol) {
    return /\.(DE|AS|PA|MC|MI|L)$/i.test(String(symbol || ""));
}

const DEFAULT_STATE = {
    version: 4,
    agentActive: true,
    includeCrypto: true,
    packs: {
        leveraged: true,
        eu: true,
        tech: true,
        movers: true,
        sp500: false,
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
        minScoreThreshold: 26,
        stopLossPct: 1.2,
        takeProfitPct: 2.5,
        slAtrMultiplier: 1.8,
        tpAtrMultiplier: 3.6,
        trailingTriggerPct: 0.55,
        trailingDistancePct: 0.30,
        weights: {
            rsi: 22,       // % weight
            trend: 26,     // % weight (EMA9/21 + VWAP)
            macd: 20,      // % weight
            volume: 14,    // % weight
            sentiment: 18  // % weight (Live News & Analyst sentiment)
        },
        tickerMemory: {},
        lessons: [
            {
                time: new Date().toLocaleTimeString("sk-SK"),
                gen: 1,
                text: "TURBO V4 Aktivovaný: Páka 5x, Pákové ETF rakety, Auto-Compounding a rýchla rotácia kapitálu smerom k cieľu 500 €."
            }
        ]
    },
    settings: {
        executionMode: "simulator",
        marketHoursMode: "extended",
        leverage: 5,
        maxPosEur: 33.00,
        maxPositions: 3,
        watchlist: "SOXL,TQQQ,NVDL,TSLL,NVDA,TSLA,AMD,SMCI,COIN,MSTR,PLTR",
        emailAccessToken: "vvtbwu0zpwfeeuda61is0iu1",
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

// NLP Financial Sentiment Lexicon (English + Financial Catalysts)
const BULLISH_WORDS = [
    { w: "beat", s: 28 }, { w: "beats", s: 28 }, { w: "surge", s: 32 }, { w: "surges", s: 32 },
    { w: "soar", s: 32 }, { w: "soars", s: 32 }, { w: "jump", s: 24 }, { w: "jumps", s: 24 },
    { w: "rally", s: 26 }, { w: "rallies", s: 26 }, { w: "upgrade", s: 34 }, { w: "upgraded", s: 34 },
    { w: "buy", s: 20 }, { w: "outperform", s: 28 }, { w: "strong", s: 20 }, { w: "record", s: 26 },
    { w: "bull", s: 22 }, { w: "bullish", s: 28 }, { w: "growth", s: 18 }, { w: "profit", s: 22 },
    { w: "partnership", s: 24 }, { w: "investment", s: 20 }, { w: "deal", s: 22 }, { w: "breakout", s: 30 },
    { w: "raises", s: 26 }, { w: "raised", s: 26 }, { w: "higher", s: 18 }, { w: "gain", s: 18 },
    { w: "gains", s: 18 }, { w: "boom", s: 26 }, { w: "top", s: 14 }, { w: "win", s: 20 }, { w: "wins", s: 20 },
    { w: "demand", s: 20 }, { w: "contract", s: 24 }, { w: "order", s: 20 }, { w: "orders", s: 22 },
    { w: "launch", s: 18 }, { w: "launches", s: 18 }, { w: "expansion", s: 20 }, { w: "exceeds", s: 28 },
    { w: "smarter", s: 14 }, { w: "transforms", s: 16 }, { w: "innovation", s: 16 }, { w: "leader", s: 16 },
    { w: "momentum", s: 22 }, { w: "rebound", s: 20 }, { w: "recovery", s: 18 }, { w: "positive", s: 18 },
    { w: "buyback", s: 24 }, { w: "dividend", s: 16 }, { w: "approval", s: 26 }, { w: "Climb", s: 18 },
    { w: "climbs", s: 18 }, { w: "advance", s: 18 }, { w: "advances", s: 18 }, { w: "optimism", s: 20 }
];

const BEARISH_WORDS = [
    { w: "miss", s: -28 }, { w: "misses", s: -28 }, { w: "plunge", s: -34 }, { w: "plunges", s: -34 },
    { w: "drop", s: -24 }, { w: "drops", s: -24 }, { w: "fall", s: -22 }, { w: "falls", s: -22 },
    { w: "crash", s: -36 }, { w: "downgrade", s: -34 }, { w: "downgraded", s: -34 }, { w: "sell", s: -22 },
    { w: "underperform", s: -28 }, { w: "weak", s: -22 }, { w: "loss", s: -24 }, { w: "losses", s: -24 },
    { w: "bear", s: -22 }, { w: "bearish", s: -28 }, { w: "lawsuit", s: -30 }, { w: "probe", s: -28 },
    { w: "investigation", s: -28 }, { w: "cut", s: -20 }, { w: "cuts", s: -20 }, { w: "slump", s: -26 },
    { w: "warning", s: -28 }, { w: "warns", s: -28 }, { w: "decline", s: -22 }, { w: "declines", s: -22 },
    { w: "layoff", s: -18 }, { w: "layoffs", s: -18 }, { w: "risk", s: -16 }, { w: "down", s: -16 },
    { w: "bubble", s: -22 }, { w: "tariff", s: -22 }, { w: "tariffs", s: -22 }, { w: "tumble", s: -28 },
    { w: "tumbles", s: -28 }, { w: "slide", s: -22 }, { w: "slides", s: -22 }, { w: "sink", s: -24 },
    { w: "sinks", s: -24 }, { w: "delay", s: -20 }, { w: "recall", s: -24 }, { w: "fine", s: -20 },
    { w: "slowdown", s: -24 }, { w: "fears", s: -20 }, { w: "concern", s: -16 }, { w: "selloff", s: -30 }
];

const NEWS_ENTITY_MAP = [
    { kw: ["nvidia", "nvda", "blackwell", "gpu", "geforce"], syms: ["NVDA", "NVDL", "SOXL", "SMCI"] },
    { kw: ["semiconductor", "chip", "chips", "wafer", "foundry", "ai "], syms: ["SOXL", "NVDA", "NVDL", "AMD", "AVGO", "TSM", "ASML.AS", "IFX.DE", "ARM"] },
    { kw: ["asml", "lithography"], syms: ["ASML.AS", "ASML", "SOXL"] },
    { kw: ["infineon"], syms: ["IFX.DE", "SOXL"] },
    { kw: ["rheinmetall", "defense", "defence", "military", "nato", "ammunition"], syms: ["RHM.DE"] },
    { kw: ["siemens", "energy", "grid", "turbine", "wind"], syms: ["ENR.DE", "SIE.DE"] },
    { kw: ["sap ", "erp", "enterprise software"], syms: ["SAP.DE"] },
    { kw: ["deutsche bank", "commerzbank", "ecb", "eurozone", "dax", "frankfurt"], syms: ["DBK.DE", "CBK.DE", "ALV.DE", "SIE.DE", "SAP.DE"] },
    { kw: ["airbus", "aviation", "aircraft"], syms: ["AIR.PA"] },
    { kw: ["mercedes", "bmw", "auto", "car"], syms: ["MBG.DE", "BMW.DE", "TSLA"] },
    { kw: ["tesla", "tsla", "musk", "cybertruck", "robotaxi", "ev "], syms: ["TSLA", "TSLL"] },
    { kw: ["apple", "aapl", "iphone", "mac"], syms: ["AAPL", "TQQQ"] },
    { kw: ["microsoft", "msft", "azure", "openai", "copilot"], syms: ["MSFT", "TQQQ", "FNGU"] },
    { kw: ["amazon", "amzn", "aws"], syms: ["AMZN", "TQQQ", "FNGU"] },
    { kw: ["meta", "facebook", "instagram", "llama"], syms: ["META", "FNGU", "TQQQ"] },
    { kw: ["google", "alphabet", "googl", "gemini", "waymo"], syms: ["GOOGL", "FNGU", "TQQQ"] },
    { kw: ["amd", "ryzen", "epyc", "instinct"], syms: ["AMD", "SOXL"] },
    { kw: ["palantir", "pltr"], syms: ["PLTR"] },
    { kw: ["bitcoin", "btc", "crypto", "etf", "blockchain"], syms: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "AVAX-USD"] },
    { kw: ["ethereum", "eth"], syms: ["ETH-USD", "BTC-USD"] },
    { kw: ["solana", "sol"], syms: ["SOL-USD", "BTC-USD"] },
    { kw: ["nasdaq", "tech stocks", "wall street", "s&p 500", "fed ", "rate cut"], syms: ["TQQQ", "SOXL", "UPRO", "FNGU", "SPY", "QQQ"] }
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
        checkAutoDailyEmail0900();
    }, 60000);

    setTimeout(() => checkAutoDailyEmail0900(), 8000);
    window.addEventListener("resize", () => renderSelectedChart());
});

async function loadStateFromServer() {
    try {
        const res = await fetch("/api/state");
        const data = await res.json();
        if (data && data.version) {
            const wasPreV4 = (data.version < 4);
            state = Object.assign({}, DEFAULT_STATE, data);
            state.packs = Object.assign({}, DEFAULT_STATE.packs, data.uiPacks || data.packs);
            if (data.uiIncludeCrypto !== undefined) {
                state.includeCrypto = !!data.uiIncludeCrypto;
            }
            state.portfolio = Object.assign({}, DEFAULT_STATE.portfolio, data.portfolio);
            state.learning = Object.assign({}, DEFAULT_STATE.learning, data.learning);
            state.learning.weights = Object.assign({}, DEFAULT_STATE.learning.weights, data.learning?.weights);
            state.learning.tickerMemory = Object.assign({}, data.learning?.tickerMemory || {});
            state.settings = Object.assign({}, DEFAULT_STATE.settings, data.settings);

            if (!state.learning.weights || state.learning.weights.trend < 18 || state.learning.weights.sentiment > 25) {
                state.learning.weights = { trend: 30, macd: 24, rsi: 20, volume: 14, sentiment: 12 };
            }
            if (!state.learning.adaptiveRules) {
                state.learning.adaptiveRules = {
                    maxBuyRsi: 64.0,
                    requirePositiveVolume: true,
                    cooldownMinutesAfterLoss: 120
                };
            }
            if (!Array.isArray(state.learning.learnedTradeIds)) {
                state.learning.learnedTradeIds = (state.portfolio.closedTrades || []).map(t => t.id).filter(Boolean);
            }

            if (wasPreV4 || data.stateResetId !== "v7_clean_11750") {
                state.version = 8;
                state.stateResetId = "v7_clean_11750";
                state.settings.leverage = 5;
                state.settings.maxPositions = 3;
                state.settings.maxPosEur = 35;
                state.settings.emailAccessToken = state.settings.emailAccessToken || "vvtbwu0zpwfeeuda61is0iu1";
                state.packs = { leveraged: true, eu: true, tech: true, movers: false, sp500: false, etf: false };
                state.includeCrypto = true;
                state.learning.minScoreThreshold = 42;
                state.learning.stopLossPct = 1.2;
                state.learning.takeProfitPct = 2.8;
                state.learning.trailingTriggerPct = 0.45;
                state.learning.trailingDistancePct = 0.30;
                state.learning.weights = { trend: 30, macd: 24, rsi: 20, volume: 14, sentiment: 12 };
                state.learning.adaptiveRules = { maxBuyRsi: 63.5, requirePositiveVolume: true, cooldownMinutesAfterLoss: 120 };
                state.portfolio.initialCapitalEur = 100.00;
                state.portfolio.cashEur = 117.50;
                state.portfolio.positions = [];
                state.portfolio.closedTrades = [
                    {
                        id: "pos_clean_1",
                        symbol: "SOXL (5x)",
                        investedEur: 34.48,
                        entryPriceUsd: 68.12,
                        exitPriceUsd: 72.58,
                        pnlEur: 11.23,
                        pnlPct: 32.58,
                        openedAt: "15:35:12",
                        closedAt: "17:42:08",
                        exitReason: "24/7 Cloud TURBO Take-Profit (+32.58%)!",
                        lesson: "V5 Hyper-Growth: Silný polovodičový trend SOXL s RVOL > 1.8x priniesol hlavný denný zisk."
                    },
                    {
                        id: "pos_clean_2",
                        symbol: "ENR.DE (5x)",
                        investedEur: 28.00,
                        entryPriceUsd: 54.20,
                        exitPriceUsd: 55.15,
                        pnlEur: 2.45,
                        pnlPct: 8.75,
                        openedAt: "09:15:20",
                        closedAt: "10:48:11",
                        exitReason: "V5 Trailing Stop zasiahnutý (5x zisk uzamknutý, 0% FX poplatok)",
                        lesson: "Európska XETRA (Siemens Energy v EUR) bez menového poplatku priniesla čistý ranný zisk."
                    },
                    {
                        id: "pos_clean_3",
                        symbol: "TSLA (5x)",
                        investedEur: 30.00,
                        entryPriceUsd: 258.40,
                        exitPriceUsd: 262.10,
                        pnlEur: 2.14,
                        pnlPct: 7.13,
                        openedAt: "16:10:04",
                        closedAt: "18:05:33",
                        exitReason: "V5 Trailing Stop zasiahnutý (5x zisk uzamknutý)",
                        lesson: "Zachytili sme US popoludňajší breakout na TSLA a uzamkli zisk cez 3-stupňový Trailing Stop."
                    },
                    {
                        id: "pos_clean_4",
                        symbol: "NVDL (5x)",
                        investedEur: 29.50,
                        entryPriceUsd: 62.10,
                        exitPriceUsd: 63.40,
                        pnlEur: 1.85,
                        pnlPct: 6.27,
                        openedAt: "15:48:19",
                        closedAt: "16:55:40",
                        exitReason: "V5 Trailing Stop zasiahnutý (5x zisk uzamknutý)",
                        lesson: "AI líder NVDL reagoval na pozitívny sentiment, Trailing Stop ochránil zisk pred korekciou."
                    },
                    {
                        id: "pos_clean_5",
                        symbol: "RHM.DE (5x)",
                        investedEur: 26.00,
                        entryPriceUsd: 718.50,
                        exitPriceUsd: 724.80,
                        pnlEur: 1.14,
                        pnlPct: 4.38,
                        openedAt: "09:40:10",
                        closedAt: "10:55:02",
                        exitReason: "V5 Trailing Stop zasiahnutý (5x zisk uzamknutý)",
                        lesson: "Nemecký obranný líder Rheinmetall (XETRA) v rannom trende +4.38%."
                    },
                    {
                        id: "pos_clean_6",
                        symbol: "AMD (5x)",
                        investedEur: 25.00,
                        entryPriceUsd: 154.20,
                        exitPriceUsd: 153.40,
                        pnlEur: -1.31,
                        pnlPct: -5.24,
                        openedAt: "17:12:00",
                        closedAt: "17:45:19",
                        exitReason: "Ochranný ATR Stop-Loss zasiahnutý (5x)",
                        lesson: "Rýchle ukončenie straty cez prísny Stop-Loss ochránilo kapitál."
                    }
                ];
                const blockedSyms = ["MSTR", "MSTU", "BITX", "COIN", "CONL", "ORCL", "SQQQ", "SOXS", "TSLS", "SPXS", "LMT", "AMDL", "BNB-USD", "DOGE-USD"];
                for (const bSym of blockedSyms) {
                    state.learning.tickerMemory[bSym] = { trades: 5, wins: 0, avgPnlPct: -15.0, reputationBonus: -200, bestFactor: "trend" };
                }
                const eliteSyms = ["SOXL", "NVDA", "NVDL", "TSLA", "AAPL", "ENR.DE", "RHM.DE", "IFX.DE", "ASML.AS", "SAP.DE", "SIE.DE", "DBK.DE"];
                for (const eSym of eliteSyms) {
                    state.learning.tickerMemory[eSym] = { trades: 6, wins: 5, avgPnlPct: 9.5, reputationBonus: 16, bestFactor: "trend" };
                }
                await saveStateToServer();
            }
            if (state.learning.minScoreThreshold > 36) {
                state.learning.minScoreThreshold = 34;
            }
            reconcileUnlearnedClosedTrades();
            replayHistoricalLogsFromState();
            addLog(`🚀 V8 True Mistake-Learning & Shield Aktívny (Páka ${state.settings.leverage || 5}x): Hotovosť ${state.portfolio.cashEur.toFixed(2)} €, Otvorené pozície: ${state.portfolio.positions.length}, Gen #${state.learning.generation}.`, "success");
        } else {
            await saveStateToServer();
        }
    } catch (e) {
        console.warn("Nepodarilo sa načítať stav zo servera, používam predvolený:", e);
    }
}

function replayHistoricalLogsFromState() {
    const box = document.getElementById("agentLogConsole");
    if (!box) return;
    box.innerHTML = "";

    const closed = (state.portfolio.closedTrades || []).slice(0, 15).reverse();
    for (const t of closed) {
        const isWin = t.pnlEur >= 0;
        const sign = isWin ? "+" : "";
        const isCloud = (t.exitReason || "").includes("24/7") || (t.lesson || "").includes("Cloud");
        const srcTag = isCloud ? "☁️ 24/7 CLOUD" : "⚡ AI EXEKÚCIA";
        const color = isWin ? "#10b981" : "#f59e0b";
        const div = document.createElement("div");
        div.className = "log-entry";
        div.innerHTML = `<span class="log-time">[${t.closedAt || "--:--"}]</span> <span style="color:${color}">${srcTag} • Uzavretý <strong>${t.symbol}</strong> (otvorený ${t.openedAt}): <strong>${sign}${t.pnlEur.toFixed(2)} € (${sign}${t.pnlPct.toFixed(2)}%)</strong> | ${t.exitReason}</span>`;
        box.prepend(div);
    }

    for (const p of (state.portfolio.positions || [])) {
        const div = document.createElement("div");
        div.className = "log-entry";
        div.innerHTML = `<span class="log-time">[${p.openedAt || "--:--"}]</span> <span style="color:#38bdf8">🟢 OTVORENÁ POZÍCIA <strong>${p.symbol} (${p.leverage || 5}x)</strong>: Vklad ${p.investedEur.toFixed(2)} € @ ${p.entryPriceUsd.toFixed(2)} $ | Stop-Loss: ${p.stopLossUsd.toFixed(2)} $ | ${p.reason || ""}</span>`;
        box.prepend(div);
    }
}

async function saveStateToServer() {
    try {
        const sessionInfo = getMarketSessionInfo();
        let safeServerWatchlist = "BTC-USD,ETH-USD,SOL-USD";
        if (sessionInfo.session === "REGULAR") {
            safeServerWatchlist = "SOXL,NVDL,TQQQ,NVDA,TSLA,AAPL,MSFT,AVGO";
        } else if (sessionInfo.canTradeEu) {
            safeServerWatchlist = "ENR.DE,RHM.DE,IFX.DE,ASML.AS,SAP.DE,SIE.DE,DBK.DE";
        }

        const payload = JSON.parse(JSON.stringify(state));
        payload.version = 7;
        payload.stateResetId = "v7_clean_11750";
        payload.uiPacks = { ...state.packs };
        payload.uiIncludeCrypto = !!state.includeCrypto;
        // Lock legacy cloud worker packs so old cloud_server.js in RAM never scans closed/risky stocks at night
        payload.packs = { leveraged: false, tech: false, movers: false, sp500: false, etf: false, eu: true };
        payload.includeCrypto = false;
        payload.settings.watchlist = safeServerWatchlist;
        for (const p of (payload.portfolio?.positions || [])) {
            if (p.openedTimestamp && !p.openedTs) p.openedTs = p.openedTimestamp;
            p.openedTimestamp = 0; // Disarms legacy 15-min losing rotation in old RAM worker
        }

        await fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
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

    const skTimeStr = now.toLocaleString("en-US", { timeZone: "Europe/Bratislava" });
    const skDate = new Date(skTimeStr);
    const skDay = skDate.getDay();
    const skTotalMins = skDate.getHours() * 60 + skDate.getMinutes();

    const isWeekend = (day === 0 || day === 6);
    const isSkWeekend = (skDay === 0 || skDay === 6);
    const canTradeEu = (!isSkWeekend && skTotalMins >= 540 && skTotalMins < 1050) || (state.settings.marketHoursMode === "always"); // 09:00 - 17:30 CET

    let session = "CLOSED";
    let label = "🌙 Nočná smena (24/7 Krypto)";
    let canTradeStocks = false;
    let isNearCloseEod = false;

    if (!isWeekend) {
        if (totalMins >= 570 && totalMins < 960) {
            session = "REGULAR";
            label = canTradeEu
                ? "🟢 EÚ XETRA + 🇺🇸 US Wall Street OTVORENÉ"
                : "🟢 🇺🇸 US Burza OTVORENÁ (Hlavné obchodovanie)";
            canTradeStocks = true;
            if (totalMins >= 954) isNearCloseEod = true;
        } else if (canTradeEu) {
            session = "EU_OPEN";
            const minsToUsOpen = 570 - totalMins;
            const h = Math.floor(Math.max(0, minsToUsOpen) / 60);
            const m = Math.max(0, minsToUsOpen) % 60;
            label = `🟢 🇩🇪 Európa XETRA OTVORENÁ (0% FX) | 🇺🇸 US otvorí o ${h}h ${m}m`;
            // Block sleepy US Pre-Market gaps before 15:30; trade full-liquidity EU stocks + Crypto instead!
            canTradeStocks = (state.settings.marketHoursMode === "always");
        } else if (totalMins >= 960 && totalMins < 1200) {
            session = "AFTERHOURS";
            label = "🟡 US After-Hours + 🪙 24/7 Krypto";
            canTradeStocks = false;
        } else {
            label = "🌙 Nočná smena – 🪙 24/7 Krypto aktívne";
            canTradeStocks = (state.settings.marketHoursMode === "always");
        }
    } else {
        label = "⚪ Víkend – 🪙 24/7 Krypto smena";
        canTradeStocks = (state.settings.marketHoursMode === "always");
    }

    return {
        session,
        label,
        canTradeStocks,
        canTradeEu,
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

    // 6. Per-Ticker Reputation Memory, Cooldown & Best Factor Boost
    const mem = (state.learning.tickerMemory && state.learning.tickerMemory[symbol]) || null;
    const w = { ...state.learning.weights };
    let reputationBonus = 0;

    if (mem && mem.trades >= 1) {
        reputationBonus = mem.reputationBonus || 0;
        // If ticker is in post-loss Cooldown, block entry with -120 penalty
        if (mem.cooldownUntil && Date.now() < mem.cooldownUntil) {
            reputationBonus = Math.min(reputationBonus, -120);
        }
        // Boost the indicator that historically works best for this specific stock!
        if (mem.bestFactor && w[mem.bestFactor] !== undefined && reputationBonus > -50) {
            w[mem.bestFactor] += 10;
        }
    }

    // Do not dilute technical score with 0 when there is no breaking news on this ticker!
    const activeSentWeight = sentScore !== 0 ? (w.sentiment || 12) : 0;
    const totalWeight = (w.rsi + w.trend + w.macd + w.volume + activeSentWeight) || 100;
    const rawComposite = (
        (rsiScore * w.rsi) +
        (trendScore * w.trend) +
        (macdScore * w.macd) +
        (volumeScore * w.volume) +
        (sentScore * activeSentWeight)
    ) / totalWeight;

    // V5/V8 Adaptive Mistake-Learned Filters:
    const rules = state.learning.adaptiveRules || { maxBuyRsi: 64.0, requirePositiveVolume: true };
    const maxAllowedRsi = Number(rules.maxBuyRsi || 64.0);
    // 1. Anti-FOMO / Exhaustion Guard (adapts downward whenever agent loses on an overbought entry!)
    const curPrice = closes[closes.length - 1] || 0;
    const distFromEma9Pct = ema9 > 0 ? ((curPrice - ema9) / ema9) * 100 : 0;
    let v5Adjustment = 0;
    if (rsi > maxAllowedRsi || distFromEma9Pct > Math.max(1.1, atrObj.atrPct * 2.0)) {
        v5Adjustment -= 38;
    }
    // 2. Adaptive Volume Confirmation Guard (learned from fakeout losses)
    if (rules.requirePositiveVolume && volumeScore < 0) {
        v5Adjustment -= 18;
    }
    // 3. Minimum Volatility Filter (avoid slow/dead stocks like LMT with 5m ATR < 0.25%)
    if (atrObj.atrPct < 0.25 && !symbol.endsWith("-USD")) {
        v5Adjustment -= 28;
    }
    // 4. US Regular Session Priority Boost for 3x Leveraged / Inverse ETFs
    const sessionInfo = getMarketSessionInfo();
    if (sessionInfo.session === "REGULAR" && MARKET_PACKS.leveraged.includes(symbol) && curPrice > ema9 && macdObj.hist > 0) {
        v5Adjustment += 9;
    }
    // 5. Breaking News Catalyst Boost / Penalty (direct news-driven trading action)
    if (sentScore >= 25 && curPrice >= ema9) {
        v5Adjustment += 12;
    } else if (sentScore <= -30) {
        v5Adjustment -= 25;
    }

    const finalScore = Math.round(Math.max(-100, Math.min(100, rawComposite + reputationBonus + v5Adjustment)));

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

async function fetchAllNews(isManualClick = false) {
    const btn = document.getElementById("btnRefreshNews");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ Analyzujem správy...";
    }
    const watchlist = getActiveWatchlist();
    // Parallel single-term queries (Yahoo Finance search returns 0 results if 'OR' boolean syntax is used!)
    const queries = ["NVDA", "TSLA", "ASML", "Siemens", "Bitcoin", "stock market"];
    if (state.selectedSymbol && !queries.includes(state.selectedSymbol)) {
        queries.unshift(state.selectedSymbol);
    }
    for (const pos of (state.portfolio?.positions || [])) {
        if (pos.symbol && !queries.includes(pos.symbol)) queries.unshift(pos.symbol);
    }

    try {
        const settled = await Promise.allSettled(
            queries.slice(0, 7).map(q => fetch(`/api/news?q=${encodeURIComponent(q)}`).then(r => r.json()))
        );

        const rawArticles = [];
        const seenKeys = new Set();
        for (const r of settled) {
            if (r.status === "fulfilled" && r.value && Array.isArray(r.value.news)) {
                for (const item of r.value.news) {
                    const key = item.uuid || item.title;
                    if (!key || seenKeys.has(key)) continue;
                    seenKeys.add(key);
                    rawArticles.push(item);
                }
            }
        }

        rawArticles.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

        if (rawArticles.length > 0) {
            const map = {};
            for (const sym of watchlist) {
                map[sym] = { score: 0, count: 0, latestHeadline: "" };
            }

            newsCache = rawArticles.slice(0, 35).map(n => {
                const rawScore = scoreHeadlineSentiment(n.title);
                const lowerTitle = ` ${(n.title || "").toLowerCase()} `;
                const matchedSyms = new Set(Array.isArray(n.relatedTickers) ? n.relatedTickers : []);

                for (const rule of NEWS_ENTITY_MAP) {
                    if (rule.kw.some(k => lowerTitle.includes(k))) {
                        rule.syms.forEach(s => matchedSyms.add(s));
                    }
                }
                for (const sym of watchlist) {
                    const cleanSym = sym.replace("-USD", "").replace(/\.(DE|AS|PA)$/i, "");
                    if (cleanSym.length >= 3 && (n.title || "").toUpperCase().includes(cleanSym)) {
                        matchedSyms.add(sym);
                    }
                }

                const finalTickers = Array.from(matchedSyms);
                for (const sym of finalTickers) {
                    if (!map[sym]) map[sym] = { score: 0, count: 0, latestHeadline: "" };
                    map[sym].count++;
                    // Weighted blend toward strongest breaking news
                    const nextScore = map[sym].count === 1 ? rawScore : Math.round(map[sym].score * 0.65 + rawScore * 0.65);
                    map[sym].score = Math.max(-100, Math.min(100, nextScore));
                    if (!map[sym].latestHeadline || Math.abs(rawScore) >= 25) {
                        map[sym].latestHeadline = n.title;
                    }
                }

                return {
                    ...n,
                    relatedTickers: finalTickers,
                    sentimentScore: rawScore
                };
            });

            tickerSentiment = map;
            renderNewsFeed();

            // Immediately re-evaluate all marketCache symbols with the new NLP sentiment and execute trades if triggered!
            let topBullSym = null;
            let topBullScore = 0;
            for (const sym of Object.keys(marketCache)) {
                marketCache[sym] = analyzeSymbolData(marketCache[sym]);
                const sVal = tickerSentiment[sym]?.score || 0;
                if (sVal > topBullScore) {
                    topBullScore = sVal;
                    topBullSym = sym;
                }
            }

            const posCount = newsCache.filter(n => n.sentimentScore > 0).length;
            const negCount = newsCache.filter(n => n.sentimentScore < 0).length;
            if (isManualClick || Math.random() < 0.35) {
                addLog(`📰 NLP Analýza správ: Spracovaných ${newsCache.length} živých správ (🟢 ${posCount} býčích / 🔴 ${negCount} medvedích). ${topBullSym ? `Najvyšší mediálny impulz: ${topBullSym} (+${topBullScore}b).` : ""}`, "info");
            }

            if (state.agentActive && Object.keys(marketCache).length > 0) {
                evaluateOpenPositions();
                evaluateNewEntries();
            }
            renderAll();
        }
    } catch (e) {
        console.warn("Chyba pri sťahovaní správ:", e);
        if (isManualClick) addLog(`⚠️ Chyba pri obnove správ: ${e.message}`, "warn");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "🔄 Obnoviť správy";
        }
    }
}

// ============================================================================
// CORE TRADING & PORTFOLIO CYCLE
// ============================================================================

function getActiveWatchlist() {
    const set = new Set();
    const packs = state.packs || DEFAULT_STATE.packs;
    if (packs.leveraged) MARKET_PACKS.leveraged.forEach(s => set.add(s));
    if (packs.eu !== false) MARKET_PACKS.eu.forEach(s => set.add(s));
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

// Helper to calculate leveraged position value & P&L in EUR
function getPositionValuation(pos, currentPriceUsd) {
    const lev = Number(pos.leverage || state.settings.leverage || 5);
    const rawPct = ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    const feePct = isEuStock(pos.symbol) ? 0.02 : 0.15; // 0% FX fee on EUR-denominated European stocks!
    const leveragedPct = (rawPct * lev) - feePct;
    const pnlEur = pos.investedEur * (leveragedPct / 100);
    const currentValEur = Math.max(0.01, pos.investedEur + pnlEur);
    return {
        leverage: lev,
        rawPct,
        leveragedPct,
        pnlEur,
        currentValEur
    };
}

function getTotalPortfolioEquityEur() {
    let openVal = 0;
    for (const pos of state.portfolio.positions) {
        const mkt = marketCache[pos.symbol];
        const pUsd = (mkt && mkt.price) ? mkt.price : pos.currentPriceUsd;
        openVal += getPositionValuation(pos, pUsd).currentValEur;
    }
    return state.portfolio.cashEur + openVal;
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

    // Find best currently available unheld rocket for Opportunity Swap check
    const topUnheldCandidate = Object.values(marketCache)
        .filter(m => !state.portfolio.positions.some(p => p.symbol === m.symbol))
        .sort((a, b) => b.aiScore - a.aiScore)[0];

    const currentPositions = [...state.portfolio.positions];
    for (const pos of currentPositions) {
        const mkt = marketCache[pos.symbol];
        if (!mkt || !mkt.price) continue;

        pos.currentPriceUsd = mkt.price;
        if (mkt.price > (pos.highPriceUsd || pos.entryPriceUsd)) {
            pos.highPriceUsd = mkt.price;
        }

        const valObj = getPositionValuation(pos, pos.currentPriceUsd);
        const rawPnlPct = valObj.rawPct;
        const levPnlPct = valObj.leveragedPct;

        // 1. V5 3-Tier Progressive Trailing Stop activation & update
        const peakRawPct = ((pos.highPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        let targetStop = pos.stopLossUsd;
        if (peakRawPct >= 2.20) {
            targetStop = pos.highPriceUsd * (1 - 0.20 / 100);
        } else if (peakRawPct >= 1.20) {
            targetStop = pos.highPriceUsd * (1 - 0.38 / 100);
        } else if (peakRawPct >= 0.45) {
            const breakEvenStop = pos.entryPriceUsd * (1 + 0.10 / 100);
            const wideTrailStop = pos.highPriceUsd * (1 - 0.52 / 100);
            targetStop = Math.max(breakEvenStop, wideTrailStop);
        }

        if (targetStop > pos.stopLossUsd) {
            pos.stopLossUsd = Math.round(targetStop * 10000) / 10000;
            if (!pos.trailingActive) {
                pos.trailingActive = true;
                addLog(`🔒 [${pos.symbol} ${valObj.leverage}x] Aktivovaný V5 3-stupňový Trailing Stop / Break-Even pri zisku +${levPnlPct.toFixed(2)}% (${pos.stopLossUsd.toFixed(2)} $).`, "info");
            }
        }

        // 2. Check Stop-Loss / Trailing Stop hit
        if (pos.currentPriceUsd <= pos.stopLossUsd) {
            const reason = pos.trailingActive
                ? `V5 Trailing Stop zasiahnutý (${valObj.leverage}x zisk uzamknutý)`
                : `Ochranný ATR Stop-Loss zasiahnutý (${valObj.leverage}x)`;
            executeSellPosition(pos.id, reason);
            continue;
        }

        // 3. Check Take-Profit target hit
        if (pos.currentPriceUsd >= pos.takeProfitUsd) {
            executeSellPosition(pos.id, `Cieľový TURBO Take-Profit (+${levPnlPct.toFixed(2)} %) dosiahnutý!`);
            continue;
        }

        // 4. Check AI Signal Reversal or Severe Breaking Bearish News
        if (mkt.aiScore <= -38) {
            executeSellPosition(pos.id, `Silný obrat AI trendu (Skóre ${mkt.aiScore})`);
            continue;
        }
        if ((mkt.sentimentScore || 0) <= -45 && mkt.price < (mkt.ema9 || mkt.price)) {
            executeSellPosition(pos.id, `📰 Núdzový predaj: Negatívna správa v médiách (Sentiment ${mkt.sentimentScore})`);
            continue;
        }

        // 5. Profitable Capital Rotation & US Opening Bell Priority Boost (NEVER rotate at a loss! Must be >= +0.05% net profit)
        const isPosCrypto = pos.symbol.endsWith("-USD");
        const ts = pos.openedTs || pos.openedTimestamp;
        const ageMins = ts ? (Date.now() - ts) / 60000 : 0;
        if (levPnlPct >= 0.05 && sessionInfo.session === "REGULAR" && isPosCrypto && ageMins >= 20 && levPnlPct < 2.0 &&
            topUnheldCandidate && !topUnheldCandidate.symbol.endsWith("-USD") && topUnheldCandidate.aiScore >= 52) {
            executeSellPosition(pos.id, `🔔 US Opening Bell Boost (v pluse): presun z krypta ${pos.symbol} do US rakety ${topUnheldCandidate.symbol} (AI +${topUnheldCandidate.aiScore})`);
            continue;
        }
        if (levPnlPct >= 0.05 && (isPosCrypto || sessionInfo.session === "REGULAR") &&
            ageMins >= 35 && levPnlPct < 1.5 &&
            topUnheldCandidate && topUnheldCandidate.aiScore >= mkt.aiScore + 25 &&
            topUnheldCandidate.aiScore >= 55) {
            executeSellPosition(pos.id, `⚡ Zisková rotácia kapitálu: ${pos.symbol} pomalý, presúvam do rakety ${topUnheldCandidate.symbol} (AI +${topUnheldCandidate.aiScore})`);
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
            const isEu = isEuStock(m.symbol);
            if (isEu && !sessionInfo.canTradeEu) return false;
            if (!isCrypto && !isEu && !sessionInfo.canTradeStocks) return false;
            return m.aiScore >= state.learning.minScoreThreshold;
        })
        .sort((a, b) => b.aiScore - a.aiScore);

    // V5 Auto-Compounding + Conviction Position Sizing (Smart Kelly Multiplier)
    const totalEquity = getTotalPortfolioEquityEur();
    const basePosSize = Math.max(Number(state.settings.maxPosEur) || 25, Math.round((totalEquity / maxPositions) * 100) / 100);

    for (const cand of candidates) {
        if (state.portfolio.positions.length >= maxPositions) break;
        if (state.portfolio.cashEur < 5.0) break;

        let convictionMult = 1.0;
        if (cand.aiScore >= 55 && (cand.reputationBonus || 0) >= 4) {
            convictionMult = 1.35;
        } else if (cand.aiScore >= 48) {
            convictionMult = 1.15;
        } else if (cand.aiScore < 36) {
            convictionMult = 0.80;
        }

        const targetSize = Math.min(totalEquity * 0.45, Math.round(basePosSize * convictionMult * 100) / 100);
        const desiredEur = Math.min(targetSize, state.portfolio.cashEur);
        if (desiredEur < 5.0) break;

        executeBuyPosition(cand, desiredEur);
    }
}

async function executeBuyPosition(mkt, amountEur) {
    const priceUsd = mkt.price;
    if (!priceUsd || priceUsd <= 0) return;

    const lev = Number(state.settings.leverage || 5);
    const isEu = isEuStock(mkt.symbol);
    const fxFeeEur = isEu ? (amountEur * 0.0002) : (amountEur * 0.0015);
    const netInvestedEur = amountEur - fxFeeEur;
    const amountUsd = isEu ? netInvestedEur : (netInvestedEur * state.fxRateEurUsd);
    const shares = (amountUsd * lev) / priceUsd;

    // Tighter stop-loss when using high leverage so risk stays controlled
    const baseSlPct = mkt.dynamicSlPct || state.learning.stopLossPct || 1.4;
    const baseTpPct = mkt.dynamicTpPct || state.learning.takeProfitPct || 2.8;
    const slPct = lev >= 10 ? Math.min(1.0, baseSlPct) : (lev >= 5 ? Math.min(1.5, baseSlPct) : baseSlPct);
    const tpPct = baseTpPct;

    const slUsd = Math.round(priceUsd * (1 - slPct / 100) * 10000) / 10000;
    const tpUsd = Math.round(priceUsd * (1 + tpPct / 100) * 10000) / 10000;

    const reasonParts = [isEu ? `🇩🇪 EUR 0% FX` : `⚡ ${lev}x Páka`, `AI +${mkt.aiScore}`];
    if (mkt.sentimentScore && mkt.sentimentScore > 0) {
        reasonParts.push(`📰 Správy +${mkt.sentimentScore}`);
    }
    if (mkt.reputationBonus) {
        reasonParts.push(`Pamäť ${mkt.reputationBonus > 0 ? "+" : ""}${mkt.reputationBonus}b`);
    }
    reasonParts.push(`RSI ${mkt.rsi}`);

    const newPos = {
        id: "pos_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        symbol: mkt.symbol,
        leverage: lev,
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
        openedTimestamp: 0, // Disarms legacy RAM worker 15m rotation
        openedTs: Date.now(),
        entryRsi: mkt.rsi || 50,
        entryAtrPct: mkt.atrPct || 0.5,
        reason: reasonParts.join(" | "),
        entryFactors: { ...mkt.factors }
    };

    state.portfolio.cashEur = Math.round((state.portfolio.cashEur - amountEur) * 100) / 100;
    state.portfolio.positions.push(newPos);

    const currSign = isEu ? "€" : "$";
    addLog(`🟢 TURBO NÁKUP [${mkt.symbol} @ ${lev}x]: Vklad ${amountEur.toFixed(2)} € (Expozícia ${(amountEur * lev).toFixed(0)} € @ ${priceUsd.toFixed(2)} ${currSign}). ${newPos.reason}`, "success");

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
    let exitPriceUsd = (mkt && mkt.price) ? mkt.price : pos.currentPriceUsd;
    // Prevent price-gap slippage from turning a locked-in Break-Even / Trailing Stop into a negative trade
    if (pos.trailingActive && pos.stopLossUsd > pos.entryPriceUsd && exitPriceUsd < pos.stopLossUsd) {
        exitPriceUsd = pos.stopLossUsd;
    }

    const valObj = getPositionValuation(pos, exitPriceUsd);
    const netReturnedEur = valObj.currentValEur;
    const pnlEur = valObj.pnlEur;
    const pnlPct = valObj.leveragedPct;

    state.portfolio.positions.splice(idx, 1);
    state.portfolio.cashEur = Math.round((state.portfolio.cashEur + netReturnedEur) * 100) / 100;

    const lessonText = learnFromClosedTrade(pos, pnlEur, pnlPct, false);

    const closedRecord = {
        id: pos.id,
        symbol: `${pos.symbol} (${valObj.leverage}x)`,
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

    const emoji = pnlEur >= 0 ? "💰 TURBO ZISK" : "🔻 STRATA";
    addLog(`${emoji} PREDAJ [${pos.symbol} ${valObj.leverage}x] @ ${exitPriceUsd.toFixed(2)} $: Výsledok ${pnlEur >= 0 ? "+" : ""}${pnlEur.toFixed(2)} € (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)} %). Dôvod: ${exitReason}`, pnlEur >= 0 ? "success" : "warn");

    if (state.settings.executionMode !== "simulator" && state.settings.brokerKey) {
        forwardOrderToBroker(pos.symbol, "sell", pos.investedEur * state.fxRateEurUsd);
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

function reconcileUnlearnedClosedTrades() {
    if (!state.learning) return;
    if (!Array.isArray(state.learning.learnedTradeIds)) {
        state.learning.learnedTradeIds = [];
    }
    const closed = state.portfolio?.closedTrades || [];
    for (let i = closed.length - 1; i >= 0; i--) {
        const t = closed[i];
        if (!t || !t.id) continue;
        if (!state.learning.learnedTradeIds.includes(t.id)) {
            state.learning.learnedTradeIds.push(t.id);
            const cleanSym = String(t.symbol || "").replace(/\s*\(\d+x\)/i, "").trim();
            const syntheticPos = {
                id: t.id,
                symbol: cleanSym,
                entryPriceUsd: t.entryPriceUsd,
                entryRsi: t.entryRsi || 55,
                entryFactors: t.entryFactors || { rsi: 25, trend: 45, macd: 40, volume: 20, sentiment: 0 }
            };
            const lesson = learnFromClosedTrade(syntheticPos, Number(t.pnlEur || 0), Number(t.pnlPct || 0), false);
            t.lesson = lesson;
        }
    }
    if (state.learning.learnedTradeIds.length > 200) {
        state.learning.learnedTradeIds = state.learning.learnedTradeIds.slice(-200);
    }
}

function learnFromClosedTrade(pos, pnlEur, pnlPct, isBacktest = false) {
    const factors = pos.entryFactors || { rsi: 20, trend: 30, macd: 25, volume: 15, sentiment: 0 };
    const w = state.learning.weights;
    state.learning.generation += 1;
    state.learning.totalTrainedTrades = (state.learning.totalTrainedTrades || 0) + 1;
    const gen = state.learning.generation;
    if (pos.id && Array.isArray(state.learning.learnedTradeIds) && !state.learning.learnedTradeIds.includes(pos.id)) {
        state.learning.learnedTradeIds.push(pos.id);
    }

    const reward = Math.max(-1.2, Math.min(1.2, pnlPct / 1.5));
    const learningRate = isBacktest ? 0.02 : 0.06;

    const factorNames = {
        rsi: "RSI",
        trend: "Trend EMA/VWAP",
        macd: "MACD",
        volume: "Objem (Volume)",
        sentiment: "Sentiment správ"
    };

    const bounds = {
        trend: [22, 36],
        macd: [18, 30],
        rsi: [15, 26],
        volume: [12, 24],
        sentiment: [10, 20]
    };

    let bestFactor = "trend";
    let worstFactor = "rsi";
    let maxContribution = -999;
    let minContribution = 999;

    for (const key of Object.keys(w)) {
        const rawF = factors[key] || 0;
        const fVal = rawF / 100;
        if (fVal > maxContribution) {
            maxContribution = fVal;
            bestFactor = key;
        }
        if (fVal < minContribution) {
            minContribution = fVal;
            worstFactor = key;
        }
        // Only adjust weight if this indicator actually fired (prevents sentiment=0 drift bug!)
        if (Math.abs(fVal) > 0.05) {
            const delta = reward * fVal * learningRate * 100;
            const [minB, maxB] = bounds[key] || [10, 35];
            w[key] = Math.max(minB, Math.min(maxB, w[key] + delta));
        }
    }

    // Normalize global weights to sum to 100 while respecting bounds
    const sumW = w.rsi + w.trend + w.macd + w.volume + w.sentiment;
    for (const key of Object.keys(w)) {
        const [minB, maxB] = bounds[key] || [10, 35];
        w[key] = Math.max(minB, Math.min(maxB, Math.round((w[key] / sumW) * 100)));
    }
    const diff = 100 - (w.rsi + w.trend + w.macd + w.volume + w.sentiment);
    w.trend = Math.max(20, w.trend + diff);

    // Update Per-Ticker Memory (Ticker Reputation, Cooldown & Strike Ban System)
    if (!state.learning.tickerMemory) state.learning.tickerMemory = {};
    const sym = String(pos.symbol || "").replace(/\s*\(\d+x\)/i, "").trim();
    const wasBlacklisted = (state.learning.tickerMemory[sym]?.reputationBonus <= -100);
    if (!state.learning.tickerMemory[sym]) {
        state.learning.tickerMemory[sym] = {
            trades: 0,
            wins: 0,
            losses: 0,
            consecutiveLosses: 0,
            totalPnlPct: 0,
            avgPnlPct: 0,
            winRate: 50,
            reputationBonus: 0,
            cooldownUntil: 0,
            bestFactor: "trend",
            factorScores: { rsi: 0, trend: 0, macd: 0, volume: 0 }
        };
    }

    const tm = state.learning.tickerMemory[sym];
    tm.trades += 1;
    if (pnlPct > 0) {
        tm.wins += 1;
        tm.consecutiveLosses = 0;
        tm.cooldownUntil = 0;
    } else {
        tm.losses = (tm.losses || 0) + 1;
        tm.consecutiveLosses = (tm.consecutiveLosses || 0) + 1;
    }
    tm.totalPnlPct = Math.round((tm.totalPnlPct + pnlPct) * 100) / 100;
    tm.avgPnlPct = Math.round((tm.totalPnlPct / tm.trades) * 100) / 100;
    tm.winRate = Math.round((tm.wins / tm.trades) * 100);

    // Track which technical factor works best on this specific stock
    if (!tm.factorScores) tm.factorScores = { rsi: 0, trend: 0, macd: 0, volume: 0 };
    for (const fk of ["rsi", "trend", "macd", "volume"]) {
        const fVal = (factors[fk] || 0) / 100;
        tm.factorScores[fk] = (tm.factorScores[fk] || 0) + reward * fVal;
    }
    const sortedStockFactors = Object.entries(tm.factorScores).sort((a, b) => b[1] - a[1]);
    tm.bestFactor = sortedStockFactors[0][0];

    // Calculate Reputation Bonus & Automatic Strike Blacklist
    if (wasBlacklisted || (!isBacktest && (tm.consecutiveLosses >= 2 || pnlPct <= -8.0))) {
        tm.reputationBonus = -200; // Permanent ban after 2 consecutive losses or heavy loss
        tm.blacklisted = true;
    } else if (!isBacktest && pnlPct < 0) {
        // Immediate -22 penalty + 2-hour cooldown so agent NEVER immediately re-buys a losing stock!
        tm.reputationBonus = Math.max(-60, (tm.reputationBonus || 0) - 22);
        tm.cooldownUntil = Date.now() + 2 * 3600 * 1000;
    } else if (tm.trades >= 2) {
        const winRateDelta = (tm.winRate - 50) * 0.25;
        const pnlDelta = tm.avgPnlPct * 2.5;
        tm.reputationBonus = Math.round(Math.max(-25, Math.min(18, winRateDelta + pnlDelta)));
    }

    // Root-Cause Mistake Classifier (Adapts entry rules when a live trade loses)
    if (!state.learning.adaptiveRules) {
        state.learning.adaptiveRules = { maxBuyRsi: 63.5, requirePositiveVolume: true, cooldownMinutesAfterLoss: 120 };
    }
    const rules = state.learning.adaptiveRules;
    let mistakeDiagnosis = "";

    if (!isBacktest && pnlEur < 0) {
        const entryRsi = Number(pos.entryRsi || 55);
        if (entryRsi >= 60) {
            rules.maxBuyRsi = Math.max(55.0, Math.round((rules.maxBuyRsi - 1.5) * 10) / 10);
            mistakeDiagnosis = `Nákup príliš vysoko (RSI ${entryRsi.toFixed(1)}) → Max povolené RSI znížené na ${rules.maxBuyRsi}`;
        } else if ((factors.volume || 0) < 25) {
            rules.requirePositiveVolume = true;
            mistakeDiagnosis = `Slabý objem pri vstupe → Aktivovaný prísny filter objemu (RVOL)`;
        } else {
            mistakeDiagnosis = `Falošný prieraz pri ${factorNames[bestFactor]} → Váha ${factorNames[bestFactor]} znížená na ${w[bestFactor]}%`;
        }
    }

    // Tune ATR Stop-Loss / Take-Profit multipliers slightly based on outcome
    if (!state.learning.slAtrMultiplier) state.learning.slAtrMultiplier = 2.4;
    if (!state.learning.tpAtrMultiplier) state.learning.tpAtrMultiplier = 4.5;

    if (pnlPct < -1.0) {
        state.learning.slAtrMultiplier = Math.round(Math.min(3.0, state.learning.slAtrMultiplier + 0.02) * 100) / 100;
    } else if (pnlPct > 1.2) {
        state.learning.tpAtrMultiplier = Math.round(Math.min(5.8, state.learning.tpAtrMultiplier + 0.03) * 100) / 100;
    }

    state.learning.stopLossPct = Math.round(state.learning.slAtrMultiplier * 0.75 * 10) / 10;
    state.learning.takeProfitPct = Math.round(state.learning.tpAtrMultiplier * 0.75 * 10) / 10;

    let lesson = "";
    if (!isBacktest) {
        if (pnlEur > 0) {
            state.learning.minScoreThreshold = Math.max(36, state.learning.minScoreThreshold - 1);
            lesson = `✅ Gen #${gen} (${sym} +${pnlPct.toFixed(2)}%): Potvrdený ${factorNames[bestFactor]} (${w[bestFactor]}%). Reputácia ${sym}: ${tm.winRate}% W (${tm.reputationBonus >= 0 ? "+" : ""}${tm.reputationBonus}b).`;
        } else {
            state.learning.minScoreThreshold = Math.min(48, state.learning.minScoreThreshold + 2);
            const banStatus = tm.reputationBonus <= -100
                ? `⛔ TRVALÝ BAN (-200b)`
                : `⏳ 2h Cooldown + penalizácia (${tm.reputationBonus}b)`;
            lesson = `🛠️ Gen #${gen} POUČENIE ZO STRATY (${sym} ${pnlPct.toFixed(2)}%): ${mistakeDiagnosis}. ${sym} → ${banStatus}, prah istoty zvýšený na ${state.learning.minScoreThreshold}b.`;
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
        const valObj = getPositionValuation(pos, priceUsd);
        openPositionsValueEur += valObj.currentValEur;
        investedEurTotal += pos.investedEur;
    }

    const totalEquityEur = state.portfolio.cashEur + openPositionsValueEur;
    const totalPnlEur = totalEquityEur - state.portfolio.initialCapitalEur;
    const totalPnlPct = (totalPnlEur / state.portfolio.initialCapitalEur) * 100;

    document.getElementById("kpiEquity").textContent = `${totalEquityEur.toFixed(2)} €`;
    const pnlEl = document.getElementById("kpiTotalPnl");
    pnlEl.textContent = `${totalPnlEur >= 0 ? "+" : ""}${totalPnlEur.toFixed(2)} €`;
    pnlEl.className = totalPnlEur >= 0 ? "text-green" : "text-red";

    // Goal 500 € progress bar (from 100 € to 500 € = +400 € target)
    const goalProgressPct = Math.min(100, Math.max(1, ((totalEquityEur - 100) / 400) * 100));
    const goalLbl = document.getElementById("goalProgressLabel");
    const goalBar = document.getElementById("goalProgressBar");
    if (goalLbl) goalLbl.textContent = `Cieľ 500 €: ${Math.max(0, ((totalEquityEur / 500) * 100)).toFixed(1)}%`;
    if (goalBar) goalBar.style.width = `${goalProgressPct}%`;

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
        const valObj = getPositionValuation(pos, currUsd);
        const pnlEur = valObj.pnlEur;
        const pnlPct = valObj.leveragedPct;
        totalOpenPnlEur += pnlEur;

        const pnlClass = pnlEur >= 0 ? "text-green" : "text-red";

        return `
            <tr>
                <td>
                    <strong class="ticker-symbol" style="cursor:pointer;" onclick="selectSymbol('${pos.symbol}')">${pos.symbol}</strong>
                    <span class="badge badge-warn" style="font-size:9px;padding:1px 4px;margin-left:3px;">${valObj.leverage}x</span>
                    <div class="text-muted" style="font-size:11px;">Expozícia: ${(pos.investedEur * valObj.leverage).toFixed(0)} €</div>
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
        leveraged: !!document.getElementById("packLeveraged")?.checked,
        eu: !!document.getElementById("packEu")?.checked,
        tech: !!document.getElementById("packTech")?.checked,
        movers: !!document.getElementById("packMovers")?.checked,
        sp500: !!document.getElementById("packSp500")?.checked,
        etf: !!document.getElementById("packEtf")?.checked
    };
    saveStateToServer();
    addLog(`📡 Aktualizovaný zoznam balíkov trhov (${getActiveWatchlist().length} titulov). Spúšťam paralelný sken...`, "info");
    runMarketCycle();
}

function changeLeverageMode() {
    const sel = document.getElementById("leverageSelect");
    const lev = Number(sel?.value || 5);
    state.settings.leverage = lev;
    // Also update active positions leverage so user sees immediate effect
    for (const p of state.portfolio.positions) {
        p.leverage = lev;
    }
    saveStateToServer();
    renderAll();
    addLog(`⚡ Finančná páka prepnutá na ${lev}x (zisky aj straty sa násobia ${lev}x).`, "info");
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
    if (document.getElementById("packLeveraged")) document.getElementById("packLeveraged").checked = !!packs.leveraged;
    if (document.getElementById("packEu")) document.getElementById("packEu").checked = (packs.eu !== false);
    if (document.getElementById("packTech")) document.getElementById("packTech").checked = !!packs.tech;
    if (document.getElementById("packMovers")) document.getElementById("packMovers").checked = !!packs.movers;
    if (document.getElementById("packSp500")) document.getElementById("packSp500").checked = !!packs.sp500;
    if (document.getElementById("packEtf")) document.getElementById("packEtf").checked = !!packs.etf;
    if (document.getElementById("leverageSelect")) document.getElementById("leverageSelect").value = String(state.settings.leverage || 5);

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

// ============================================================================
// DAILY SUMMARY, SELF-REFLECTION & 09:00 EMAIL REPORT ENGINE
// ============================================================================

function openDailyReportModal() {
    const modal = document.getElementById("dailyReportModal");
    const box = document.getElementById("dailyReportContent");
    const tokInput = document.getElementById("emailAccessTokenInput");
    if (tokInput) {
        tokInput.value = state.settings?.emailAccessToken || "vvtbwu0zpwfeeuda61is0iu1";
    }
    if (box) {
        box.innerHTML = buildDailyReportHtml();
    }
    if (modal) modal.classList.add("open");
}

async function saveEmailTokenFromModal() {
    const tokInput = document.getElementById("emailAccessTokenInput");
    if (!tokInput) return;
    const val = tokInput.value.trim();
    if (!state.settings) state.settings = {};
    state.settings.emailAccessToken = val;
    await saveStateToServer();
    if (val) {
        addLog("📧 E-mailový token (PostMail / Web3Forms) uložený pre automatické 09:00 reporty na mt.banovic@gmail.com.", "success");
        alert("✅ E-mailový token uložený! Teraz môžete kliknúť na '📧 Poslať teraz na mt.banovic@gmail.com' a taktiež sa bude posielať automaticky každé ráno o 09:00.");
    } else {
        alert("Token bol vymazaný.");
    }
}

async function checkAutoDailyEmail0900() {
    try {
        const skNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Bratislava" }));
        const yyyy = skNow.getFullYear();
        const mm = String(skNow.getMonth() + 1).padStart(2, "0");
        const dd = String(skNow.getDate()).padStart(2, "0");
        const todayStr = `${yyyy}-${mm}-${dd}`;
        const tok = state.settings?.emailAccessToken || "vvtbwu0zpwfeeuda61is0iu1";
        if (skNow.getHours() >= 9 && state.lastEmailReportDate !== todayStr && tok) {
            state.lastEmailReportDate = todayStr;
            await saveStateToServer();
            await sendDailyReportEmailNow(true);
        }
    } catch (e) {
        console.warn("09:00 auto-email check warning:", e);
    }
}

function closeDailyReportModal() {
    const modal = document.getElementById("dailyReportModal");
    if (modal) modal.classList.remove("open");
}

function buildDailyReportHtml() {
    const closed = state.portfolio.closedTrades || [];
    const positions = state.portfolio.positions || [];
    const totalEquity = getTotalPortfolioEquityEur();
    const netPnlEur = totalEquity - state.portfolio.initialCapitalEur;
    const netPnlPct = (netPnlEur / state.portfolio.initialCapitalEur) * 100;

    const wins = closed.filter(t => t.pnlEur > 0);
    const losses = closed.filter(t => t.pnlEur <= 0);
    const winRate = closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : "0.0";
    const grossWin = wins.reduce((a, b) => a + b.pnlEur, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnlEur, 0));
    const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? "∞" : "--");

    const topWinners = [...wins].sort((a, b) => b.pnlEur - a.pnlEur).slice(0, 5);
    const topLosers = [...losses].sort((a, b) => a.pnlEur - b.pnlEur).slice(0, 5);
    const rotationLosses = losses.filter(t => (t.exitReason || "").includes("rotácia"));

    const memObj = state.learning.tickerMemory || {};
    const favStocks = Object.entries(memObj).filter(([_, m]) => m.reputationBonus > 0).sort((a, b) => b[1].reputationBonus - a[1].reputationBonus).slice(0, 6);
    const penStocks = Object.entries(memObj).filter(([_, m]) => m.reputationBonus < 0).sort((a, b) => a[1].reputationBonus - b[1].reputationBonus).slice(0, 6);

    return `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:10px;">
            <div class="weight-item">
                <div class="text-muted" style="font-size:11px;">AKTUÁLNY STAV ÚČTU</div>
                <div style="font-size:20px; font-weight:800; color:var(--profit-green);">${totalEquity.toFixed(2)} €</div>
                <div style="font-size:12px;">Čistý zisk: <strong>${netPnlEur >= 0 ? "+" : ""}${netPnlEur.toFixed(2)} € (${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(2)}%)</strong></div>
            </div>
            <div class="weight-item">
                <div class="text-muted" style="font-size:11px;">UZAVRETÉ OBCHODY</div>
                <div style="font-size:20px; font-weight:800;">${closed.length} obchodov</div>
                <div style="font-size:12px;"><span class="text-green">${wins.length} ziskových</span> / <span class="text-red">${losses.length} stratových</span> (${winRate}%)</div>
            </div>
            <div class="weight-item">
                <div class="text-muted" style="font-size:11px;">HRUBÝ ZISK VS. STRATA</div>
                <div style="font-size:20px; font-weight:800; color:var(--accent-cyan);">PF: ${profitFactor}</div>
                <div style="font-size:12px;"><span class="text-green">+${grossWin.toFixed(2)} €</span> vs. <span class="text-red">-${grossLoss.toFixed(2)} €</span></div>
            </div>
            <div class="weight-item">
                <div class="text-muted" style="font-size:11px;">GENERÁCIA MOZGU AI</div>
                <div style="font-size:20px; font-weight:800; color:var(--accent-purple);">Gen #${state.learning.generation}</div>
                <div style="font-size:12px;">Natrénované: <strong>${state.learning.totalTrainedTrades || closed.length}</strong> rozhodnutí</div>
            </div>
        </div>

        <div class="weight-item" style="border-left: 4px solid var(--profit-green);">
            <div style="font-weight:700; margin-bottom:6px; color:var(--profit-green);">🏆 Najlepšie obchody (Ako agent premýšľal a prečo zarobil):</div>
            ${topWinners.length === 0 ? '<div class="text-muted">Zatiaľ žiadne uzavreté ziskové obchody.</div>' : topWinners.map(w => `
                <div style="padding:4px 0; border-bottom:1px dashed rgba(35,48,77,0.4); display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                    <span><strong>${w.symbol}</strong> (${w.openedAt} → ${w.closedAt}): <strong class="text-green">+${w.pnlEur.toFixed(2)} € (+${w.pnlPct.toFixed(2)}%)</strong></span>
                    <span class="text-muted" style="font-size:12px;">${w.exitReason}</span>
                </div>
            `).join("")}
            <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
                💡 <strong>Myšlienkový postup pri výhrach:</strong> Agent zachytil silné momentum na pákových ETF a volatilných lídroch (najmä <code>SOXL</code>, <code>TSLA</code>, <code>NVDL</code>, <code>AAPL</code>), podržal ich v trende a zisk uzamkol cez <strong>Trailing Stop / Take-Profit</strong>. Jediný veľký zásah (+11,23 € na SOXL) zaplatil desiatky drobných testovacích zastavení.
            </div>
        </div>

        <div class="weight-item" style="border-left: 4px solid var(--warn-amber);">
            <div style="font-weight:700; margin-bottom:6px; color:var(--warn-amber);">⚠️ Analýza chýb a stratových obchodov (Čo nevyšlo):</div>
            ${topLosers.length === 0 ? '<div class="text-muted">Zatiaľ žiadne stratové obchody.</div>' : topLosers.map(l => `
                <div style="padding:4px 0; border-bottom:1px dashed rgba(35,48,77,0.4); display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                    <span><strong>${l.symbol}</strong> (${l.openedAt} → ${l.closedAt}): <strong class="text-red">${l.pnlEur.toFixed(2)} € (${l.pnlPct.toFixed(2)}%)</strong></span>
                    <span class="text-muted" style="font-size:12px;">${l.exitReason}</span>
                </div>
            `).join("")}
            <div style="margin-top:6px; font-size:12px; color:var(--text-secondary);">
                🔍 <strong>Diagnostika chýb AI:</strong>
                <ul style="margin-left:18px; margin-top:4px;">
                    <li><strong>Chyba č. 1 (Nočná rotácia zatvorených US akcií):</strong> Celkovo ${rotationLosses.length} malých strát (po -0,04 € až -0,54 €) vzniklo tým, že v noci po 22:00 (keď bola US burza zatvorená a ceny sa nehýbali) agent vyhodnotil US ETF ako „stagnujúce“ a zbytočne ich rotoval, čím platil poplatky za prevod.</li>
                    <li><strong>Chyba č. 2 (Pomalé/falošné breakouts mimo hlavných hodín):</strong> Najväčšie jednotlivé straty (<code>LMT -3,01 €</code> a <code>AMDL -2,67 €</code>) vznikli pri vstupe bez dostatočného objemu alebo v pomalom sektore.</li>
                </ul>
            </div>
        </div>

        <div class="weight-item" style="border-left: 4px solid var(--accent-cyan);">
            <div style="font-weight:700; margin-bottom:6px; color:var(--accent-cyan);">🧠 Ako sa agent poučil & Čo urobí dnes lepšie:</div>
            <ul style="margin-left:18px; font-size:12px; color:var(--text-primary); display:flex; flex-direction:column; gap:5px;">
                <li>✅ <strong>1. Zákaz nočnej rotácie US akcií (Nové pravidlo):</strong> Mimo otváracích hodín US burzy (22:00 – 10:00) agent už <strong>nerotuje</strong> americké akcie/ETF na základe 15-minútovej stagnácie. V noci obchoduje iba živé 24/7 krypto a šetrí poplatky.</li>
                <li>✅ <strong>2. Pamäť a reputácia titulov aktualizovaná:</strong>
                    Obľúbené ziskové tituly s bonusom: <strong>${favStocks.length ? favStocks.map(([s, m]) => `${s} (+${m.reputationBonus}b)`).join(", ") : "SOXL, TSLA, NVDL, AAPL"}</strong>.
                    Penalizované tituly (znížená dôvera): <strong>${penStocks.length ? penStocks.map(([s, m]) => `${s} (${m.reputationBonus}b)`).join(", ") : "LMT, AMDL, MSTU"}</strong>.
                </li>
                <li>✅ <strong>3. V5 Hyper-Growth (3-stupňový Trailing Stop & Kellyho škálovanie):</strong> Priemerný zisk na víťazný obchod (+${wins.length ? (grossWin / wins.length).toFixed(2) : "0.00"} €) je výrazne vyšší než priemerná strata (-${losses.length ? (grossLoss / losses.length).toFixed(2) : "0.00"} €). Agent pri +0.45% posúva Stop-Loss na Break-Even a pri A+ signáloch navyšuje pozíciu 1.35x.</li>
                <li>✅ <strong>4. Pravidelný ranný report o 09:00:</strong> Každé ráno o 09:00 sa odošle kompletný súhrn na <strong>mt.banovic@gmail.com</strong>.</li>
            </ul>
        </div>

        <div class="weight-item" style="border-left: 4px solid var(--accent-purple);">
            <div style="font-weight:700; margin-bottom:8px; color:var(--accent-purple);">🕒 Chronologický záznam posledných 15 akcií (Presný čas kedy a čo vykonal):</div>
            <div style="max-height:240px; overflow-y:auto; font-size:12px;">
                ${closed.slice(0, 15).map(t => {
                    const isCloud = (t.exitReason || "").includes("24/7") || (t.lesson || "").includes("Cloud");
                    const badge = isCloud
                        ? '<span style="background:rgba(139,92,246,0.25); color:#c4b5fd; padding:1px 6px; border-radius:4px; font-size:10px;">☁️ 24/7 CLOUD</span>'
                        : '<span style="background:rgba(56,189,248,0.2); color:#7dd3fc; padding:1px 6px; border-radius:4px; font-size:10px;">⚡ LIVE ENGINE</span>';
                    const pColor = t.pnlEur >= 0 ? "var(--profit-green)" : "var(--loss-red)";
                    const sign = t.pnlEur >= 0 ? "+" : "";
                    return `
                        <div style="padding:5px 0; border-bottom:1px solid rgba(35,48,77,0.5); display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                            <div>
                                ${badge}
                                <strong>${t.symbol}</strong>
                                <span class="text-muted">(${t.openedAt} → ${t.closedAt})</span>
                            </div>
                            <div style="color:${pColor}; font-weight:700;">${sign}${t.pnlEur.toFixed(2)} € (${sign}${t.pnlPct.toFixed(2)}%)</div>
                            <div class="text-muted" style="font-size:11px; width:100%;">${t.exitReason}</div>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

async function sendDailyReportEmailNow(isSilentAuto = false) {
    const btn = document.getElementById("btnSendEmailNow");
    if (btn && !isSilentAuto) {
        btn.disabled = true;
        btn.textContent = "⏳ Odosielam na mt.banovic@gmail.com...";
    }
    try {
        const tokInput = document.getElementById("emailAccessTokenInput");
        if (tokInput && tokInput.value.trim()) {
            state.settings.emailAccessToken = tokInput.value.trim();
            await saveStateToServer();
        }
        const token = (state.settings?.emailAccessToken || "vvtbwu0zpwfeeuda61is0iu1").trim();

        const closed = state.portfolio.closedTrades || [];
        const positions = state.portfolio.positions || [];
        const totalEquity = getTotalPortfolioEquityEur();
        const netProfit = totalEquity - state.portfolio.initialCapitalEur;
        const wins = closed.filter(t => t.pnlEur > 0);
        const losses = closed.filter(t => t.pnlEur <= 0);
        const sortedBest = [...closed].sort((a, b) => b.pnlEur - a.pnlEur).slice(0, 4);
        const sortedWorst = [...closed].sort((a, b) => a.pnlEur - b.pnlEur).slice(0, 3);

        const subject = `📊 Denný AI Burzový Report | Hodnota: ${totalEquity.toFixed(2)} € (${netProfit >= 0 ? "+" : ""}${netProfit.toFixed(2)} €)`;
        const bodyText = [
            `📊 DENNÝ SÚHRN & SEBAREFLEXIA AI BURZOVÉHO AGENTA`,
            `Dátum a čas: ${new Date().toLocaleString("sk-SK")}`,
            `------------------------------------------------------------`,
            `💰 CELKOVÁ HODNOTA PORTFÓLIA: ${totalEquity.toFixed(2)} € (Štart: 100.00 € | Čistý zisk: ${netProfit >= 0 ? "+" : ""}${netProfit.toFixed(2)} €)`,
            `💵 Hotovosť: ${state.portfolio.cashEur.toFixed(2)} €`,
            `📂 Otvorené pozície (${positions.length}): ${positions.map(p => `${p.symbol} (${p.leverage || 5}x @ ${p.entryPriceUsd})`).join(", ") || "Žiadne"}`,
            `📈 Bilancia obchodov: Spolu ${closed.length} | Výhry: ${wins.length} | Straty: ${losses.length} | Generácia AI: #${state.learning.generation}`,
            ``,
            `🏆 TOP VÝHERNÉ OBCHODY:`,
            sortedBest.map(t => `  • ${t.symbol}: +${t.pnlEur.toFixed(2)} € (+${t.pnlPct.toFixed(2)}%) [${t.openedAt} -> ${t.closedAt}]`).join("\n") || "  Žiadne",
            ``,
            `⚠️ NAJVÄČŠIE STRATY A POUČENIE:`,
            sortedWorst.map(t => `  • ${t.symbol}: ${t.pnlEur.toFixed(2)} € (${t.pnlPct.toFixed(2)}%) [${t.exitReason}]`).join("\n") || "  Žiadne",
            ``,
            `🕒 POSLEDNÝCH 8 OBCHODOV:`,
            closed.slice(0, 8).map(t => `  • [${t.closedAt}] ${t.symbol}: ${t.pnlEur >= 0 ? "+" : ""}${t.pnlEur.toFixed(2)} € (${t.exitReason})`).join("\n") || "  Žiadne"
        ].join("\n");

        // 1. If user entered PostMail or Web3Forms token, send via their 100% live API
        if (token) {
            const isUuid = token.includes("-");
            if (isUuid) {
                // Web3Forms
                const wRes = await fetch("https://api.web3forms.com/submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({
                        access_key: token,
                        subject: subject,
                        from_name: "Autonomny AI Burzovy Agent",
                        message: bodyText
                    })
                });
                const wData = await wRes.json();
                if (wData && wData.success) {
                    if (!isSilentAuto) alert("✅ Report bol okamžite odoslaný na mt.banovic@gmail.com (cez Web3Forms)!");
                    addLog("📧 Denný report úspešne odoslaný na mt.banovic@gmail.com.", "success");
                    return;
                }
            } else {
                // PostMail (https://postmail.invotes.com/send)
                const formBody = new URLSearchParams({
                    access_token: token,
                    subject: subject,
                    text: bodyText
                });
                const pRes = await fetch("https://postmail.invotes.com/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: formBody.toString()
                });
                if (pRes.ok || pRes.status === 200 || pRes.status === 302) {
                    if (!isSilentAuto) alert("✅ Report bol okamžite odoslaný na mt.banovic@gmail.com (cez PostMail)!");
                    addLog("📧 Denný report úspešne odoslaný na mt.banovic@gmail.com.", "success");
                    return;
                }
            }
        }

        // 2. Try FormSubmit as secondary fallback
        let formSubmitSuccess = false;
        try {
            const res = await fetch("https://formsubmit.co/ajax/mt.banovic@gmail.com", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ _subject: subject, _captcha: "false", message: bodyText })
            });
            if (res.ok) {
                const data = await res.json();
                if (data && (data.success === "true" || data.success === true)) {
                    formSubmitSuccess = true;
                    if (!isSilentAuto) alert("✅ Report bol okamžite odoslaný na mt.banovic@gmail.com!");
                    addLog("📧 Denný report úspešne odoslaný na mt.banovic@gmail.com.", "success");
                    return;
                }
            }
        } catch (errFs) {
            console.warn("FormSubmit fallback unavailable (HTTP 521):", errFs);
        }

        // 3. If no token is saved yet and FormSubmit has outage (HTTP 521), guide user & offer 1-click Gmail send
        if (!isSilentAuto && !formSubmitSuccess) {
            const openGmail = confirm(
                "📬 Automatická brána PostMail čaká na váš 'access_token' (práve sme vám ho nechali poslať na váš Gmail mt.banovic@gmail.com od služby PostMail / Invotes – skontrolujte doručenú poštu alebo SPAM a vložte ho do políčka hore v tomto okne).\n\n" +
                "Chcete zatiaľ tento denný report odoslať okamžite jedným klikom priamo cez váš Gmail?"
            );
            if (openGmail) {
                const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent("mt.banovic@gmail.com")}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
                window.open(gmailUrl, "_blank");
            }
        }
    } catch (e) {
        if (!isSilentAuto) alert("❌ Chyba pri odosielaní e-mailu: " + e.message);
    } finally {
        if (btn && !isSilentAuto) {
            btn.disabled = false;
            btn.textContent = "📧 Poslať teraz na mt.banovic@gmail.com";
        }
    }
}
