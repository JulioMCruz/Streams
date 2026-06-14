# 00 · Ledger — EIP-7702 device-signed atomic setup + Clear Signing

Proposal and work plan for the **AI Agents x Ledger ($10,000)** bounty. Core
idea: use **Ledger as the trust layer of the autonomous agent** — the hardware
device authorizes, in an **atomic and clear-signed** way, exactly the
permissions the bot/CRE needs, via **EIP-7702** (signed on the device with the
DMK) + **Clear Signing (ERC-7730)**.

> Project context: the autonomous agent (Node bot / CRE workflow) executes DCA
> on what has already streamed in and **never holds the user's key**; the user
> retains control via their setup signature plus kill switches (close the stream,
> revoke permissions, downgrade, withdraw).

---

## 1 · Why it fits (the thesis)

Ledger asks for: *"make autonomous behavior safer instead of bypassing user intent"*,
*"clear boundaries between autonomous behavior and explicit approval"*, *"Ledger
as the explicit control layer"*, *"concrete use of Ledger primitives, not just
wallet branding"*.

StreamVaults already separates the two planes architecturally:

| Plane | Who | Actions |
|---|---|---|
| **Autonomous** | Node bot / CRE workflow | `executeSwap`, `closeStreamIfLow` — scoped to what has streamed in, settles to the user, no user key |
| **Explicit approval (human)** | the user's EOA | open stream (`grantPermissions` + `startStreamBot`), kill switches (`setStream(…,0)`, `revokePermissions`, `downgrade`, `withdraw`) |

→ If the user's EOA is a **Ledger**, every boundary action is **device-backed
and clear-signed**, while the agent only operates inside those limits. **Ledger
is the agent's trust boundary.** That is, literally, what the bounty rewards.

---

## 2 · The technical proposal

Two concrete Ledger primitives, not "branding":

### 2.1 · EIP-7702 → atomic setup signed in hardware (the heart)

**Current problem:** the setup needs 2 calls —
`CFAv1Forwarder.grantPermissions(USDCx, StreamVaults)` (Superfluid requires
`msg.sender == flowSender`, i.e. the user) and `StreamVaults.startStreamBot(...)`.
Today this is done with **EIP-5792** (`wallet_sendCalls`), which is *best-effort
atomic* and **degrades to 2 confirmations**. 7702 was initially avoided because it
*"requires the wallet to expose `eth_signAuthorization`, still not universal."*

**The insight:** **Ledger DMK exposes exactly that** →
`@ledgerhq/device-signer-kit-ethereum`:
`signerEth.signDelegationAuthorization(derivationPath, chainId, contractAddress, nonce)` → `{ r, s, v }`.
And **Base (OP Stack) supports EIP-7702** (type-4 txs, post-Pectra). In other
words: for Ledger users the sole reason 7702 was avoided goes away.

**Atomic flow with 7702 + Ledger:**

1. The user signs on the **Ledger** an EIP-7702 authorization that delegates
   their EOA to a **batch-executor** (`signDelegationAuthorization`).
2. A single **type-4** tx carries that authorization and calls the EOA itself:
   `execute([grantPermissions, startStreamBot])`.
3. Since the EOA "has code", **both internal calls run with
   `msg.sender == user's EOA`** → `grantPermissions` passes Superfluid's check
   **and** `startStreamBot` runs. **Atomic, one signature, in hardware.**

From `best-effort (2 confirmations)` → `guaranteed atomic (1 device-backed signature)`.

### 2.2 · Clear Signing (ERC-7730)

JSON descriptors that make the Ledger display **readable text** instead of
calldata. Combined with 7702, the device shows:
- *"Delegate your account to the StreamVaults batch-executor"* (the 7702 authorization)
- *"Authorize the protocol to open a stream of X USDC/day to your bot"* (`startStreamBot`)
- *"Revoke all protocol access to your streams"* (`revokePermissions`, kill switch)

### 2.3 · Progressive enhancement

The Ledger path (atomic 7702 + clear signing) is added **alongside** the current
Reown/EIP-5792 flow, which stays as the **fallback** for other wallets. We detect
Ledger → offer the superior path; otherwise, 5792.

