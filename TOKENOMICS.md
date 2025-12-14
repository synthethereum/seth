# Synth sETH — Tokenomics

**Token Name:** Synth sETH  
**Standard:** ERC-20  
**Network:** Ethereum  
**Decimals:** 18  
**Status:** Pre-deployment  

---

## 1. Overview

Synth sETH is a fixed-supply ERC-20 utility token designed to power a decentralized
prediction-market protocol on Ethereum.

The token is used exclusively as the **staking, settlement, and accounting unit**
across binary YES / NO markets. There is no inflation, rebasing, or algorithmic
supply adjustment. All economic activity is driven by market participation and
liquidity dynamics.

---

## 2. Total Supply

**Total Supply:** **40,000,000 Synth sETH**

The total supply is **fixed at deployment** and cannot be increased.

- No minting after deployment  
- No rebasing  
- No burn mechanisms at the token-contract level  
- No proxy or upgradeability  

The token contract is intended to be immutable and minimal.

---

## 3. Supply Allocation

The total supply is allocated as follows:

### 3.1 2 Months lock — 20,000,000 sETH (50%)

- Intended to be locked indefinitely
- Removes emission and dilution risk
- Reinforces long-term supply immutability
- Provides structural credibility for the ecosystem

This allocation is excluded from circulating supply calculations.

---

### 3.2 Community Incentives & Airdrops — 15,000,000 sETH (37.5%)

Reserved for distribution to early participants and ecosystem contributors, including:

- Prediction-market users
- Liquidity providers
- Market creators
- Early testers and contributors
- Community growth campaigns

Distribution is designed to be **gradual and programmatic**, aligned with platform
usage and engagement rather than speculative incentives.

---

### 3.3 Ecosystem & Operations — 5,000,000 sETH (12.5%)

Allocated for long-term sustainability of the protocol, including:

- Initial liquidity provisioning
- Infrastructure and hosting costs
- Smart contract audits
- Oracle and data costs
- Protocol development and integrations

This allocation does not confer ownership, equity, or control rights.

---

## 4. Circulating Supply Definition

**Circulating supply** is defined as:
```
Circulating Supply = Total Supply − Permanently Locked Supply
```


At genesis, circulating supply is expected to be:

**20,000,000 Synth sETH**

Community incentive allocations enter circulation progressively as distributed.

---

## 5. Token Utility Flywheel

Synth sETH utility is directly tied to protocol activity:

1. Users acquire Synth sETH  
2. Synth sETH is staked into YES / NO markets  
3. Liquidity imbalance generates probabilities  
4. Markets resolve using verifiable data  
5. Winning participants receive Synth sETH payouts  
6. Fees and incentives recycle Synth sETH back into the ecosystem  

This creates a **closed economic loop** where token demand is driven by
participation rather than inflation.

---

## 6. Fees & Value Flow

Protocol fees, if enabled, are:

- Denominated in Synth sETH
- Collected at the market level
- Directed toward ecosystem incentives, development, or governance-defined sinks

No automatic burns or redistributions are embedded in the token contract itself.
All economic policies are handled at the protocol layer.

---

## 7. Governance Alignment

Synth sETH is designed to align incentives across:

- Traders
- Liquidity providers
- Market creators
- Protocol maintainers

Governance processes may influence:
- Market parameters
- Fee structures
- Incentive allocation
- Oracle frameworks

The core ERC-20 token contract remains unchanged regardless of governance outcomes.

---

## 8. Design Constraints

The following constraints are intentional and permanent:

- No privileged transfer controls
- No blacklist or pause functionality
- No admin minting rights
- No hidden balance manipulation

These constraints are designed to reduce trust assumptions and improve
compatibility with DeFi infrastructure, analytics platforms, and explorers.

---

## 9. Disclaimer

Synth sETH is a utility token intended for use within a prediction-market protocol.
It does not represent equity, ownership, debt, or claims on any entity and does not
guarantee any form of return.

Token value is determined solely by market dynamics and user participation.

This document is provided for informational purposes only and does not constitute
financial, legal, or investment advice.

