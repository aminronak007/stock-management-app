export interface AIAuditInput {
  candidateType: "CALL_BUY" | "PUT_BUY";
  setupType: string;
  spot: number;
  vwap: number;
  vix: number;
  adx: number;
  regime: string;
  confluenceScore: number;
  strike: number | string;
  heavyweights: { [symbol: string]: { ltp: number; changePercent?: number } };
  giftNifty?: { ltp: number; delta: number; sentiment: string; premiumDiscount: number };
  cprWidthPercent?: number;
  timeIST: string;
}

export interface AIAuditResult {
  approved: boolean;
  aiConfidence: number;
  verdict: "APPROVED" | "BLOCKED";
  trapDetected: boolean;
  reasoning: string;
}

export class GeminiRiskOfficer {
  private static readonly PRIMARY_MODEL = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";
  private static readonly FALLBACK_MODEL = "models/gemini-1.5-flash";
  private static rateLimitCooldownUntil: number = 0;

  /**
   * Local Deterministic Risk Engine:
   * Mathematically audits candidate setup using exact institutional risk rules
   * when Gemini API is rate-limited, timed out, or offline.
   */
  public static evaluateLocalDeterministicRules(input: AIAuditInput, fallbackReason: string): AIAuditResult {
    // Rule 1: Minimum Institutional Confluence Score
    if (input.confluenceScore < 82) {
      return {
        approved: false,
        aiConfidence: 30,
        verdict: "BLOCKED",
        trapDetected: true,
        reasoning: `[Local Risk Engine] Confluence score (${input.confluenceScore}/100) is below high-conviction threshold (82). Blocked to protect capital.`
      };
    }

    // Rule 2: Severe Chop & ADX Gate
    if (input.adx > 0 && input.adx < 15 && input.regime === "RANGE") {
      return {
        approved: false,
        aiConfidence: 35,
        verdict: "BLOCKED",
        trapDetected: true,
        reasoning: `[Local Risk Engine] Low ADX (${input.adx.toFixed(1)}) in sideways consolidation. Blocked to prevent Theta decay.`
      };
    }

    // Rule 3: Global Macro Divergence
    if (input.giftNifty) {
      if (input.candidateType === "CALL_BUY" && input.giftNifty.delta < -40) {
        return {
          approved: false,
          aiConfidence: 40,
          verdict: "BLOCKED",
          trapDetected: true,
          reasoning: `[Local Risk Engine] GIFT Nifty heavily dumping (${input.giftNifty.delta.toFixed(1)} pts). CALL buying blocked on global macro divergence.`
        };
      }
      if (input.candidateType === "PUT_BUY" && input.giftNifty.delta > 40) {
        return {
          approved: false,
          aiConfidence: 40,
          verdict: "BLOCKED",
          trapDetected: true,
          reasoning: `[Local Risk Engine] GIFT Nifty heavily surging (+${input.giftNifty.delta.toFixed(1)} pts). PUT buying blocked on global macro divergence.`
        };
      }
    }

    // If passed all institutional mathematical filters:
    return {
      approved: true,
      aiConfidence: 85,
      verdict: "APPROVED",
      trapDetected: false,
      reasoning: `[Local Risk Engine] Verified high-conviction setup (Score: ${input.confluenceScore}/100, ADX: ${input.adx.toFixed(1)}). (${fallbackReason})`
    };
  }

  /**
   * Evaluates a candidate option buying signal through Gemini AI.
   * Acts as a strict institutional risk manager to veto false breakout traps.
   */
  public static async validateTradeSetup(input: AIAuditInput): Promise<AIAuditResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    const now = Date.now();

    // If currently in rate-limit cooldown, seamlessly use Local Deterministic Risk Engine
    if (now < this.rateLimitCooldownUntil) {
      const remainingSecs = Math.round((this.rateLimitCooldownUntil - now) / 1000);
      return this.evaluateLocalDeterministicRules(input, `Gemini API rate-limit cooldown active for ${remainingSecs}s`);
    }