---

## 3 · Architecture / pieces

| Piece | Detail | Where |
|---|---|---|
| **Batch-executor (7702 delegate)** | Minimal `execute((address to, uint256 value, bytes data)[])`. It becomes the EOA's "code" during setup → reuse a known/audited one (Safe/OZ have 7702 modules) instead of writing one from scratch. | `contracts` |
| **DMK / WebHID signer** | `@ledgerhq/device-signer-kit-ethereum` for `signDelegationAuthorization` + assembling the type-4 tx (viem supports `authorizationList`). | `web` |
| **ERC-7730 descriptors** | `calldata` for `grantPermissions`, `startStreamBot`, `setStream`, `revokePermissions`, `withdraw/withdrawAll`, `redeploySmartAccount`; `eip712` for the USDC permit. Pointing at the real addresses on Base (`StreamVaults 0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC`). | `erc7730/` (new) + PR to the registry |
| **"Connect Ledger" UX** | new path in the modal next to Reown; detection + progressive enhancement. | `web` |

**ERC-7730 tooling (confirmed):** `pip install erc7730` (Python ≥3.12, validates/
generates), the visual **JSON Builder** with on-device preview, `LedgerHQ/erc-7730-workshop`,
and a PR to `ethereum/clear-signing-erc7730-registry` (or the **manual/embedded
in the dApp** path for the demo, without waiting for the merge).

---

## 4 · Caveats / risks to de-risk

