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
  private static readonly MODEL_NAME = "models/gemini-3.6-flash";
  private static readonly TIMEOUT_MS = 4500;

  /**
   * Evaluates a candidate option buying signal through Gemini AI.
   * Acts as a strict institutional risk manager to veto false breakout traps.
   */
  public static async validateTradeSetup(input: AIAuditInput): Promise<AIAuditResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[GeminiRiskOfficer] GEMINI_API_KEY missing. Bypassing AI gate.");
      return {
        approved: true,
        aiConfidence: 50,
        verdict: "APPROVED",
        trapDetected: false,
        reasoning: "AI API Key missing, passed on mathematical quantitative score."
      };
    }

    const prompt = `
You are an ultra-strict Institutional Head of Risk for an Intraday Nifty 50 Options Trading Desk.
Your sole job is to PROTECT TRADING CAPITAL from false breakouts, theta decay, and bull/bear traps.

Evaluate this candidate option buying trade:
- Action: ${input.candidateType} (Setup: ${input.setupType})
- Strike: ${input.strike}
- Nifty Spot: ${input.spot.toFixed(2)} | Session VWAP: ${input.vwap.toFixed(2)}
- Market Regime: ${input.regime} | Trend Strength ADX: ${input.adx.toFixed(1)}
- India VIX: ${input.vix.toFixed(2)}% | CPR Width: ${input.cprWidthPercent ? input.cprWidthPercent.toFixed(3) + "%" : "Normal"}
- Heavyweights: ${JSON.stringify(input.heavyweights)}
- Time (IST): ${input.timeIST}
- Quantitative Confluence Score: ${input.confluenceScore}/100

STRICT VETO RULES:
1. If ADX < 18 or Regime is RANGE/CONSOLIDATION without clear momentum, VETO (reason: Theta decay in sideways chop).
2. If CALL_BUY and Bank Nifty or ICICI Bank is Red/diverging negatively, VETO (reason: Index divergence bull trap).
3. If PUT_BUY and Bank Nifty or Reliance is Green/rallying, VETO (reason: Heavyweight divergence bear trap).
4. If between 11:00 AM - 1:15 PM IST, VETO (reason: Midday volume drop & theta decay).

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
      const url = `https://generativelanguage.googleapis.com/v1beta/${this.MODEL_NAME}:generateContent?key=${apiKey}`;
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
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[GeminiRiskOfficer] API returned ${res.status}: ${errText}. Bypassing AI.`);
        return {
          approved: true,
          aiConfidence: 50,
          verdict: "APPROVED",
          trapDetected: false,
          reasoning: "AI validation timed out or unavailable, passed on quantitative score."
        };
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
      console.warn(`[GeminiRiskOfficer] Validation request failed: ${e.message}. Bypassing AI.`);
      return {
        approved: true,
        aiConfidence: 50,
        verdict: "APPROVED",
        trapDetected: false,
        reasoning: "AI validation bypass: executed on quantitative formula score."
      };
    }
  }
}
