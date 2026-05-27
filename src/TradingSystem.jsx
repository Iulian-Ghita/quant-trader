import { useState, useEffect, useRef, useCallback } from "react";

// ─── MOCK DATA ENGINE (replaces real Alpaca API for demo) ──────────────────────
const SECTORS = {
  "AI / Infrastructure": ["CRWD", "NOW", "META", "MU", "PLTR", "ZS", "CRDO", "ALAB", "CLS", "NVDA", "AMD"],
  "Defense": ["CEG", "LEU"],
  "Fintech": ["SOFI", "HOOD"],
  "EV / Mobility": ["TSLA"],
};

const SYMBOLS = Object.values(SECTORS).flat();

const generatePrice = (base, volatility = 0.003) =>
  +(base * (1 + (Math.random() - 0.5) * volatility)).toFixed(2);

const initialPrices = {
  CRWD: 382.4,  NOW: 812.5,  META: 512.1, MU: 98.7,
  CEG: 274.3,   PLTR: 38.6,  TSLA: 248.3, ZS: 178.9,
  CRDO: 52.4,   ALAB: 88.2,  CLS: 41.7,   NVDA: 875.4,
  AMD: 162.8,   SOFI: 14.8,  HOOD: 21.3,
  LEU: 62.5,
};

// ─── STRATEGY ENGINE ──────────────────────────────────────────────────────────
class StrategyEngine {
  constructor() {
    this.priceHistory = {};
    SYMBOLS.forEach(s => { this.priceHistory[s] = []; });
  }

  addPrice(symbol, price) {
    this.priceHistory[symbol].push(price);
    if (this.priceHistory[symbol].length > 50)
      this.priceHistory[symbol].shift();
  }

  sma(symbol, period) {
    const h = this.priceHistory[symbol];
    if (h.length < period) return null;
    const slice = h.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  rsi(symbol, period = 14) {
    const h = this.priceHistory[symbol];
    if (h.length < period + 1) return 50;
    const changes = h.slice(-period - 1).map((v, i, a) => i > 0 ? v - a[i - 1] : 0).slice(1);
    const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
    if (losses === 0) return 100;
    const rs = gains / losses;
    return +(100 - 100 / (1 + rs)).toFixed(1);
  }

  // SMA Crossover + RSI filter strategy
  signal(symbol) {
    const fast = this.sma(symbol, 5);
    const slow = this.sma(symbol, 20);
    const rsi = this.rsi(symbol);
    const price = this.priceHistory[symbol].slice(-1)[0];
    if (!fast || !slow || !price) return "HOLD";
    if (fast > slow * 1.001 && rsi < 65) return "BUY";
    if (fast < slow * 0.999 && rsi > 35) return "SELL";
    return "HOLD";
  }
}

// ─── ORDER MANAGER ────────────────────────────────────────────────────────────
class OrderManager {
  constructor(initialCash = 100000) {
    this.cash = initialCash;
    this.positions = {};
    this.orders = [];
    this.pnl = 0;
  }

  execute(symbol, signal, price, qty = 10) {
    const id = `ORD-${Date.now().toString(36).toUpperCase()}`;
    if (signal === "BUY") {
      const cost = price * qty;
      if (this.cash >= cost) {
        this.cash -= cost;
        this.positions[symbol] = (this.positions[symbol] || 0) + qty;
        this.orders.unshift({ id, symbol, side: "BUY", qty, price, time: new Date(), status: "FILLED" });
        return true;
      }
    } else if (signal === "SELL" && (this.positions[symbol] || 0) >= qty) {
      this.cash += price * qty;
      this.positions[symbol] -= qty;
      this.orders.unshift({ id, symbol, side: "SELL", qty, price, time: new Date(), status: "FILLED" });
      return true;
    }
    return false;
  }

  portfolioValue(prices) {
    return Object.entries(this.positions).reduce((sum, [sym, qty]) => {
      return sum + (prices[sym] || 0) * qty;
    }, this.cash);
  }
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const w = 80, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function TradingSystem() {
  const [prices, setPrices] = useState({ ...initialPrices });
  const [priceHistory, setPriceHistory] = useState(() => {
    const h = {};
    SYMBOLS.forEach(s => { h[s] = [initialPrices[s]]; });
    return h;
  });
  const [signals, setSignals] = useState({});
  const [orders, setOrders] = useState([]);
  const [portfolio, setPortfolio] = useState({ cash: 100000, value: 100000, positions: {} });
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState([]);
  const [activeTab, setActiveTab] = useState("market");
  const [equityCurve, setEquityCurve] = useState([100000]);

  const engineRef = useRef(new StrategyEngine());
  const omRef = useRef(new OrderManager(100000));
  const intervalRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    setLog(prev => [{
      msg, type, time: new Date().toLocaleTimeString("en-US", { hour12: false })
    }, ...prev].slice(0, 100));
  }, []);