    if (!apiKey) {
      return this.evaluateLocalDeterministicRules(input, "GEMINI_API_KEY missing");
    }

    const giftNiftyText = input.giftNifty
      ? `LTP: ${input.giftNifty.ltp.toFixed(2)}, Delta: ${input.giftNifty.delta > 0 ? "+" : ""}${input.giftNifty.delta.toFixed(1)} pts (${input.giftNifty.sentiment}), Spread: +${input.giftNifty.premiumDiscount} pts`
      : "Aligned";

    const prompt = `
You are an ultra-strict Institutional Head of Risk for an Intraday Nifty 50 Options Trading Desk.
Your sole job is to PROTECT TRADING CAPITAL from false breakouts, theta decay, and bull/bear traps.

Evaluate this candidate option buying trade:
- Action: ${input.candidateType} (Setup: ${input.setupType})
- Strike: ${input.strike}
- Nifty Spot: ${input.spot.toFixed(2)} | Session VWAP: ${input.vwap.toFixed(2)}
- Market Regime: ${input.regime} | Trend Strength ADX: ${input.adx.toFixed(1)}
- India VIX: ${input.vix.toFixed(2)}% | CPR Width: ${input.cprWidthPercent ? input.cprWidthPercent.toFixed(3) + "%" : "Normal"}
- GIFT Nifty (Global Macro): ${giftNiftyText}
- Heavyweights: ${JSON.stringify(input.heavyweights)}
- Time (IST): ${input.timeIST}
- Quantitative Confluence Score: ${input.confluenceScore}/100

STRICT VETO RULES:
1. If ADX < 18 or Regime is RANGE/CONSOLIDATION without clear momentum, VETO (reason: Theta decay in sideways chop).
2. If CALL_BUY and Bank Nifty or ICICI Bank is Red/diverging negatively, VETO (reason: Index divergence bull trap).
3. If PUT_BUY and Bank Nifty or Reliance is Green/rallying, VETO (reason: Heavyweight divergence bear trap).
4. If CALL_BUY and GIFT Nifty is heavily dumping (Delta < -40 pts), or PUT_BUY and GIFT Nifty is strongly surging (Delta > +40 pts), VETO (reason: Global macro divergence).
5. If between 11:45 AM - 1:15 PM IST, VETO (reason: Midday volume drop & theta decay).

Respond ONLY with a valid JSON object matching this exact schema (no markdown, no backticks):
{
  "approved": boolean,
  "aiConfidence": number,
  "verdict": "APPROVED" or "BLOCKED",
  "trapDetected": boolean,
  "reasoning": "Concise 1-sentence risk explanation"
}
`.trim();

    try {
      const model = this.PRIMARY_MODEL;
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.8
          }
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Set 60-second cooldown so we don't spam the API
          this.rateLimitCooldownUntil = Date.now() + 60 * 1000;
          console.warn("[GeminiRiskOfficer] Gemini 429 Quota reached. Activating 60s cooldown and engaging Local Deterministic Risk Engine.");
        } else {
          console.warn(`[GeminiRiskOfficer] API returned ${res.status}. Falling back to Local Deterministic Risk Engine.`);
        }
        return this.evaluateLocalDeterministicRules(input, `Gemini API returned ${res.status}`);
      }

      const data = await res.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      // Strip any markdown fences if present
      text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(text);
      return {
        approved: parsed.approved === true,
        aiConfidence: Number(parsed.aiConfidence) || 75,
        verdict: parsed.approved === true ? "APPROVED" : "BLOCKED",
        trapDetected: parsed.trapDetected === true,
        reasoning: parsed.reasoning || (parsed.approved ? "AI verified institutional momentum." : "AI detected high risk of chop/fakeout.")
      };
    } catch (e: any) {
      console.warn(`[GeminiRiskOfficer] Validation request failed: ${e.message}. Engaging Local Deterministic Risk Engine.`);
      return this.evaluateLocalDeterministicRules(input, `AI network timeout: ${e.message}`);
    }
  }
}
