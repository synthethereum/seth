# Security Policy

## Overview

Synth sETH is an independent, open-source prediction-market protocol built on Ethereum.  
This document outlines the security model, token design principles, and responsible disclosure guidelines for the Synth sETH ecosystem.

The primary goal of this policy is to provide transparency around the token’s architecture and clarify common automated security checks performed by third-party tools.

---

## Token Security Design

The Synth sETH token is implemented as a standard ERC-20 contract with a fixed total supply.

### Core Properties

- **Fixed Supply:** 40,000,000 Synth sETH
- **Minting:** No mint functions after deployment
- **Burning:** No mandatory or privileged burn mechanisms
- **Rebasing:** None
- **Transfer Taxes / Fees:** None
- **Blacklist / Whitelist:** None
- **Pause / Freeze:** None
- **Proxy / Upgradeability:** None
- **Owner-Controlled Transfers:** None

The token follows clean ERC-20 semantics and does not introduce custom transfer logic that could restrict selling, transferring, or approving tokens.

Once deployed, the token contract is immutable.

---

## Honeypot & Transfer Safety Statement

Synth sETH does **not** restrict token transfers in any direction.

Specifically:
- Tokens can be freely bought and sold on decentralized exchanges
- There are no conditions under which transfers are blocked
- No addresses can be frozen or blacklisted
- No balances can be modified by an owner or administrator

Synth sETH is **not a honeypot**.

Any warnings or flags raised by automated scanners (such as TokenSniffer, Honeypot.is, GoPlus, or similar tools) may be caused by:
- Early-stage deployment
- Low initial liquidity
- Recently verified contracts
- Heuristic-based false positives

These flags are not indicative of malicious behavior.

---

## Ownership & Privileged Roles

The Synth sETH token contract does not grant special privileges that can affect user balances or transfers.

If ownership is present, it is limited to non-economic administrative actions (e.g., metadata references) and does not allow:
- Minting
- Confiscation
- Forced transfers
- Trading restrictions

The protocol logic governing prediction markets is developed separately from the token contract and does not modify ERC-20 behavior.

---

## Audits & Verification

- The token contract is fully verified on-chain.
- Source code is publicly available in this repository.
- No obfuscated logic or hidden functionality is present.

Formal third-party audits may be conducted in later stages as the protocol evolves.

---

## Responsible Disclosure

We welcome responsible disclosure of potential security issues.

If you discover a vulnerability or unexpected behavior, please report it privately to:

**Email:** team@syntheth.com

Please include:
- A detailed description of the issue
- Steps to reproduce (if applicable)
- Potential impact assessment

Do **not** publicly disclose vulnerabilities before allowing reasonable time for review and mitigation.

---

## Disclaimer

Synth sETH is an experimental decentralized protocol.  
While care has been taken to minimize risk and attack surface, smart contracts inherently carry risk.

This repository and its contents are provided “as is”, without warranties of any kind.

Users and integrators are encouraged to perform their own due diligence before interacting with the protocol.

---

© 2025 Synth sETH  
On-chain outcomes, real stakes.
