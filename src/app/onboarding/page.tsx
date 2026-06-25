"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrader, profileToAgentDefaults, type RiskTolerance, type TradingExperience, type TradingGoal } from "@/store/trader";
import { api, type AgentConfig } from "@/lib/api";
import { CheckCircle, ChevronRight, TrendingUp, Link2, Link2Off, Mail, Download } from "lucide-react";

const SERIF  = "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const MONO   = "'SF Mono', 'Fira Code', monospace";
const DISPLAY = "'Times New Roman', Times, Georgia, serif";

// ── Option card ───────────────────────────────────────────────────────────────

function OptionCard({
  selected, onClick, title, description, badge,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "16px 18px",
        background: selected ? "rgba(11,31,58,0.06)" : "var(--bg-raised)",
        border: `2px solid ${selected ? "var(--blue)" : "var(--border)"}`,
        cursor: "pointer", transition: "all 0.15s",
        display: "flex", alignItems: "flex-start", gap: "12px",
      }}
    >
      <span style={{
        flexShrink: 0, marginTop: "2px",
        width: "16px", height: "16px",
        borderRadius: "50%",
        border: `2px solid ${selected ? "var(--blue)" : "var(--border)"}`,
        background: selected ? "var(--blue)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {selected && <CheckCircle size={10} color="#fff" />}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontFamily: SERIF, fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {title}
          </span>
          {badge && (
            <span style={{
              fontSize: "9px", fontWeight: 700, padding: "1px 6px",
              background: "rgba(11,31,58,0.08)", color: "var(--blue)",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>{badge}</span>
          )}
        </div>
        <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginTop: "4px", lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
    </button>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginBottom: "32px" }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{
          width: i < current ? "20px" : "8px", height: "8px",
          background: i < current ? "var(--blue)" : i === current ? "var(--blue)" : "var(--border)",
          opacity: i === current ? 1 : i < current ? 0.5 : 0.3,
          transition: "all 0.3s",
        }} />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setOnboarding, setBeginnerMode, setPortfolioCapital, onboarding } = useTrader();

  const [step, setStep] = useState(0);
  const [accountSize, setAccountSizeRaw] = useState(
    onboarding.accountSize > 0 ? String(onboarding.accountSize) : ""
  );
  const [risk, setRisk]           = useState<RiskTolerance>(onboarding.riskTolerance);
  const [experience, setExp]      = useState<TradingExperience>(onboarding.experience);
  const [goal, setGoal]           = useState<TradingGoal>(onboarding.goal);
  const [brokerConnected, setBroker] = useState(onboarding.brokerConnected);
  const [email, setEmail]         = useState(onboarding.email ?? "");
  const [saving, setSaving]       = useState(false);
  const [importedConfig, setImportedConfig] = useState<AgentConfig | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  // Auto-import shared agent config from ?agent= URL param
  useEffect(() => {
    const blob = searchParams.get("agent");
    if (!blob) return;
    setImportStatus("loading");
    api.agent.importConfig(blob)
      .then(cfg => { setImportedConfig(cfg); setImportStatus("ok"); })
      .catch(() => setImportStatus("error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsedAccount = parseInt(accountSize.replace(/[^0-9]/g, ""), 10) || 10_000;

  async function finish() {
    setSaving(true);
    const profile = {
      completed: true,
      accountSize: parsedAccount,
      riskTolerance: risk,
      experience,
      goal,
      email,
      brokerConnected,
      tutorialSeen: onboarding.tutorialSeen,
    };
    const defaults = profileToAgentDefaults(profile);

    setOnboarding(profile);
    setBeginnerMode(defaults.beginnerMode);
    setPortfolioCapital(parsedAccount);

    try {
      const agentUpdate: Record<string, unknown> = {
        kelly_cap_pct:  defaults.kellyCapPct,
        min_confidence: defaults.minConfidence,
        horizon:        defaults.horizon,
      };
      if (email) agentUpdate.notify_email = email;
      await api.agent.setConfig(agentUpdate);
    } catch {
      // Agent may not be running; non-fatal
    }

    router.push("/");
  }

  const TOTAL_STEPS = 6;

  const canAdvance = [
    parsedAccount >= 100,   // step 0: account size
    true,                   // step 1: risk
    true,                   // step 2: experience
    true,                   // step 3: goal
    true,                   // step 4: broker (optional)
    true,                   // step 5: email (optional)
  ][step];

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg-base)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px 16px",
    }}>
      <div style={{ width: "100%", maxWidth: "520px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "6px" }}>
            <TrendingUp size={20} color="var(--blue)" strokeWidth={2.5} />
            <span style={{ fontFamily: DISPLAY, fontSize: "20px", fontWeight: 700, color: "var(--blue)" }}>
              QuantTrader
            </span>
          </div>
          <p style={{ fontFamily: SERIF, fontSize: "13px", color: "var(--text-muted)" }}>
            Let&apos;s set up your profile so the system works for your situation.
          </p>
        </div>

        {/* Shared-config import banner */}
        {importStatus === "loading" && (
          <div style={{
            marginBottom: "20px", padding: "12px 16px",
            background: "rgba(11,31,58,0.04)", border: "1px solid var(--border)",
            fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)",
          }}>
            Importing shared agent configuration…
          </div>
        )}
        {importStatus === "ok" && importedConfig && (
          <div style={{
            marginBottom: "20px", padding: "14px 16px",
            background: "rgba(26,107,74,0.06)", border: "1px solid rgba(26,107,74,0.3)",
            display: "flex", gap: "12px", alignItems: "flex-start",
          }}>
            <Download size={16} style={{ color: "#1A6B4A", flexShrink: 0, marginTop: "1px" }} />
            <div>
              <div style={{ fontFamily: SERIF, fontSize: "13px", fontWeight: 600, color: "#1A6B4A", marginBottom: "4px" }}>
                Shared agent config imported
              </div>
              <div style={{ fontFamily: SERIF, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Horizon: <strong>{importedConfig.horizon}</strong> · Symbols: <strong>{importedConfig.symbols?.slice(0, 5).join(", ")}{(importedConfig.symbols?.length ?? 0) > 5 ? "…" : ""}</strong> ·
                Min confidence: <strong>{((importedConfig.min_confidence ?? 0) * 100).toFixed(0)}%</strong>.
                Complete the steps below to finish your profile.
              </div>
            </div>
          </div>
        )}
        {importStatus === "error" && (
          <div style={{
            marginBottom: "20px", padding: "12px 16px",
            background: "rgba(196,30,58,0.06)", border: "1px solid rgba(196,30,58,0.3)",
            fontFamily: SERIF, fontSize: "12px", color: "var(--red)",
          }}>
            Could not import shared config — the link may be invalid or expired.
          </div>
        )}

        <StepDots total={TOTAL_STEPS} current={step} />

        {/* Step 0 — Account size */}
        {step === 0 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              How much are you trading with?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              This sets your position sizing defaults. You can change it anytime.
            </p>
            <div style={{ position: "relative", marginBottom: "8px" }}>
              <span style={{
                position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)",
                fontFamily: MONO, fontSize: "16px", color: "var(--text-muted)",
              }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={accountSize}
                onChange={e => setAccountSizeRaw(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="10,000"
                style={{
                  width: "100%", padding: "14px 14px 14px 28px",
                  fontFamily: MONO, fontSize: "20px", fontWeight: 700,
                  color: "var(--text-primary)", background: "var(--bg-raised)",
                  border: "2px solid var(--border)", outline: "none",
                  letterSpacing: "0.02em",
                }}
                onFocus={e => (e.target.style.borderColor = "var(--blue)")}
                onBlur={e => (e.target.style.borderColor = "var(--border)")}
              />
            </div>
            {parsedAccount > 0 && parsedAccount < 100 && (
              <p style={{ fontFamily: SERIF, fontSize: "11px", color: "var(--red)", marginBottom: "4px" }}>
                Minimum $100 to enable position sizing.
              </p>
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              {[1_000, 5_000, 10_000, 25_000, 50_000, 100_000].map(v => (
                <button key={v} onClick={() => setAccountSizeRaw(String(v))}
                  style={{
                    fontFamily: MONO, fontSize: "11px", padding: "4px 10px",
                    background: parsedAccount === v ? "var(--blue)" : "var(--bg-raised)",
                    color: parsedAccount === v ? "#fff" : "var(--text-muted)",
                    border: `1px solid ${parsedAccount === v ? "var(--blue)" : "var(--border)"}`,
                    cursor: "pointer", transition: "all 0.15s",
                  }}>
                  ${v.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1 — Risk tolerance */}
        {step === 1 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              What&apos;s your risk tolerance?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              This controls position sizing and signal confidence thresholds.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={risk === "conservative"}
                onClick={() => setRisk("conservative")}
                title="Conservative"
                description="Smaller positions (up to 5% per trade), higher confidence bar (80%). Prioritises capital preservation over returns."
              />
              <OptionCard
                selected={risk === "moderate"}
                onClick={() => setRisk("moderate")}
                title="Moderate"
                badge="Recommended"
                description="Balanced positions (up to 12% per trade), 70% confidence threshold. Good risk-adjusted returns without excessive exposure."
              />
              <OptionCard
                selected={risk === "aggressive"}
                onClick={() => setRisk("aggressive")}
                title="Aggressive"
                description="Larger positions (up to 20% per trade), 60% confidence threshold. Higher potential returns — and higher potential losses."
              />
            </div>
          </div>
        )}

        {/* Step 2 — Experience */}
        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              How experienced are you?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              Beginners start in a simplified view. You can switch anytime from the top bar.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={experience === "beginner"}
                onClick={() => setExp("beginner")}
                title="Beginner"
                description="I'm new to trading or just getting started. Show me the essentials: buy/sell/hold, a plain-English explanation, and how much to invest."
              />
              <OptionCard
                selected={experience === "intermediate"}
                onClick={() => setExp("intermediate")}
                title="Intermediate"
                description="I understand basic indicators (RSI, MACD) and have made trades before. I want to see signals with context."
              />
              <OptionCard
                selected={experience === "advanced"}
                onClick={() => setExp("advanced")}
                title="Advanced"
                description="I'm comfortable with quant concepts, Kelly criterion, regime detection, and walk-forward backtesting."
              />
            </div>
          </div>
        )}

        {/* Step 3 — Goal */}
        {step === 3 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              What&apos;s your primary goal?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              This shapes which signal horizons and metrics are emphasised.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={goal === "income"}
                onClick={() => setGoal("income")}
                title="Income"
                description="I want to generate regular returns from short-term trades. Day trades and swing trades are my focus."
              />
              <OptionCard
                selected={goal === "growth"}
                onClick={() => setGoal("growth")}
                title="Growth"
                badge="Most common"
                description="I want to grow my portfolio over months. Swing and monthly signals with strong momentum are what I need."
              />
              <OptionCard
                selected={goal === "preservation"}
                onClick={() => setGoal("preservation")}
                title="Capital Preservation"
                description="Protecting what I have is the priority. I only trade high-conviction setups and size positions very conservatively."
              />
            </div>
          </div>
        )}

        {/* Step 4 — Broker connection */}
        {step === 4 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              Do you want to connect a broker?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              A broker lets the agent place trades automatically. We use Alpaca — it&apos;s free and offers paper trading (fake money) so you can test risk-free.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={() => setBroker(true)}
                style={{
                  width: "100%", textAlign: "left", padding: "20px 18px",
                  background: brokerConnected ? "rgba(26,107,74,0.08)" : "var(--bg-raised)",
                  border: `2px solid ${brokerConnected ? "#1A6B4A" : "var(--border)"}`,
                  cursor: "pointer", transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: "14px",
                }}
              >
                <Link2 size={22} style={{ color: brokerConnected ? "#1A6B4A" : "var(--text-muted)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                    Yes — I have (or will set up) Alpaca
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    Enter your Alpaca API keys in the Trade tab after setup. Paper trading uses fake money — your real money is always safe.
                  </div>
                </div>
              </button>
              <button
                onClick={() => setBroker(false)}
                style={{
                  width: "100%", textAlign: "left", padding: "20px 18px",
                  background: !brokerConnected ? "rgba(11,31,58,0.06)" : "var(--bg-raised)",
                  border: `2px solid ${!brokerConnected ? "var(--blue)" : "var(--border)"}`,
                  cursor: "pointer", transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: "14px",
                }}
              >
                <Link2Off size={22} style={{ color: !brokerConnected ? "var(--blue)" : "var(--text-muted)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                    Not yet — just show me signals
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    You&apos;ll see buy/sell/hold signals and position sizes. The agent will tell you what it would do without placing any real orders.
                  </div>
                </div>
              </button>
            </div>
            {brokerConnected && (
              <div style={{
                marginTop: "16px", padding: "14px 16px",
                background: "rgba(26,107,74,0.06)", border: "1px solid rgba(26,107,74,0.3)",
                fontFamily: SERIF, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6,
              }}>
                <strong>Setting up Alpaca (2 minutes):</strong><br />
                1. Go to <span style={{ fontFamily: MONO, color: "var(--blue)" }}>alpaca.markets</span> and create a free account<br />
                2. Navigate to Paper Trading → API Keys → Generate Key<br />
                3. Paste your key &amp; secret into the Trade tab once you&apos;re in the app
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Email for alerts */}
        {step === 5 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              Where should we send trade alerts?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              Optional but strongly recommended. You&apos;ll get an email every time the agent places a trade and a morning brief each day. We never share your email.
            </p>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Mail size={16} style={{
                position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: "100%", padding: "14px 14px 14px 40px",
                  fontFamily: SERIF, fontSize: "15px",
                  color: "var(--text-primary)", background: "var(--bg-raised)",
                  border: "2px solid var(--border)", outline: "none",
                }}
                onFocus={e => (e.target.style.borderColor = "var(--blue)")}
                onBlur={e => (e.target.style.borderColor = "var(--border)")}
              />
            </div>
            <div style={{
              padding: "12px 16px",
              background: "rgba(155,146,128,0.06)", border: "1px solid rgba(155,146,128,0.2)",
              fontFamily: SERIF, fontSize: "11px", color: "var(--text-disabled)", lineHeight: 1.6,
            }}>
              You&apos;ll receive: trade confirmations, daily P&amp;L alerts, morning signal brief (8:30 AM ET), and weekly summary. Leave blank to skip.
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "32px" }}>
          {step > 0 ? (
            <button onClick={() => setStep(s => s - 1)}
              style={{
                fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)",
                background: "none", border: "none", cursor: "pointer", padding: "8px 0",
              }}>
              ← Back
            </button>
          ) : (
            <button onClick={() => router.push("/")}
              style={{
                fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)",
                background: "none", border: "none", cursor: "pointer", padding: "8px 0",
              }}>
              Skip for now
            </button>
          )}

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                fontFamily: SERIF, fontSize: "13px", fontWeight: 600,
                padding: "10px 24px",
                background: canAdvance ? "var(--blue)" : "var(--bg-active)",
                color: canAdvance ? "#fff" : "var(--text-disabled)",
                border: "none", cursor: canAdvance ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={saving || !canAdvance}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                fontFamily: SERIF, fontSize: "13px", fontWeight: 700,
                padding: "10px 28px",
                background: "#1A6B4A",
                color: "#fff",
                border: "none", cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.7 : 1,
                transition: "all 0.15s",
              }}
            >
              {saving ? "Saving…" : <><CheckCircle size={14} /> Set Up My Account</>}
            </button>
          )}
        </div>

        {/* Re-do link */}
        {onboarding.completed && step === 0 && (
          <p style={{ fontFamily: SERIF, fontSize: "11px", color: "var(--text-disabled)", textAlign: "center", marginTop: "16px" }}>
            You&apos;re updating your existing profile.{" "}
            <button onClick={() => router.push("/")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", textDecoration: "underline", fontSize: "11px", fontFamily: SERIF }}>
              Go back to the app
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}
