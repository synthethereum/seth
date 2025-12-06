// BASE URL твоего backend
const API_BASE = "http://localhost:4000";

export async function getPolymarketQuestion() {
  try {
    const r = await fetch(`${API_BASE}/api/polymarket-question`);
    if (!r.ok) throw new Error("Bad backend response");
    return await r.json();
  } catch (e) {
    console.error("API error:", e);
    return null;
  }
}

export async function saveAnswer(wallet, correct) {
  try {
    const r = await fetch(`${API_BASE}/api/save-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, correct })
    });
    return await r.json();
  } catch (e) {
    console.error("Save error:", e);
    return null;
  }
}
