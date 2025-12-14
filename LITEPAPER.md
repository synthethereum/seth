# Synth sETH — Prediction Markets Litepaper

**Version:** v0.1  
**Status:** Pre-deployment  
**Network:** Ethereum  
**Token Standard:** ERC-20  

---

## 1. Abstract

**Synth sETH** is a decentralized prediction-market protocol and a fixed-supply ERC-20 utility token built on Ethereum.

The protocol enables users to stake Synth sETH into **binary YES / NO markets** covering real-world, on-chain, and crypto-native events. Market probabilities emerge directly from on-chain liquidity, while outcomes are settled transparently after verification.

Rather than relying on order books or centralized market makers, Synth sETH implements a **liquidity-based outcome model**, where belief-weighted capital determines odds and payouts.

---

## 2. Narrative & Vision

Under the principle **“On-chain outcomes, real stakes.”**, Synth sETH reframes the idea of synthetics away from price-mirroring assets toward **outcome-driven markets** — markets where beliefs themselves become tradable positions.

The long-term vision is to establish Synth sETH as a **neutral settlement asset** for decentralized prediction markets, fully composable with DeFi primitives, analytics tools, and future governance systems.

---

## 3. Core Design Principles

Synth sETH is built around a minimal and transparent architecture:

- **Binary markets:** every event resolves as YES or NO  
- **Liquidity-defined odds:** probabilities are derived directly from opposing-side liquidity  
- **Fully on-chain state:** all stakes, payouts and outcomes are transparent and verifiable  
- **Single settlement asset:** all positions and rewards use Synth sETH  

This design avoids order books, centralized matching engines, and discretionary pricing logic at the core protocol layer.

---

## 4. Token Specification

| Parameter | Value |
|---------|------|
| Name | Synth sETH |
| Standard | ERC-20 |
| Network | Ethereum Mainnet |
| Decimals | 18 |
| Total Supply | **40,000,000 (fixed)** |
| Minting | None after deployment |
| Transfer Logic | No taxes, no rebasing, no restrictions |

The token contract is designed to be **clean, minimal, and immutable**.

---

## 5. Token Utility

Synth sETH is the native utility asset of the prediction protocol:

- **Market participation:** users stake Synth sETH into YES / NO liquidity pools  
- **Settlement currency:** all winning payouts are distributed in Synth sETH  
- **Fee accounting:** protocol fees are denominated and collected in Synth sETH  
- **Governance alignment:** participation in protocol parameter discussions and future governance processes  

Synth sETH does not represent equity, ownership, or claims on any entity.

---

## 6. Tokenomics & Distribution

The total fixed supply of **40,000,000 Synth sETH** is allocated as follows:

- **20,000,000 sETH (50%) — Permanent Lock**  
  Intended to be locked indefinitely to reinforce supply immutability and remove emission risk.

- **15,000,000 sETH (37.5%) — Community Incentives**  
  Distributed gradually to early users, market participants and ecosystem contributors.

- **5,000,000 sETH (12.5%) — Ecosystem & Operations**  
  Liquidity seeding, infrastructure, audits, oracle costs and long-term protocol development.

**Circulating supply** is defined as total supply minus permanently locked supply.

---

## 7. Market Mechanics

Each prediction market consists of two liquidity pools:

- **YES Pool**  
- **NO Pool**

Odds are derived from liquidity imbalance:
```
Odds(YES) = NO Pool / (YES Pool + NO Pool)
Odds(NO) = YES Pool / (YES Pool + NO Pool)
```

As liquidity shifts toward one outcome, opposing odds become more attractive, creating a continuous and self-balancing pricing mechanism without order books.

---

## 8. Settlement & Oracles

Settlement is intentionally staged to balance speed and trust minimization:

- **Phase 1 (MVP):** admin-driven settlement using verifiable public and archivable data sources  
- **Phase 2 (Beta):** multi-signer settlement with transparent dispute windows and community oversight  
- **Phase 3 (Full Protocol):** integration with decentralized oracle frameworks and on-chain dispute resolution mechanisms  

The long-term objective is to minimize reliance on any single entity.

---

## 9. Roadmap (High-Level)

### Phase 1 — MVP
- Launch of Synth sETH token (fixed supply, clean ERC-20)
- Core YES / NO market contracts
- Wallet integration and basic web UI
- Curated initial markets
- Early user tracking for community incentives

### Phase 2 — Public Beta
- User-generated markets with permissioned templates
- Reputation and leaderboard systems
- Fee-sharing and incentive programs
- Progressive rollout of community airdrops

### Phase 3 — Oracle + Full Protocol
- Decentralized oracle integration
- On-chain dispute mechanisms
- Liquidity incentives and advanced market types
- Cross-chain and L2 deployments
- Governance-driven protocol evolution

---

## 10. Risks & Disclaimer

Prediction markets involve financial risk, regulatory uncertainty and potential oracle failures.

Synth sETH does not represent equity, debt or claims on any entity and does not guarantee returns. This document is provided for informational purposes only and does not constitute financial, legal or tax advice.

Participants are responsible for conducting their own due diligence and complying with applicable laws in their jurisdiction.

---

