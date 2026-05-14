import { useState, useRef, useCallback } from "react";

const STEPS = [
  "ตรวจสอบสีแท่งเทียนที่มากที่สุด",
  "ตรวจสอบแท่งเทียนติดกัน ≥2 แท่ง > 70%",
  "ตรวจสอบ Pattern สัญญาณ",
  "สรุปผล",
];

function StepIndicator({ current, steps }) {
  return (
    <div className="steps-row">
      {steps.map((s, i) => (
        <div key={i} className={`step-item ${i < current ? "done" : i === current ? "active" : ""}`}>
          <div className="step-dot">
            {i < current ? (
              <svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
            ) : (
              <span>{i + 1}</span>
            )}
          </div>
          <div className="step-label">{s}</div>
          {i < steps.length - 1 && <div className="step-line" />}
        </div>
      ))}
    </div>
  );
}

function SignalBadge({ signal }) {
  if (!signal) return null;
  const isBuy = signal === "BUY";
  return (
    <div className={`signal-badge ${isBuy ? "buy" : "sell"}`}>
      <div className="signal-pulse" />
      <div className="signal-icon">{isBuy ? "📈" : "📉"}</div>
      <div className="signal-text">
        <div className="signal-main">{isBuy ? "✅ ขา BUY อนุมัติเทรด" : "✅ ขา SELL อนุมัติเทรด"}</div>
        <div className="signal-sub">{isBuy ? "พบ Pattern แดง → เขียว → เขียว" : "พบ Pattern เขียว → แดง → แดง"}</div>
      </div>
    </div>
  );
}

function NoSignalBadge() {
  return (
    <div className="signal-badge neutral">
      <div className="signal-icon">⚠️</div>
      <div className="signal-text">
        <div className="signal-main">รอสัญญาณต่อไป</div>
        <div className="signal-sub">ยังไม่พบ Pattern ที่ตรงเงื่อนไข</div>
      </div>
    </div>
  );
}