  const runTick = useCallback(() => {
    const eng = engineRef.current;
    const om = omRef.current;

    // Update prices
    const newPrices = {};
    SYMBOLS.forEach(s => {
      newPrices[s] = generatePrice(prices[s] || initialPrices[s]);
      eng.addPrice(s, newPrices[s]);
    });

    // Generate signals ONLY — Order Management dezactivat
    const newSignals = {};
    SYMBOLS.forEach(s => {
      const sig = eng.signal(s);
      newSignals[s] = sig;
      if (sig !== "HOLD") {
        addLog(`SEMNAL ${sig} detectat pentru ${s} @ $${newPrices[s]} — nicio execuție`, sig === "BUY" ? "buy" : "sell");
      }
    });

    const totalValue = om.portfolioValue(newPrices);

    setPrices(newPrices);
    setPriceHistory(prev => {
      const h = { ...prev };
      SYMBOLS.forEach(s => {
        h[s] = [...(h[s] || []), newPrices[s]].slice(-40);
      });
      return h;
    });
    setSignals(newSignals);
    setOrders([...om.orders].slice(0, 50));
    setPortfolio({ cash: om.cash, value: totalValue, positions: { ...om.positions } });
    setEquityCurve(prev => [...prev, totalValue].slice(-60));
    setTick(t => t + 1);
  }, [prices, addLog]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(runTick, 1500);
      addLog("Sistema pornit — paper trading activ", "system");
    } else {
      clearInterval(intervalRef.current);
      if (tick > 0) addLog("Sistema oprit", "system");
    }
    return () => clearInterval(intervalRef.current);
  }, [running, runTick]);
