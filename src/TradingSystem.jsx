import { useState, useEffect, useRef, useCallback } from "react";

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
  CRWD: 382.4, NOW: 812.5, META: 512.1, MU: 98.7,
  CEG: 274.3, PLTR: 38.6, TSLA: 248.3, ZS: 178.9,
  CRDO: 52.4, ALAB: 88.2, CLS: 41.7, NVDA: 875.4,
  AMD: 162.8, SOFI: 14.8, HOOD: 21.3, LEU: 62.5,
};

class StrategyEngine {
  constructor() {
    this.priceHistory = {};
    SYMBOLS.forEach(s => { this.priceHistory[s] = []; });
  }
  addPrice(symbol, price) {
    this.priceHistory[symbol].push(price);
    if (this.priceHistory[symbol].length > 50) this.priceHistory[symbol].shift();
  }
  sma(symbol, period) {
    const h = this.priceHistory[symbol];
    if (h.length < period) return null;
    return h.slice(-period).reduce((a, b) => a + b, 0) / period;
  }
  rsi(symbol, period = 14) {
    const h = this.priceHistory[symbol];
    if (h.length < period + 1) return 50;
    const changes = h.slice(-period - 1).map((v, i, a) => i > 0 ? v - a[i - 1] : 0).slice(1);
    const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
    if (losses === 0) return 100;
    return +(100 - 100 / (1 + gains / losses)).toFixed(1);
  }
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

class OrderManager {
  constructor(initialCash = 100000) {
    this.cash = initialCash;
    this.positions = {};
    this.orders = [];
  }
  portfolioValue(prices) {
    return Object.entries(this.positions).reduce((sum, [sym, qty]) => sum + (prices[sym] || 0) * qty, this.cash);
  }
}

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const w = 80, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export default function TradingSystem() {
  const [prices, setPrices] = useState({ ...initialPrices });
  const [priceHistory, setPriceHistory] = useState(() => { const h = {}; SYMBOLS.forEach(s => { h[s] = [initialPrices[s]]; }); return h; });
  const [signals, setSignals] = useState({});
  const [orders] = useState([]);
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
    setLog(prev => [{ msg, type, time: new Date().toLocaleTimeString("en-US", { hour12: false }) }, ...prev].slice(0, 100));
  }, []);
  const runTick = useCallback(() => {
    const eng = engineRef.current;
    const om = omRef.current;
    const newPrices = {};
    SYMBOLS.forEach(s => { newPrices[s] = generatePrice(prices[s] || initialPrices[s]); eng.addPrice(s, newPrices[s]); });
    const newSignals = {};
    SYMBOLS.forEach(s => {
      const sig = eng.signal(s);
      newSignals[s] = sig;
      if (sig !== "HOLD") addLog(`SEMNAL ${sig} detectat pentru ${s} @ $${newPrices[s]} — nicio execuție`, sig === "BUY" ? "buy" : "sell");
    });
    const totalValue = om.portfolioValue(newPrices);
    setPrices(newPrices);
    setPriceHistory(prev => { const h = { ...prev }; SYMBOLS.forEach(s => { h[s] = [...(h[s] || []), newPrices[s]].slice(-40); }); return h; });
    setSignals(newSignals);
    setPortfolio({ cash: om.cash, value: totalValue, positions: { ...om.positions } });
    setEquityCurve(prev => [...prev, totalValue].slice(-60));
    setTick(t => t + 1);
  }, [prices, addLog]);
  useEffect(() => {
    if (running) { intervalRef.current = setInterval(runTick, 1500); addLog("Sistema pornit", "system"); }
    else { clearInterval(intervalRef.current); if (tick > 0) addLog("Sistema oprit", "system"); }
    return () => clearInterval(intervalRef.current);
  }, [running, runTick]);

  const pnlAbs = portfolio.value - 100000;
  const pnlPct = ((pnlAbs / 100000) * 100).toFixed(2);
  const pnlColor = pnlAbs >= 0 ? "#00e5a0" : "#ff4d6d";
  const signalColor = s => s === "BUY" ? "#00e5a0" : s === "SELL" ? "#ff4d6d" : "#8892a4";
  const signalBg = s => s === "BUY" ? "#00e5a01a" : s === "SELL" ? "#ff4d6d1a" : "#8892a410";
  const eMin = Math.min(...equityCurve), eMax = Math.max(...equityCurve);
  const eRange = eMax - eMin || 1;
  const ePts = equityCurve.map((v, i) => `${(i / Math.max(equityCurve.length - 1, 1)) * 340},${50 - ((v - eMin) / eRange) * 46}`).join(" ");
  const sectorColors = { "AI / Infrastructure": "#7eb8ff", "Defense": "#ff9f43", "Fintech": "#00e5a0", "EV / Mobility": "#c678ff" };

  return (
    <div style={{ background: "#090d14", minHeight: "100vh", fontFamily: "'IBM Plex Mono','Courier New',monospace", color: "#c8d6ef", padding: 0, overflowX: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap'); @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}} @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ background: "#0c1220", borderBottom: "1px solid #1e2d45", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#00e5a0" : "#8892a4", boxShadow: running ? "0 0 8px #00e5a0" : "none", animation: running ? "pulse 1.5s infinite" : "none" }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.15em", color: "#e8f0ff" }}>QUANT TRADER</span>
          <span style={{ fontSize: 11, color: "#4a5a72" }}>v1.0 • PAPER</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, color: "#4a5a72" }}>TICK #{tick}</span>
          <button onClick={() => setRunning(r => !r)} style={{ background: running ? "#ff4d6d18" : "#00e5a018", border: `1px solid ${running ? "#ff4d6d60" : "#00e5a060"}`, color: running ? "#ff4d6d" : "#00e5a0", padding: "6px 18px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {running ? "■ STOP" : "▶ START"}
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "#1e2d45" }}>
        {[{ label: "PORTFOLIO VALUE", value: `$${portfolio.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, color: "#e8f0ff" }, { label: "P&L", value: `${pnlAbs >= 0 ? "+" : ""}$${pnlAbs.toFixed(2)} (${pnlPct}%)`, color: pnlColor }, { label: "CASH", value: `$${portfolio.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, color: "#c8d6ef" }, { label: "SEMNALE", value: orders.length, color: "#c8d6ef" }].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#090d14", padding: "14px 20px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#4a5a72", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: "16px 24px 0", background: "#090d14" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#4a5a72", marginBottom: 8 }}>EQUITY CURVE</div>
        <svg width="100%" height="54" viewBox="0 0 340 54" preserveAspectRatio="none">
          <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={pnlColor} stopOpacity="0.15" /><stop offset="100%" stopColor={pnlColor} stopOpacity="0" /></linearGradient></defs>
          {equityCurve.length > 1 && <><polygon points={`0,54 ${ePts} 340,54`} fill="url(#eg)" /><polyline points={ePts} fill="none" stroke={pnlColor} strokeWidth="1.5" strokeLinejoin="round" /></>}
        </svg>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1e2d45", padding: "0 24px", marginTop: 16 }}>
        {["market", "log"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: "none", border: "none", borderBottom: activeTab === tab ? "2px solid #00e5a0" : "2px solid transparent", color: activeTab === tab ? "#00e5a0" : "#4a5a72", padding: "8px 16px", fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", cursor: "pointer", textTransform: "uppercase", marginBottom: -1 }}>
            {tab}
          </button>
        ))}
      </div>
      <div style={{ padding: "16px 24px 60px" }}>
        {activeTab === "market" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {Object.entries(SECTORS).map(([sector, syms]) => {
              const sc = sectorColors[sector] || "#8892a4";
              return (
                <div key={sector}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 3, height: 14, background: sc, borderRadius: 2 }} />
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.2em", color: sc }}>{sector.toUpperCase()}</span>
                    <div style={{ flex: 1, height: 1, background: sc + "20" }} />
                    <span style={{ fontSize: 9, color: "#4a5a72" }}>{syms.length} simboluri</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
                    {syms.map(sym => {
                      const price = prices[sym];
                      const hist = priceHistory[sym] || [];
                      const prev = hist[hist.length - 2] || price;
                      const chg = (price || 0) - (prev || 0);
                      const chgPct = prev ? ((chg / prev) * 100).toFixed(2) : "0.00";
                      const sig = signals[sym] || "HOLD";
                      return (
                        <div key={sym} style={{ background: "#0c1220", border: "1px solid #1e2d45", borderRadius: 6, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: sig === "BUY" ? "#00e5a0" : sig === "SELL" ? "#ff4d6d" : "#1e2d45" }} />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f0ff" }}>{sym}</div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: signalColor(sig), background: signalBg(sig), padding: "2px 7px", borderRadius: 3, border: "1px solid " + signalColor(sig) + "40" }}>{sig}</div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0ff" }}>${price?.toFixed(2) ?? "—"}</div>
                              <div style={{ fontSize: 10, color: chg >= 0 ? "#00e5a0" : "#ff4d6d", marginTop: 2 }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(Number(chgPct))}%</div>
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
        {activeTab === "log" && (
          <div>
            {log.length === 0 ? <div style={{ color: "#4a5a72", fontSize: 12, padding: "32px 0", textAlign: "center" }}>Pornește sistemul pentru a vedea log-ul.</div>
              : log.map((entry, i) => (
                <div key={i} style={{ display: "flex", gap: 16, padding: "5px 0", borderBottom: "1px solid #1e2d4520", fontSize: 11 }}>
                  <span style={{ color: "#4a5a72", minWidth: 70 }}>{entry.time}</span>
                  <span style={{ color: entry.type === "buy" ? "#00e5a0" : entry.type === "sell" ? "#ff4d6d" : entry.type === "system" ? "#7eb8ff" : "#8892a4" }}>{entry.msg}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0c1220", borderTop: "1px solid #1e2d45", padding: "8px 24px", display: "flex", gap: 16, fontSize: 9, letterSpacing: "0.1em", color: "#4a5a72" }}>
        <span>SMA 5/20 + RSI</span><span>•</span><span>{SYMBOLS.length} SIMBOLURI</span><span>•</span>
        <span style={{ color: "#ffb830" }}>OBSERVE ONLY</span>
      </div>
    </div>
  );
}
