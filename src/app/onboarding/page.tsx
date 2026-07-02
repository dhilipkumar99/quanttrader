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
            Answer 6 quick questions so we can personalise your signals and position sizes.
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
              We use this to calculate exactly how many dollars to put into each trade. You can update it anytime.
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
              How comfortable are you with risk?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              This controls how much of your account we suggest putting into each trade.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={risk === "conservative"}
                onClick={() => setRisk("conservative")}
                title="Play It Safe"
                description="Small positions — up to 5% per trade. We only suggest trades when the AI is very confident (80%+). Capital protection is the priority."
              />
              <OptionCard
                selected={risk === "moderate"}
                onClick={() => setRisk("moderate")}
                title="Balanced"
                badge="Most popular"
                description="Medium positions — up to 12% per trade. A healthy balance between growing your money and protecting it."
              />
              <OptionCard
                selected={risk === "aggressive"}
                onClick={() => setRisk("aggressive")}
                title="Go for Growth"
                description="Larger positions — up to 20% per trade. More upside potential, but also more downside. Only suitable if you're comfortable with larger swings."
              />
            </div>
          </div>
        )}

        {/* Step 2 — Experience */}
        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              How much trading experience do you have?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              New traders start in Simple View — just the signal and what to do. You can switch anytime.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={experience === "beginner"}
                onClick={() => setExp("beginner")}
                title="Just Getting Started"
                description="I'm new to trading or just learning. Show me the bottom line: should I buy, sell, or hold — and how much to invest."
              />
              <OptionCard
                selected={experience === "intermediate"}
                onClick={() => setExp("intermediate")}
                title="Some Experience"
                description="I've made trades before and know the basics (buy low, sell high, stop-losses). I want to see the signal plus a bit more context."
              />
              <OptionCard
                selected={experience === "advanced"}
                onClick={() => setExp("advanced")}
                title="Experienced Trader"
                description="I know technical analysis and want to see all the data — indicators, risk metrics, probability scores, the works."
              />
            </div>
          </div>
        )}

        {/* Step 3 — Goal */}
        {step === 3 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              What are you trying to do with this account?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              This tells us which types of trades to prioritise for you.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <OptionCard
                selected={goal === "income"}
                onClick={() => setGoal("income")}
                title="Make money regularly"
                description="I want to take advantage of short-term price moves and generate returns week by week through day trades and swing trades."
              />
              <OptionCard
                selected={goal === "growth"}
                onClick={() => setGoal("growth")}
                title="Grow my account over time"
                badge="Most common"
                description="I want my money to grow steadily over months. Fewer trades, but higher quality setups with stronger conviction."
              />
              <OptionCard
                selected={goal === "preservation"}
                onClick={() => setGoal("preservation")}
                title="Protect what I have"
                description="Keeping my capital safe is the main goal. I only want to trade when the AI is very confident, and I want to risk as little as possible per trade."
              />
            </div>
          </div>
        )}

        {/* Step 4 — Broker connection */}
        {step === 4 && (
          <div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              Do you want to place trades automatically?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              Connect Alpaca (free) to let the AI place trades for you. You can start with paper trading — fake money — so there&apos;s zero risk while you learn how it works.
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
                    Yes — connect Alpaca and let the AI trade for me
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    Start with paper trading (fake money) to see how it performs risk-free. Connect your Alpaca API keys in the Trade tab after setup.
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
                    Not yet — just show me the signals
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    You&apos;ll see buy/sell/hold signals, position sizes, and trade plans — but the AI won&apos;t place any real orders. You stay in control.
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
              Want trade alerts sent to your inbox?
            </h2>
            <p style={{ fontFamily: SERIF, fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              Optional but highly recommended. Get notified the moment the AI spots a trade opportunity — even when you&apos;re away from the screen. We never share or sell your email.
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