< truncated lines 195-363 >
                    <span style={{ fontSize: 9, color: "#4a5a72" }}>{syms.length} simboluri</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                    {syms.map(sym => {
                      const price = prices[sym];
                      const hist = priceHistory[sym] || [];
                      const prev = hist[hist.length - 2] || price;
                      const chg = (price || 0) - (prev || 0);
                      const chgPct = prev ? ((chg / prev) * 100).toFixed(2) : "0.00";
                      const sig = signals[sym] || "HOLD";
                      return (
                        <div key={sym} style={{
                          background: "#0c1220",
                          border: "1px solid #1e2d45",
                          borderRadius: 6,
                          padding: "12px 14px",
                          animation: "fadeIn 0.2s ease",
                          position: "relative",
                          overflow: "hidden",
                        }}>
                          <div style={{
                            position: "absolute", top: 0, left: 0, right: 0, height: 2,
                            background: sig === "BUY" ? "#00e5a0" : sig === "SELL" ? "#ff4d6d" : "#1e2d45",
                          }} />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f0ff", letterSpacing: "0.05em" }}>{sym}</div>
                            <div style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                              color: signalColor(sig),
                              background: signalBg(sig),
                              padding: "2px 7px",
                              borderRadius: 3,
                              border: "1px solid " + signalColor(sig) + "40",
                            }}>{sig}</div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0ff" }}>
                                ${price?.toFixed(2) ?? "—"}
                              </div>
                              <div style={{ fontSize: 10, color: chg >= 0 ? "#00e5a0" : "#ff4d6d", marginTop: 2 }}>
                                {chg >= 0 ? "▲" : "▼"} {Math.abs(Number(chgPct))}%
                              </div>
                            </div>
                            <Sparkline data={hist} color={chg >= 0 ? "#00e5a0" : "#ff4d6d"} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* POSITIONS TAB */}
        {activeTab === "positions" && (
          <div>
            {Object.entries(portfolio.positions).filter(([, qty]) => qty > 0).length === 0 ? (
              <div style={{ color: "#4a5a72", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
                Nicio poziție deschisă. Pornește sistemul pentru a începe trading.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2d45" }}>
                    {["SYMBOL", "QTY", "PRICE", "VALUE", "SIGNAL"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 9,
                        letterSpacing: "0.15em", color: "#4a5a72", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(portfolio.positions).filter(([, qty]) => qty > 0).map(([sym, qty]) => (
                    <tr key={sym} style={{ borderBottom: "1px solid #1e2d4540" }}>
                      <td style={{ padding: "10px 12px", color: "#e8f0ff", fontWeight: 700 }}>{sym}</td>
                      <td style={{ padding: "10px 12px" }}>{qty}</td>
                      <td style={{ padding: "10px 12px" }}>${prices[sym]?.toFixed(2)}</td>
                      <td style={{ padding: "10px 12px", color: "#00e5a0" }}>
                        ${(qty * (prices[sym] || 0)).toFixed(2)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                          color: signalColor(signals[sym]),
                          background: signalBg(signals[sym]),
                          padding: "2px 8px", borderRadius: 3,
                        }}>{signals[sym] || "HOLD"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === "orders" && (
          <div>
            {orders.length === 0 ? (
              <div style={{ color: "#4a5a72", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
                Niciun ordin executat încă.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2d45" }}>
                    {["ID", "SYMBOL", "SIDE", "QTY", "PRICE", "STATUS", "TIME"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 9,
                        letterSpacing: "0.15em", color: "#4a5a72", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e2d4530",
                      animation: i === 0 ? "fadeIn 0.3s ease" : "none" }}>
                      <td style={{ padding: "8px 12px", fontSize: 10, color: "#4a5a72" }}>{o.id}</td>
                      <td style={{ padding: "8px 12px", color: "#e8f0ff", fontWeight: 700 }}>{o.symbol}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                          color: o.side === "BUY" ? "#00e5a0" : "#ff4d6d",
                        }}>{o.side}</span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>{o.qty}</td>
                      <td style={{ padding: "8px 12px" }}>${o.price?.toFixed(2)}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ fontSize: 9, color: "#00e5a0" }}>● {o.status}</span>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 10, color: "#4a5a72" }}>
                        {o.time?.toLocaleTimeString("en-US", { hour12: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* LOG TAB */}
        {activeTab === "log" && (
          <div style={{ fontFamily: "IBM Plex Mono, monospace" }}>
            {log.length === 0 ? (
              <div style={{ color: "#4a5a72", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
                Pornește sistemul pentru a vedea log-ul.
              </div>
            ) : log.map((entry, i) => (
              <div key={i} style={{
                display: "flex", gap: 16, padding: "5px 0",
                borderBottom: "1px solid #1e2d4520",
                animation: i === 0 ? "fadeIn 0.2s ease" : "none",
                fontSize: 11,
              }}>
                <span style={{ color: "#4a5a72", minWidth: 70 }}>{entry.time}</span>
                <span style={{
                  color: entry.type === "buy" ? "#00e5a0"
                    : entry.type === "sell" ? "#ff4d6d"
                    : entry.type === "system" ? "#7eb8ff"
                    : "#8892a4",
                }}>{entry.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strategy Info Footer */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#0c1220",
        borderTop: "1px solid #1e2d45",
        padding: "8px 24px",
        display: "flex",
        gap: 24,
        fontSize: 9,
        letterSpacing: "0.12em",
        color: "#4a5a72",
      }}>
        <span>STRATEGIE: SMA CROSSOVER (5/20) + RSI FILTER</span>
        <span>•</span>
        <span>INTERVAL: 1.5s</span>
        <span>•</span>
        <span>UNIVERSE: {SYMBOLS.length} SIMBOLURI</span>
        <span>•</span>
        <span style={{ color: "#ffb830" }}>MODE: OBSERVE ONLY — FĂRĂ EXECUȚIE</span>
      </div>
    </div>
  );
}

{
  "returncode" : 0,
  "stdout" : "import { useState, useEffect, useRef, useCallback } from \"react\";\n\n\/\/ ─── MOCK DATA ENGINE (replaces real Alpaca API for demo) ──────────────────────\nconst SECTORS = {\n  \"AI \/ Infrastructure\": [\"CRWD\", \"NOW\", \"META\", \"MU\", \"PLTR\", \"ZS\", \"CRDO\", \"ALAB\", \"CLS\", \"NVDA\", \"AMD\"],\n  \"Defense\": [\"CEG\", \"LEU\"],\n  \"Fintech\": [\"SOFI\", \"HOOD\"],\n  \"EV \/ Mobility\": [\"TSLA\"],\n};\n\nconst SYMBOLS = Object.values(SECTORS).flat();\n\nconst generatePrice = (base, volatility = 0.003) =>\n  +(base * (1 + (Math.random() - 0.5) * volatility)).toFixed(2);\n\nconst initialPrices = {\n  CRWD: 382.4,  NOW: 812.5,  META: 512.1, MU: 98.7,\n  CEG: 274.3,   PLTR: 38.6,  TSLA: 248.3, ZS: 178.9,\n  CRDO: 52.4,   ALAB: 88.2,  CLS: 41.7,   NVDA: 875.4,\n  AMD: 162.8,   SOFI: 14.8,  HOOD: 21.3,\n  LEU: 62.5,\n};\n\n\/\/ ─── STRATEGY ENGINE ──────────────────────────────────────────────────────────\nclass StrategyEngine {\n  constructor() {\n    this.priceHistory = {};\n    SYMBOLS.forEach(s => { this.priceHistory[s] = []; });\n  }\n\n  addPrice(symbol, price) {\n    this.priceHistory[symbol].push(price);\n    if (this.priceHistory[symbol].length > 50)\n      this.priceHistory[symbol].shift();\n  }\n\n  sma(symbol, period) {\n    const h = this.priceHistory[symbol];\n    if (h.length < period) return null;\n    const slice = h.slice(-period);\n    return slice.reduce((a, b) => a + b, 0) \/ period;\n  }\n\n  rsi(symbol, period = 14) {\n    const h = this.priceHistory[symbol];\n    if (h.length < period + 1) return 50;\n    const changes = h.slice(-period - 1).map((v, i, a) => i > 0 ? v - a[i - 1] : 0).slice(1);\n    const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) \/ period;\n    const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0)) \/ period;\n    if (losses === 0) return 100;\n    const rs = gains \/ losses;\n    return +(100 - 100 \/ (1 + rs)).toFixed(1);\n  }\n\n  \/\/ SMA Crossover + RSI filter strategy\n  signal(symbol) {\n    const fast = this.sma(symbol, 5);\n    const slow = this.sma(symbol, 20);\n    const rsi = this.rsi(symbol);\n    const price = this.priceHistory[symbol].slice(-1)[0];\n    if (!fast || !slow || !price) return \"HOLD\";\n    if (fast > slow * 1.001 && rsi < 65) return \"BUY\";\n    if (fast < slow * 0.999 && rsi > 35) return \"SELL\";\n    return \"HOLD\";\n  }\n}\n\n\/\/ ─── ORDER MANAGER ────────────────────────────────────────────────────────────\nclass OrderManager {\n  constructor(initialCash = 100000) {\n    this.cash = initialCash;\n    this.positions = {};\n    this.orders = [];\n    this.pnl = 0;\n  }\n\n  execute(symbol, signal, price, qty = 10) {\n    const id = `ORD-${Date.now().toString(36).toUpperCase()}`;\n    if (signal === \"BUY\") {\n      const cost = price * qty;\n      if (this.cash >= cost) {\n        this.cash -= cost;\n        this.positions[symbol] = (this.positions[symbol] || 0) + qty;\n        this.orders.unshift({ id, symbol, side: \"BUY\", qty, price, time: new Date(), status: \"FILLED\" });\n        return true;\n      }\n    } else if (signal === \"SELL\" && (this.positions[symbol] || 0) >= qty) {\n      this.cash += price * qty;\n      this.positions[symbol] -= qty;\n      this.orders.unshift({ id, symbol, side: \"SELL\", qty, price, time: new Date(), status: \"FILLED\" });\n      return true;\n    }\n    return false;\n  }\n\n  portfolioValue(prices) {\n    return Object.entries(this.positions).reduce((sum, [sym, qty]) => {\n      return sum + (prices[sym] || 0) * qty;\n    }, this.cash);\n  }\n}\n\n\/\/ ─── SPARKLINE ────────────────────────────────────────────────────────────────\nfunction Sparkline({ data, color }) {\n  if (!data || data.length < 2) return null;\n  const w = 80, h = 28;\n  const min = Math.min(...data), max = Math.max(...data);\n  const range = max - min || 1;\n  const pts = data.map((v, i) =>\n    `${(i \/ (data.length - 1)) * w},${h - ((v - min) \/ range) * h}`\n  ).join(\" \");\n  return (\n    <svg width={w} height={h} style={{ display: \"block\" }}>\n      <polyline points={pts} fill=\"none\" stroke={color} strokeWidth=\"1.5\"\n        strokeLinejoin=\"round\" strokeLinecap=\"round\" opacity=\"0.9\" \/>\n    <\/svg>\n  );\n}\n\n\/\/ ─── MAIN APP ─────────────────────────────────────────────────────────────────\nexport default function TradingSystem() {\n  const [prices, setPrices] = useState({ ...initialPrices });\n  const [priceHistory, setPriceHistory] = useState(() => {\n    const h = {};\n    SYMBOLS.forEach(s => { h[s] = [initialPrices[s]]; });\n    return h;\n  });\n  const [signals, setSignals] = useState({});\n  const [orders, setOrders] = useState([]);\n  const [portfolio, setPortfolio] = useState({ cash: 100000, value: 100000, positions: {} });\n  const [running, setRunning] = useState(false);\n  const [tick, setTick] = useState(0);\n  const [log, setLog] = useState([]);\n  const [activeTab, setActiveTab] = useState(\"market\");\n  const [equityCurve, setEquityCurve] = useState([100000]);\n\n  const engineRef = useRef(new StrategyEngine());\n  const omRef = useRef(new OrderManager(100000));\n  const intervalRef = useRef(null);\n\n  const addLog = useCallback((msg, type = \"info\") => {\n    setLog(prev => [{\n      msg, type, time: new Date().toLocaleTimeString(\"en-US\", { hour12: false })\n    }, ...prev].slice(0, 100));\n  }, []);\n\n  const runTick = useCallback(() => {\n    const eng = engineRef.current;\n    const om = omRef.current;\n\n    \/\/ Update prices\n    const newPrices = {};\n    SYMBOLS.forEach(s => {\n      newPrices[s] = generatePrice(prices[s] || initialPrices[s]);\n      eng.addPrice(s, newPrices[s]);\n    });\n\n    \/\/ Generate signals ONLY — Order Management dezactivat\n    const newSignals = {};\n    SYMBOLS.forEach(s => {\n      const sig = eng.signal(s);\n      newSignals[s] = sig;\n      if (sig !== \"HOLD\") {\n        addLog(`SEMNAL ${sig} detectat pentru ${s} @ $${newPrices[s]} — nicio execuție`, sig === \"BUY\" ? \"buy\" : \"sell\");\n      }\n    });\n\n    const totalValue = om.portfolioValue(newPrices);\n\n    setPrices(newPrices);\n    setPriceHistory(prev => {\n      const h = { ...prev };\n      SYMBOLS.forEach(s => {\n        h[s] = [...(h[s] || []), newPrices[s]].slice(-40);\n      });\n      return h;\n    });\n    setSignals(newSignals);\n    setOrders([...om.orders].slice(0, 50));\n    setPortfolio({ cash: om.cash, value: totalValue, positions: { ...om.positions } });\n    setEquityCurve(prev => [...prev, totalValue].slice(-60));\n    setTick(t => t + 1);\n  }, [prices, addLog]);\n\n  useEffect(() => {\n    if (running) {\n      intervalRef.current = setInterval(runTick, 1500);\n      addLog(\"Sistema pornit — paper trading activ\", \"system\");\n    } else {\n      clearInterval(intervalRef.current);\n      if (tick > 0) addLog(\"Sistema oprit\", \"system\");\n    }\n    return () => clearInterval(intervalRef.current);\n  }, [running, runTick]);\n\n  const pnlAbs = portfolio.value - 100000;\n  const pnlPct = ((pnlAbs \/ 100000) * 100).toFixed(2);\n  const pnlColor = pnlAbs >= 0 ? \"#00e5a0\" : \"#ff4d6d\";\n\n  const signalColor = s => s === \"BUY\" ? \"#00e5a0\" : s === \"SELL\" ? \"#ff4d6d\" : \"#8892a4\";\n  const signalBg = s => s === \"BUY\" ? \"#00e5a01a\" : s === \"SELL\" ? \"#ff4d6d1a\" : \"#8892a410\";\n\n  \/\/ Equity sparkline\n  const eMin = Math.min(...equityCurve), eMax = Math.max(...equityCurve);\n  const eRange = eMax - eMin || 1;\n  const ePts = equityCurve.map((v, i) =>\n    `${(i \/ Math.max(equityCurve.length - 1, 1)) * 340},${50 - ((v - eMin) \/ eRange) * 46}`\n  ).join(\" \");\n\n  return (\n    <div style={{\n      background: \"#090d14\",\n      minHeight: \"100vh\",\n      fontFamily: \"'IBM Plex Mono', 'Courier New', monospace\",\n      color: \"#c8d6ef\",\n      padding: \"0\",\n      overflowX: \"hidden\",\n    }}>\n      {\/* Header *\/}\n      <div style={{\n        background: \"#0c1220\",\n        borderBottom: \"1px solid #1e2d45\",\n        padding: \"14px 24px\",\n        display: \"flex\",\n        alignItems: \"center\",\n        justifyContent: \"space-between\",\n        position: \"sticky\",\n        top: 0,\n        zIndex: 100,\n      }}>\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: 12 }}>\n          <div style={{\n            width: 8, height: 8, borderRadius: \"50%\",\n            background: running ? \"#00e5a0\" : \"#8892a4\",\n            boxShadow: running ? \"0 0 8px #00e5a0\" : \"none\",\n            animation: running ? \"pulse 1.5s infinite\" : \"none\",\n          }} \/>\n          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: \"0.15em\", color: \"#e8f0ff\" }}>\n            QUANT TRADER\n          <\/span>\n          <span style={{ fontSize: 11, color: \"#4a5a72\", marginLeft: 4 }}>v1.0 • PAPER<\/span>\n        <\/div>\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: 16 }}>\n          <span style={{ fontSize: 11, color: \"#4a5a72\" }}>TICK #{tick}<\/span>\n          <button onClick={() => setRunning(r => !r)} style={{\n            background: running ? \"#ff4d6d18\" : \"#00e5a018\",\n            border: `1px solid ${running ? \"#ff4d6d60\" : \"#00e5a060\"}`,\n            color: running ? \"#ff4d6d\" : \"#00e5a0\",\n            padding: \"6px 18px\",\n            borderRadius: 4,\n            fontSize: 11,\n            fontWeight: 700,\n            letterSpacing: \"0.12em\",\n            cursor: \"pointer\",\n            transition: \"all 0.2s\",\n          }}>\n            {running ? \"■ STOP\" : \"▶ START\"}\n          <\/button>\n        <\/div>\n      <\/div>\n\n      <style>{`\n        @import url('https:\/\/fonts.googleapis.com\/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');\n        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }\n        @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }\n        ::-webkit-scrollbar{width:4px;height:4px}\n        ::-webkit-scrollbar-track{background:#0c1220}\n        ::-webkit-scrollbar-thumb{background:#1e2d45;border-radius:2px}\n      `}<\/style>\n\n      {\/* Portfolio Summary *\/}\n      <div style={{\n        display: \"grid\",\n        gridTemplateColumns: \"repeat(4, 1fr)\",\n        gap: 1,\n        background: \"#1e2d45\",\n        borderBottom: \"1px solid #1e2d45\",\n      }}>\n        {[\n          { label: \"PORTFOLIO VALUE\", value: `$${portfolio.value.toLocaleString(\"en-US\", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: \"#e8f0ff\" },\n          { label: \"P&L\", value: `${pnlAbs >= 0 ? \"+\" : \"\"}$${pnlAbs.toFixed(2)} (${pnlPct}%)`, color: pnlColor },\n          { label: \"CASH\", value: `$${portfolio.cash.toLocaleString(\"en-US\", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: \"#c8d6ef\" },\n          { label: \"ORDERS FILLED\", value: orders.length, color: \"#c8d6ef\" },\n        ].map(({ label, value, color }) => (\n          <div key={label} style={{\n            background: \"#090d14\",\n            padding: \"14px 20px\",\n          }}>\n            <div style={{ fontSize: 9, letterSpacing: \"0.18em\", color: \"#4a5a72\", marginBottom: 6 }}>{label}<\/div>\n            <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}<\/div>\n          <\/div>\n        ))}\n      <\/div>\n\n      {\/* Equity Curve *\/}\n      <div style={{ padding: \"16px 24px 0\", background: \"#090d14\" }}>\n        <div style={{ fontSize: 9, letterSpacing: \"0.18em\", color: \"#4a5a72\", marginBottom: 8 }}>EQUITY CURVE<\/div>\n        <svg width=\"100%\" height=\"54\" viewBox=\"0 0 340 54\" preserveAspectRatio=\"none\"\n          style={{ display: \"block\" }}>\n          <defs>\n            <linearGradient id=\"eg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n              <stop offset=\"0%\" stopColor={pnlColor} stopOpacity=\"0.15\" \/>\n              <stop offset=\"100%\" stopColor={pnlColor} stopOpacity=\"0\" \/>\n            <\/linearGradient>\n          <\/defs>\n          {equityCurve.length > 1 && (\n            <>\n              <polygon points={`0,54 ${ePts} 340,54`} fill=\"url(#eg)\" \/>\n              <polyline points={ePts} fill=\"none\" stroke={pnlColor}\n                strokeWidth=\"1.5\" strokeLinejoin=\"round\" strokeLinecap=\"round\" \/>\n            <\/>\n          )}\n        <\/svg>\n      <\/div>\n\n      {\/* Tabs *\/}\n      <div style={{\n        display: \"flex\",\n        gap: 0,\n        borderBottom: \"1px solid #1e2d45\",\n        padding: \"0 24px\",\n        marginTop: 16,\n      }}>\n        {[\"market\", \"positions\", \"orders\", \"log\"].map(tab => (\n          <button key={tab} onClick={() => setActiveTab(tab)} style={{\n            background: \"none\",\n            border: \"none\",\n            borderBottom: activeTab === tab ? \"2px solid #00e5a0\" : \"2px solid transparent\",\n            color: activeTab === tab ? \"#00e5a0\" : \"#4a5a72\",\n            padding: \"8px 16px\",\n            fontSize: 10,\n            fontWeight: 700,\n            letterSpacing: \"0.15em\",\n            cursor: \"pointer\",\n            textTransform: \"uppercase\",\n            marginBottom: -1,\n          }}>\n            {tab}\n          <\/button>\n        ))}\n      <\/div>\n\n      <div style={{ padding: \"16px 24px 32px\" }}>\n\n        {\/* MARKET TAB *\/}\n        {activeTab === \"market\" && (\n          <div style={{ display: \"flex\", flexDirection: \"column\", gap: 24 }}>\n            {Object.entries(SECTORS).map(([sector, syms]) => {\n              const sectorColors = {\n                \"AI \/ Infrastructure\": \"#7eb8ff\",\n                \"Defense\": \"#ff9f43\",\n                \"Fintech\": \"#00e5a0\",\n                \"EV \/ Mobility\": \"#c678ff\",\n              };\n              const sectorColor = sectorColors[sector] || \"#8892a4\";\n              return (\n                <div key={sector}>\n                  <div style={{ display: \"flex\", alignItems: \"center\", gap: 10, marginBottom: 10 }}>\n                    <div style={{ width: 3, height: 14, background: sectorColor, borderRadius: 2 }} \/>\n                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: \"0.2em\", color: sectorColor }}>\n                      {sector.toUpperCase()}\n                    <\/span>\n                    <div style={{ flex: 1, height: 1, background: sectorColor + \"20\" }} \/>\n                    <span style={{ fontSize: 9, color: \"#4a5a72\" }}>{syms.length} simboluri<\/span>\n                  <\/div>\n                  <div style={{ display: \"grid\", gridTemplateColumns: \"repeat(auto-fill, minmax(200px, 1fr))\", gap: 8 }}>\n                    {syms.map(sym => {\n                      const price = prices[sym];\n                      const hist = priceHistory[sym] || [];\n                      const prev = hist[hist.length - 2] || price;\n                      const chg = (price || 0) - (prev || 0);\n                      const chgPct = prev ? ((chg \/ prev) * 100).toFixed(2) : \"0.00\";\n                      const sig = signals[sym] || \"HOLD\";\n                      return (\n                        <div key={sym} style={{\n                          background: \"#0c1220\",\n                          border: \"1px solid #1e2d45\",\n                          borderRadius: 6,\n                          padding: \"12px 14px\",\n                          animation: \"fadeIn 0.2s ease\",\n                          position: \"relative\",\n                          overflow: \"hidden\",\n                        }}>\n                          <div style={{\n                            position: \"absolute\", top: 0, left: 0, right: 0, height: 2,\n                            background: sig === \"BUY\" ? \"#00e5a0\" : sig === \"SELL\" ? \"#ff4d6d\" : \"#1e2d45\",\n                          }} \/>\n                          <div style={{ display: \"flex\", justifyContent: \"space-between\", alignItems: \"flex-start\", marginBottom: 8 }}>\n                            <div style={{ fontSize: 13, fontWeight: 700, color: \"#e8f0ff\", letterSpacing: \"0.05em\" }}>{sym}<\/div>\n                            <div style={{\n                              fontSize: 9, fontWeight: 700, letterSpacing: \"0.12em\",\n                              color: signalColor(sig),\n                              background: signalBg(sig),\n                              padding: \"2px 7px\",\n                              borderRadius: 3,\n                              border: \"1px solid \" + signalColor(sig) + \"40\",\n                            }}>{sig}<\/div>\n                          <\/div>\n                          <div style={{ display: \"flex\", justifyContent: \"space-between\", alignItems: \"flex-end\" }}>\n                            <div>\n                              <div style={{ fontSize: 16, fontWeight: 700, color: \"#e8f0ff\" }}>\n                                ${price?.toFixed(2) ?? \"—\"}\n                              <\/div>\n                              <div style={{ fontSize: 10, color: chg >= 0 ? \"#00e5a0\" : \"#ff4d6d\", marginTop: 2 }}>\n                                {chg >= 0 ? \"▲\" : \"▼\"} {Math.abs(Number(chgPct))}%\n                              <\/div>\n                            <\/div>\n                            <Sparkline data={hist} color={chg >= 0 ? \"#00e5a0\" : \"#ff4d6d\"} \/>\n                          <\/div>\n                        <\/div>\n                      );\n                    })}\n                  <\/div>\n                <\/div>\n              );\n            })}\n          <\/div>\n        )}\n\n        {\/* POSITIONS TAB *\/}\n        {activeTab === \"positions\" && (\n          <div>\n            {Object.entries(portfolio.positions).filter(([, qty]) => qty > 0).length === 0 ? (\n              <div style={{ color: \"#4a5a72\", fontSize: 12, padding: \"32px 0\", textAlign: \"center\" }}>\n                Nicio poziție deschisă. Pornește sistemul pentru a începe trading.\n              <\/div>\n            ) : (\n              <table style={{ width: \"100%\", borderCollapse: \"collapse\", fontSize: 12 }}>\n                <thead>\n                  <tr style={{ borderBottom: \"1px solid #1e2d45\" }}>\n                    {[\"SYMBOL\", \"QTY\", \"PRICE\", \"VALUE\", \"SIGNAL\"].map(h => (\n                      <th key={h} style={{ textAlign: \"left\", padding: \"8px 12px\", fontSize: 9,\n                        letterSpacing: \"0.15em\", color: \"#4a5a72\", fontWeight: 700 }}>{h}<\/th>\n                    ))}\n                  <\/tr>\n                <\/thead>\n                <tbody>\n                  {Object.entries(portfolio.positions).filter(([, qty]) => qty > 0).map(([sym, qty]) => (\n                    <tr key={sym} style={{ borderBottom: \"1px solid #1e2d4540\" }}>\n                      <td style={{ padding: \"10px 12px\", color: \"#e8f0ff\", fontWeight: 700 }}>{sym}<\/td>\n                      <td style={{ padding: \"10px 12px\" }}>{qty}<\/td>\n                      <td style={{ padding: \"10px 12px\" }}>${prices[sym]?.toFixed(2)}<\/td>\n                      <td style={{ padding: \"10px 12px\", color: \"#00e5a0\" }}>\n                        ${(qty * (prices[sym] || 0)).toFixed(2)}\n                      <\/td>\n                      <td style={{ padding: \"10px 12px\" }}>\n                        <span style={{\n                          fontSize: 9, fontWeight: 700, letterSpacing: \"0.1em\",\n                          color: signalColor(signals[sym]),\n                          background: signalBg(signals[sym]),\n                          padding: \"2px 8px\", borderRadius: 3,\n                        }}>{signals[sym] || \"HOLD\"}<\/span>\n                      <\/td>\n                    <\/tr>\n                  ))}\n                <\/tbody>\n              <\/table>\n            )}\n          <\/div>\n        )}\n\n        {\/* ORDERS TAB *\/}\n        {activeTab === \"orders\" && (\n          <div>\n            {orders.length === 0 ? (\n              <div style={{ color: \"#4a5a72\", fontSize: 12, padding: \"32px 0\", textAlign: \"center\" }}>\n                Niciun ordin executat încă.\n              <\/div>\n            ) : (\n              <table style={{ width: \"100%\", borderCollapse: \"collapse\", fontSize: 12 }}>\n                <thead>\n                  <tr style={{ borderBottom: \"1px solid #1e2d45\" }}>\n                    {[\"ID\", \"SYMBOL\", \"SIDE\", \"QTY\", \"PRICE\", \"STATUS\", \"TIME\"].map(h => (\n                      <th key={h} style={{ textAlign: \"left\", padding: \"8px 12px\", fontSize: 9,\n                        letterSpacing: \"0.15em\", color: \"#4a5a72\", fontWeight: 700 }}>{h}<\/th>\n                    ))}\n                  <\/tr>\n                <\/thead>\n                <tbody>\n                  {orders.map((o, i) => (\n                    <tr key={i} style={{ borderBottom: \"1px solid #1e2d4530\",\n                      animation: i === 0 ? \"fadeIn 0.3s ease\" : \"none\" }}>\n                      <td style={{ padding: \"8px 12px\", fontSize: 10, color: \"#4a5a72\" }}>{o.id}<\/td>\n                      <td style={{ padding: \"8px 12px\", color: \"#e8f0ff\", fontWeight: 700 }}>{o.symbol}<\/td>\n                      <td style={{ padding: \"8px 12px\" }}>\n                        <span style={{\n                          fontSize: 9, fontWeight: 700, letterSpacing: \"0.1em\",\n                          color: o.side === \"BUY\" ? \"#00e5a0\" : \"#ff4d6d\",\n                        }}>{o.side}<\/span>\n                      <\/td>\n                      <td style={{ padding: \"8px 12px\" }}>{o.qty}<\/td>\n                      <td style={{ padding: \"8px 12px\" }}>${o.price?.toFixed(2)}<\/td>\n                      <td style={{ padding: \"8px 12px\" }}>\n                        <span style={{ fontSize: 9, color: \"#00e5a0\" }}>● {o.status}<\/span>\n                      <\/td>\n                      <td style={{ padding: \"8px 12px\", fontSize: 10, color: \"#4a5a72\" }}>\n                        {o.time?.toLocaleTimeString(\"en-US\", { hour12: false })}\n                      <\/td>\n                    <\/tr>\n                  ))}\n                <\/tbody>\n              <\/table>\n            )}\n          <\/div>\n        )}\n\n        {\/* LOG TAB *\/}\n        {activeTab === \"log\" && (\n          <div style={{ fontFamily: \"IBM Plex Mono, monospace\" }}>\n            {log.length === 0 ? (\n              <div style={{ color: \"#4a5a72\", fontSize: 12, padding: \"32px 0\", textAlign: \"center\" }}>\n                Pornește sistemul pentru a vedea log-ul.\n              <\/div>\n            ) : log.map((entry, i) => (\n              <div key={i} style={{\n                display: \"flex\", gap: 16, padding: \"5px 0\",\n                borderBottom: \"1px solid #1e2d4520\",\n                animation: i === 0 ? \"fadeIn 0.2s ease\" : \"none\",\n                fontSize: 11,\n              }}>\n                <span style={{ color: \"#4a5a72\", minWidth: 70 }}>{entry.time}<\/span>\n                <span style={{\n                  color: entry.type === \"buy\" ? \"#00e5a0\"\n                    : entry.type === \"sell\" ? \"#ff4d6d\"\n                    : entry.type === \"system\" ? \"#7eb8ff\"\n                    : \"#8892a4\",\n                }}>{entry.msg}<\/span>\n              <\/div>\n            ))}\n          <\/div>\n        )}\n      <\/div>\n\n      {\/* Strategy Info Footer *\/}\n      <div style={{\n        position: \"fixed\", bottom: 0, left: 0, right: 0,\n        background: \"#0c1220\",\n        borderTop: \"1px solid #1e2d45\",\n        padding: \"8px 24px\",\n        display: \"flex\",\n        gap: 24,\n        fontSize: 9,\n        letterSpacing: \"0.12em\",\n        color: \"#4a5a72\",\n      }}>\n        <span>STRATEGIE: SMA CROSSOVER (5\/20) + RSI FILTER<\/span>\n        <span>•<\/span>\n        <span>INTERVAL: 1.5s<\/span>\n        <span>•<\/span>\n        <span>UNIVERSE: {SYMBOLS.length} SIMBOLURI<\/span>\n        <span>•<\/span>\n        <span style={{ color: \"#ffb830\" }}>MODE: OBSERVE ONLY — FĂRĂ EXECUȚIE<\/span>\n      <\/div>\n    <\/div>\n  );\n}\n",
  "stderr" : ""
}