function AnalysisStep({ title, status, detail }) {
  const icons = { pass: "✅", fail: "❌", pending: "⏳", running: "🔄" };
  return (
    <div className={`analysis-step ${status}`}>
      <div className="astep-icon">{icons[status] || "○"}</div>
      <div className="astep-body">
        <div className="astep-title">{title}</div>
        {detail && <div className="astep-detail">{detail}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setImage(url);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const analyze = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const prompt = `You are an expert candlestick chart pattern analyzer. Carefully examine ALL candles in the chart image from left to right.

Perform EXACTLY these 3 steps and return JSON only (no markdown, no extra text).

━━━ STEP 1: Dominant Color ━━━
- Count ALL green (bullish/up) candles and ALL red (bearish/down) candles in the entire chart
- dominantColor = whichever has more candles ("green" or "red"). If equal → "neutral"
- step1Pass = true only if dominantColor is "green" or "red" (not neutral)

━━━ STEP 2: Consecutive Groups > 70% ━━━
Only if step1Pass is true:
- Find ALL groups of 2 or more consecutive candles of the DOMINANT color
- Sum up how many candles are inside those groups
- consecutivePercent = (sum of candles in groups ÷ totalCount) × 100
- step2Pass = true if consecutivePercent > 70

━━━ STEP 3: Historical Pattern Scan ━━━
Only if step2Pass is true. Scan the ENTIRE chart history (all candles, left to right):

IF dominantColor = "green" (BUY side):
  Search anywhere in the chart for this sequence:
  [one or more RED candles in a row] → [GREEN candle] → [GREEN candle]
  = red streak ending, then 2 consecutive green candles appear
  If this pattern exists ANYWHERE in the chart → patternFound = true, signal = "BUY"

IF dominantColor = "red" (SELL side):
  Search anywhere in the chart for this sequence:
  [one or more GREEN candles in a row] → [RED candle] → [RED candle]
  = green streak ending, then 2 consecutive red candles appear
  If this pattern exists ANYWHERE in the chart → patternFound = true, signal = "SELL"

If pattern NOT found → patternFound = false, signal = "NONE"
If step2Pass = false → skip step 3, signal = "NONE"

━━━ OUTPUT FORMAT ━━━
Return ONLY this JSON object, nothing else:
{
  "greenCount": <integer>,
  "redCount": <integer>,
  "totalCount": <integer>,
  "dominantColor": "green" | "red" | "neutral",
  "step1Pass": true | false,
  "step1Detail": "<Thai: e.g. พบแท่งเขียว 15 แท่ง แท่งแดง 8 แท่ง สีเขียวมากกว่า>",
  "consecutiveGroupsCount": <integer, number of qualifying groups>,
  "consecutivePercent": <float 0-100>,
  "step2Pass": true | false,
  "step2Detail": "<Thai: e.g. พบ 3 กลุ่มติดกัน รวม 16 แท่ง คิดเป็น 69.5% ของทั้งหมด>",
  "patternFound": true | false,
  "patternDetail": "<Thai: describe WHERE the pattern was found, e.g. พบ Pattern แดง→เขียว→เขียว ที่แท่งที่ 12-14>",
  "signal": "BUY" | "SELL" | "NONE",
  "summary": "<Thai: 1-2 sentence overall conclusion>"
}`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
              { type: "text", text: prompt }
            ]
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
    } catch (err) {
      setError("วิเคราะห์ไม่สำเร็จ: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentStep = result
    ? result.signal !== "NONE" ? 4
      : !result.step2Pass ? 2
      : !result.patternFound ? 3
      : 4
    : 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans+Thai:wght@300;400;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #0a0c10;
          color: #e2e8f0;
          font-family: 'Noto Sans Thai', sans-serif;
          min-height: 100vh;
        }

        .app {
          min-height: 100vh;
          background: #0a0c10;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16,185,129,0.08) 0%, transparent 60%),
            linear-gradient(180deg, transparent 60%, rgba(16,185,129,0.03) 100%);
          padding: 24px 16px 48px;
        }

        header {
          text-align: center;
          margin-bottom: 32px;
        }
        .header-tag {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 3px;
          color: #10b981;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        h1 {
          font-size: clamp(22px, 5vw, 32px);
          font-weight: 700;
          color: #f0fdf4;
          letter-spacing: -0.5px;
          line-height: 1.2;
        }
        h1 span { color: #10b981; }
        .header-sub {
          margin-top: 8px;
          font-size: 13px;
          color: #64748b;
        }

        .container {
          max-width: 760px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .card {
          background: #111318;
          border: 1px solid #1e2530;
          border-radius: 16px;
          padding: 20px;
        }

        /* Upload zone */
        .upload-zone {
          border: 2px dashed #1e3a2a;
          border-radius: 12px;
          padding: 40px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #0d1a12;
        }
        .upload-zone:hover, .upload-zone.drag { border-color: #10b981; background: #0d2018; }
        .upload-icon { font-size: 40px; margin-bottom: 12px; }
        .upload-title { font-size: 15px; font-weight: 600; color: #94a3b8; margin-bottom: 4px; }
        .upload-sub { font-size: 12px; color: #475569; }

        .preview-wrap {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #1e2530;
          background: #0d0f14;
        }
        .preview-wrap img { width: 100%; display: block; max-height: 320px; object-fit: contain; }
        .preview-change {
          position: absolute; top: 10px; right: 10px;
          background: rgba(0,0,0,0.7); border: 1px solid #334155;
          color: #94a3b8; font-size: 12px; padding: 4px 10px;
          border-radius: 6px; cursor: pointer; backdrop-filter: blur(4px);
        }
        .preview-change:hover { color: #e2e8f0; border-color: #64748b; }

        .btn-analyze {
          width: 100%; padding: 14px;
          background: linear-gradient(135deg, #10b981, #059669);
          color: white; font-family: 'Noto Sans Thai', sans-serif;
          font-size: 15px; font-weight: 700;
          border: none; border-radius: 12px; cursor: pointer;
          transition: all 0.2s; letter-spacing: 0.3px;
          box-shadow: 0 4px 20px rgba(16,185,129,0.25);
        }
        .btn-analyze:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(16,185,129,0.35); }
        .btn-analyze:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .loading-bar {
          height: 3px; background: #1e2530; border-radius: 99px; overflow: hidden;
          margin-top: 12px;
        }
        .loading-fill {
          height: 100%; background: linear-gradient(90deg, #10b981, #34d399);
          animation: loadrun 1.5s ease-in-out infinite;
          width: 40%;
        }
        @keyframes loadrun {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .loading-text { text-align: center; font-size: 12px; color: #64748b; margin-top: 8px; font-family: 'Space Mono', monospace; }

        /* Steps */
        .steps-row {
          display: flex; align-items: flex-start; gap: 0;
          overflow-x: auto; padding-bottom: 4px;
        }
        .step-item {
          display: flex; flex-direction: column; align-items: center;
          position: relative; flex: 1; min-width: 60px;
        }
        .step-dot {
          width: 28px; height: 28px; border-radius: 50%;
          background: #1e2530; border: 2px solid #334155;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; color: #64748b; font-family: 'Space Mono', monospace;
          transition: all 0.3s; z-index: 1;
        }
        .step-item.done .step-dot { background: #10b981; border-color: #10b981; color: white; }
        .step-item.active .step-dot { background: #0d2018; border-color: #10b981; color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.2); }
        .step-label { font-size: 10px; color: #475569; text-align: center; margin-top: 6px; max-width: 70px; line-height: 1.3; }
        .step-item.done .step-label, .step-item.active .step-label { color: #94a3b8; }
        .step-line {
          position: absolute; top: 14px; left: 50%; width: 100%; height: 2px;
          background: #1e2530; z-index: 0;
        }
        .step-item.done .step-line { background: #10b981; }

        /* Analysis steps */
        .analysis-step {
          display: flex; gap: 12px; padding: 12px;
          border-radius: 10px; border: 1px solid #1e2530;
          background: #0d0f14; margin-bottom: 8px;
          transition: all 0.2s;
        }
        .analysis-step.pass { border-color: #1a3a2a; background: #0d1a12; }
        .analysis-step.fail { border-color: #3a1a1a; background: #1a0d0d; }
        .astep-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .astep-title { font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 3px; }
        .astep-detail { font-size: 12px; color: #64748b; line-height: 1.5; }

        /* Stats row */
        .stats-row { display: flex; gap: 10px; }
        .stat-box {
          flex: 1; padding: 12px; border-radius: 10px;
          border: 1px solid #1e2530; background: #0d0f14; text-align: center;
        }
        .stat-value { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; }
        .stat-value.green { color: #10b981; }
        .stat-value.red { color: #ef4444; }
        .stat-label { font-size: 11px; color: #64748b; margin-top: 3px; }

        /* Signal */
        .signal-badge {
          display: flex; align-items: center; gap: 16px;
          padding: 20px; border-radius: 14px;
          position: relative; overflow: hidden;
        }
        .signal-badge.buy { background: linear-gradient(135deg, #0d2018, #0d3020); border: 1px solid #10b981; }
        .signal-badge.sell { background: linear-gradient(135deg, #200d0d, #300d0d); border: 1px solid #ef4444; }
        .signal-badge.neutral { background: #111318; border: 1px solid #334155; }
        .signal-pulse {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: radial-gradient(circle at 20% 50%, rgba(16,185,129,0.06) 0%, transparent 60%);
          pointer-events: none;
        }
        .signal-badge.sell .signal-pulse {
          background: radial-gradient(circle at 20% 50%, rgba(239,68,68,0.06) 0%, transparent 60%);
        }
        .signal-icon { font-size: 36px; }
        .signal-main { font-size: 20px; font-weight: 700; color: #f0fdf4; }
        .signal-badge.sell .signal-main { color: #fef2f2; }
        .signal-sub { font-size: 12px; margin-top: 3px; }
        .signal-badge.buy .signal-sub { color: #10b981; }
        .signal-badge.sell .signal-sub { color: #ef4444; }

        .summary-text { font-size: 13px; color: #94a3b8; line-height: 1.6; padding: 12px; background: #0d0f14; border-radius: 10px; border: 1px solid #1e2530; }

        .section-title { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #475569; font-family: 'Space Mono', monospace; margin-bottom: 12px; }

        .error-box { background: #1a0d0d; border: 1px solid #7f1d1d; border-radius: 10px; padding: 14px; color: #fca5a5; font-size: 13px; }
      `}</style>

      <div className="app">
        <header>
          <div className="header-tag">◈ Chart Pattern AI</div>
          <h1>วิเคราะห์ <span>แท่งเทียน</span> อัตโนมัติ</h1>
          <div className="header-sub">อัพโหลดกราฟ → AI วิเคราะห์ Pattern → รับสัญญาณเทรด</div>
        </header>

        <div className="container">
          {/* Upload */}
          <div className="card">
            <div className="section-title">📊 อัพโหลดกราฟ</div>
            {!image ? (
              <div
                className={`upload-zone ${dragOver ? "drag" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current.click()}
              >
                <div className="upload-icon">📈</div>
                <div className="upload-title">ลากรูปภาพมาวางที่นี่ หรือคลิกเพื่อเลือก</div>
                <div className="upload-sub">รองรับ JPG, PNG, WEBP</div>
              </div>
            ) : (
              <div className="preview-wrap">
                <img src={image} alt="chart" />
                <button className="preview-change" onClick={() => fileRef.current.click()}>เปลี่ยนรูป</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />

            <div style={{ marginTop: 16 }}>
              <button className="btn-analyze" disabled={!image || loading} onClick={analyze}>
                {loading ? "🔍 กำลังวิเคราะห์..." : "🚀 วิเคราะห์ Pattern"}
              </button>
              {loading && (
                <>
                  <div className="loading-bar"><div className="loading-fill" /></div>
                  <div className="loading-text">AI กำลังอ่านแท่งเทียน...</div>
                </>
              )}
            </div>
          </div>

          {/* Steps */}
          {(loading || result) && (
            <div className="card">
              <div className="section-title">🔄 ขั้นตอนการวิเคราะห์</div>
              <StepIndicator current={loading ? 0 : currentStep} steps={STEPS} />
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Stats */}
              <div className="card">
                <div className="section-title">📊 สถิติแท่งเทียน</div>
                <div className="stats-row">
                  <div className="stat-box">
                    <div className="stat-value green">{result.greenCount}</div>
                    <div className="stat-label">แท่งเขียว 🟢</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value red">{result.redCount}</div>
                    <div className="stat-label">แท่งแดง 🔴</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value" style={{ color: "#94a3b8" }}>{result.totalCount}</div>
                    <div className="stat-label">ทั้งหมด</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-value" style={{ color: result.consecutivePercent > 70 ? "#10b981" : "#f59e0b" }}>{result.consecutivePercent?.toFixed(0)}%</div>
                    <div className="stat-label">ติดกัน</div>
                  </div>
                </div>
              </div>

              {/* Step analysis */}
              <div className="card">
                <div className="section-title">🔍 ผลการตรวจสอบ</div>
                <AnalysisStep
                  title="Step 1 — สีแท่งเทียนที่มากที่สุด"
                  status={result.step1Pass ? "pass" : "fail"}
                  detail={result.step1Detail}
                />
                <AnalysisStep
                  title="Step 2 — แท่งติดกัน ≥2 แท่ง มากกว่า 70%"
                  status={!result.step1Pass ? "pending" : result.step2Pass ? "pass" : "fail"}
                  detail={result.step2Pass || result.step1Pass ? result.step2Detail : undefined}
                />
                <AnalysisStep
                  title="Step 3 — สแกน Pattern ย้อนหลังทั้งกราฟ"
                  status={!result.step2Pass ? "pending" : result.patternFound ? "pass" : "fail"}
                  detail={result.step2Pass ? (result.patternDetail || (result.dominantColor === "green" ? "ค้นหา Pattern: แดง(≥1) → เขียว → เขียว" : "ค้นหา Pattern: เขียว(≥1) → แดง → แดง")) : undefined}
                />
              </div>

              {/* Signal */}
              <div className="card">
                <div className="section-title">🎯 สัญญาณการเทรด</div>
                {result.signal === "BUY" && <SignalBadge signal="BUY" />}
                {result.signal === "SELL" && <SignalBadge signal="SELL" />}
                {result.signal === "NONE" && <NoSignalBadge />}
                {result.summary && (
                  <div className="summary-text" style={{ marginTop: 12 }}>
                    💬 {result.summary}
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="card">
              <div className="error-box">⚠️ {error}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