| # | Risk | Mitigation |
|---|---|---|
| L-01 | **Authorization nonce vs tx nonce.** If the same EOA signs the auth AND sends the tx (self-sponsor), there's the known off-by-one (auth nonce = tx nonce + 1). | Handle it explicitly, or use a **sponsor/relayer** that sends the tx (clean auth nonce). |
| L-02 | **Delegation persistence.** A 7702 leaves the EOA delegated until it's changed. | For a one-shot setup: **delegate → execute → clear (delegate to `0x0`)** in the same tx. *It's also a good security point for the pitch:* the agent is only enabled during setup. |
| L-03 | **Ledger firmware** must support 7702 (recent version). | Updated device, or **Speculos** (emulator) for the demo. |
| L-04 | **WebHID** in Next.js (Chromium only). | Document the supported browser; fallback to 5792. |
| L-05 | **Type-4 tx gas.** | User self-send (simple) or relayer. |
| L-06 | **ERC-7730 registry maturity** (PR merge time). | **Embedded in the dApp** path for the demo + parallel PR. |
| L-07 | **Delegate security.** It becomes the EOA's code. | Reuse an audited delegate; post-setup clearing (L-02). |
| L-09 | **The delegate is NOT free — Ledger whitelists only one (Phase 2 finding).** The Ethereum app only recognizes **`Simple7702Account` from eth-infinitism @ `0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9`** (`chain_id=0` → all chains, incl. Base). The OZ ERC-7821 from Phase 1 **does not apply for the Ledger path.** → For Ledger, delegate to Simple7702Account, whose batch is **`executeBatch((address,uint256,bytes)[])`** (not ERC-7821's `execute(mode,data)`). It's deployed on Base; verify the address on-chain. |
| L-10 | **7702 is off by default in the app (Phase 2 finding).** The NVRAM field `eip7702_enable` starts as `false`; the device displays *"Enable smart account upgrade in the settings"* and refuses to sign until the user activates it. It's an explicit opt-in (human-in-the-loop, aligned with the bounty). In the emulated PoC we defaulted it to ON with a 1-line patch in `storage_init`; in prod it's a user toggle. |
| L-08 | **7702 breaks the EIP-2612 permit (Phase 1 finding).** Once the EOA has 7702 code, Circle's USDC (FiatTokenV2_2) verifies the permit via **ERC-1271** (`SignatureChecker`), not `ecrecover` — and a minimal ERC-7821 delegate doesn't implement `isValidSignature` → the permit inside `startStreamBot` fails (silenced by its try/catch). | **7702's batching makes the permit unnecessary:** batch a direct `USDC.approve(StreamVaults, amount)` before `startStreamBot` (all with `msg.sender == EOA`). Alternative: use a delegate that implements ERC-1271 (e.g. MetaMask DeleGator / OZ Account). *Good item for Ledger docs feedback.* |

---

## 5 · Work plan (by phases)

**Phase 0 — Research.** ✅ Done. Confirmed: Base supports 7702 (OP Stack
post-Pectra); Ledger DMK has `signDelegationAuthorization`; ERC-7730 tooling
mature. (See sources below.)

**Phase 1 — 7702 PoC WITHOUT Ledger (de-risks everything else). ✅ DONE.**
- Delegate: **OpenZeppelin `ERC7821`** (audited, already in `@openzeppelin/contracts`
  5.6.1) → `contracts/poc/Batch7702Delegate.sol` (empty wrapper, authorizer
  `caller == address(this)`). Zero new dependency.
- PoC: `contracts/poc-7702/run.mjs` (viem) against a **Base fork with anvil**
  (`--hardfork prague`). Deploys the delegate, signs the 7702 auth
  (`signAuthorization`, `executor: 'self'`) and sends **one type-4 tx** with
  `execute([grantPermissions, approve, startStreamBot])`.
- **Result:** `eip7702` tx `success` (~1.03M gas); `smartAccountOf(bob)` ≠ 0 and
  `getFlowrate(USDCx, bob, SA) == rate` → **the SmartAccount was deployed and the stream
  is alive in a single signature**, with `msg.sender == EOA` on every call.
- Run: `anvil --fork-url <base-rpc> --hardfork prague --port 8546` →
  `ANVIL_RPC=http://127.0.0.1:8546 node poc-7702/run.mjs`.
- **Ledger-aligned variant** (`poc-7702/run-simple7702.mjs`): same atomic setup
  but delegating to the **Simple7702Account** that Ledger whitelists (L-09), via its
  `executeBatch(Call[])`. **Does not deploy** — already on Base (`0x4Cd241…`, 3639
  bytes, verified on-chain). Passes identically (SA deployed + stream alive in 1 tx).
  This keeps Phase 1 ↔ Phase 2 consistent: the device signs the delegation to
  Simple7702Account and that same delegate runs the batch.

**Phase 2 — Ledger signer (DMK) against Speculos. ✅ DONE (emulated).**
- Bounty stack, emulated: `@ledgerhq/device-management-kit` +
  `@ledgerhq/device-signer-kit-ethereum` + the official transport
  `@ledgerhq/device-transport-kit-speculos`. Speculos running the Ethereum app
  **v1.23** (built from `ledger-app-ethereum` with `ledger-app-builder`, target flex).
- Script: `contracts/poc-7702-ledger/sign-with-ledger.mjs` (run with **`bun`**, not
  `node` — the DMK's ESM uses directory imports). Connects → `getAddress` →
  `signDelegationAuthorization(path, chainId=8453, delegate, nonce)`.
- **Result:** the device signed a valid 7702 authorization that **recovers the
  device EOA** ✅, and **clear-signed** it: *"Delegate to Simple7702Account ·
  Delegate on network Base · upgrade into smart contract account"*. It's the same
  authorization as Phase 1, now produced in hardware.
- Pending (web): "Connect Ledger" path with DMK/WebHID alongside Reown +
  also sign the type-4 tx (`signTransaction`) for the full UI flow.

**Phase 3 — Clear Signing (ERC-7730). ✅ DONE.**
- Descriptor: `contracts/erc7730/calldata-StreamVaults.json` (chainId 8453, addr
  `0xaC55…6fcC`). Clear-signing curated for the functions the user signs:
  `startStreamBot` → *"Start your StreamBot"* (Budget · Stream rate /sec · Min
  trade · Max slippage · Send swaps to · Tokens to buy; `permitSig` and `superToken`
  excluded) and `setStream` → *"Update or pause your stream"*; + intents for
  bot/guardian/admin, opaque `bytes` excluded, views discarded.
- Generated and validated with `erc7730` (pip): `generate` from the on-chain ABI →
  `lint` clean (respecting device limits: intent ≤30, label ≤20) →
  `calldata` compiles to the device's serialized descriptors ✅. See
  `contracts/erc7730/README.md`.
- Pending: embed in the dApp (manual path with `device-signer-kit`) for the demo
  + PR to `ethereum/clear-signing-erc7730-registry` under `registry/streamvaults/`.

**Phase 4 — Web integration (DMK/WebHID). ✅ Signature verified on real hardware.**
- `web/src/lib/ledger-7702.ts` — full browser flow, **isolated** (not
  imported by the production bundle): `connectLedger()` (WebHID via
  `webHidTransportFactory`) → `getAddress` → `signDelegationAuthorization` →
  builds the type-4 tx (`executeBatch([grant, approve, startStreamBot])` to
  Simple7702Account) → `signTransaction` → `sendRawTransaction`. Two on-device
  approvals (delegation + tx), both clear-signed (Phase 3).
- `web/src/lib/use-ledger-stream-bot.ts` — React hook (`connect`/`start`).
- **Verified:** `tsc --noEmit` 0 errors (on these files and on the WHOLE web → does
  not break the deployed app) + eslint clean. The DMK deps were added to
  `web` but **don't enter the bundle** until imported.
- **Live test page:** route `/ledger-test` (`app/ledger-test/page.tsx`) +
  `signDelegationDryRun()` — connects the Ledger and signs ONLY the delegation (no tx,
  no funds), verifying that the signature recovers the device's address. The DMK is
  dynamically imported on click → clean SSR/build (the route compiles 200).
- **✅ VERIFIED ON HARDWARE (Ledger Flex, 2026-05-28):** the dry-run passed on a
  physical Flex — device `0xAA1aEf44DDE610F433f271C6A8749139DD5162E1`, the 7702
  signature recovers that address, clear-signing "Delegate to Simple7702Account · Base"
  confirmed on screen. The WebHID → DMK → `signDelegationAuthorization` →
  clear-sign path is proven on real hardware, not just emulated.
- **✅ FULL FLOW VERIFIED ON HARDWARE (Flex, 2026-05-28):** the route
  `/ledger-test-full` (`startStreamBotWithLedger` against a local Base fork,
  `fund-fork.mjs` funded the Flex EOA) ran end-to-end — the Flex signed **the
  delegation AND the type-4 tx** (`signTransaction`), `executeBatch([grant, approve,
  startStreamBot])` landed: SmartAccount `0xE215979d…` deployed and stream alive
  (`flowrate == rate`). → **The Ethereum app 1.23 DOES sign a type-4 tx**, so
  NO sponsor is needed: the device signs everything. The two primitives + the full
  onboarding are proven on real hardware (not just emulated).
- **Pending (product items, not viability):** (a) wire the button into the
  real `app/page.tsx` (enhancement alongside Reown/5792) + addresses into
  `NEXT_PUBLIC_*`; (b) load the ERC-7730 descriptor onto the device (registry or via the
  signer's context-module) so the internal calls clear-sign rather than blind-sign;
  (c) go-live on mainnet with real funds (deliberate step, small amount).

**Phase 5 — Demo + bounty deliverables.**
- Video: *"I approve on my Ledger —atomic and clear-signed— opening a stream to
  an autonomous bot. The bot trades on its own, scoped, without my key. I
  review/kill from the Ledger."*
- **Ledger docs/SDK feedback** (qualification requirement): gaps, confusing
  flows, improvements with screenshots/PRs → document in `01_ledger_docs_feedback.md`.

---

## 5b · How to make clear-signing appear on the device

Common question: *does clear-signing appear on its own, or do you need to open a PR?* You
have to **deliver the ERC-7730 descriptor to the device**. Two paths (not mutually exclusive):

1. **PR to the registry (canonical, for ALL users).** Open a PR to
   [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry)
   with `registry/streamvaults/calldata-StreamVaults.json`. On merge, Ledger's
   metadata service serves it and **Ledger Wallet auto-fetches it** by (chainId,
   address) when the user signs — clear-signing for everyone, no code in the
   dApp. Requires review/merge (takes time) and the contract must be verified
   (ours is on Base). **This is "the PR".**

2. **Provided by the dApp (immediate, no PR — for the demo).** The DMK signer
   accepts a custom **ContextModule**. You build it with your own descriptor and pass it to
   the signer:
   ```ts
   import { ContextModuleBuilder } from '@ledgerhq/context-module'
   const contextModule = new ContextModuleBuilder({ originToken: 'streamvaults' })
     .addLoader(myErc7730Loader)            // serves calldata-StreamVaults.json
     // or .setMetadataServiceConfig({ url }) pointing at your own service
     .build()
   const signerEth = new SignerEthBuilder({ dmk, sessionId })
     .withContextModule(contextModule)      // ← injects the descriptor
     .build()
   ```
   ⚠️ **BUT (finding, L-11):** Ledger's calldata descriptors carry
   **`signatures` from Ledger's PKI** and the device **verifies them**. A descriptor
   served by a custom loader (which is what `erc7730 calldata` produces) **is not
   signed by Ledger** → **a PRODUCTION device will NOT clear-sign it** (falls back
   to blind-sign). This path only "sees" clear-signing on **Speculos** (dev-mode
   bypasses the PKI). For a real Ledger, the descriptor MUST come signed by
   Ledger → meaning, **via path 1 (registry PR)**. You cannot self-serve
   clear-signing to a production device.

> ⚠️ **Important nuance (seen in the Flex test):** the **7702 delegation**
> clear-signs on its own ("Delegate to Simple7702Account · Base") because that's
> **hardcoded in the Ethereum app** (its whitelist), NOT from an ERC-7730. The
> **calls to StreamVaults** (`startStreamBot`, etc.) do need the descriptor
> delivered by one of the two paths above. Also, in our flow the call to
> StreamVaults is **nested inside Simple7702Account's `executeBatch`**;
> clear-signing of nested calls is limited — for the cleanest demo it's better
> to clear-sign the `executeBatch` and/or show a direct `startStreamBot`.

## 6 · Mapping to "what they like"

| What Ledger wants | How it's met |
|---|---|
| Real user value, not chatbot wrappers | Real DeFi security product (capital on demand) |
| Clear boundaries autonomous ↔ explicit approval | Central thesis of the project: scoped agent + user signature |
| Concrete use of Ledger primitives | **`signDelegationAuthorization` (7702)** + **ERC-7730 clear signing** — advanced primitives, not branding |
| Practical demos: why device-backed trust matters for AI | The device atomically authorizes the agent's authority; the agent never exceeds it |
| Human-in-the-loop for sensitive actions | Setup + kill switches device-backed; autonomous swaps scoped |

---

## 7 · Open decisions (to confirm)

1. **Is there a physical Ledger** or do we use Speculos for the demo? (Defines the strength of the video.)
2. **Self-send or relayer** for the type-4 tx? (Affects L-01 nonce.)
3. **Which delegate do we reuse** (Safe / OZ / our own minimal)? (L-07.)
4. **Registry PR or embedded** in the dApp for the demo? (Recommended: embedded + parallel PR.)

---

## 8 · Confirmed facts (research)

- **Ledger DMK 7702:** `signerEth.signDelegationAuthorization(derivationPath, chainId, contractAddress, nonce)` → `{r,s,v}`, pkg `@ledgerhq/device-signer-kit-ethereum`.
  https://developers.ledger.com/docs/device-interaction/references/signers/eth#use-case-5-sign-delegation-authorization-eip-7702
- **Base supports EIP-7702** (OP Stack post-Pectra): https://docs.pimlico.io/guides/eip7702/faqs
- **Clear Signing / ERC-7730:** overview https://developers.ledger.com/docs/clear-signing/overview ·
  specs https://developers.ledger.com/docs/clear-signing/reference/specifications ·
  dApp manual https://developers.ledger.com/docs/clear-signing/for-dapps/manual-implementation ·
  registry https://github.com/ethereum/clear-signing-erc7730-registry ·
  workshop https://github.com/LedgerHQ/erc-7730-workshop
- **Current web stack:** Reown AppKit + wagmi (`base`/`baseSepolia`/local) — the Ledger path is added alongside.
