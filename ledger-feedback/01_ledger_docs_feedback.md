# 01 · Ledger docs & SDK feedback

Required deliverable for the **AI Agents x Ledger** bounty. This is concrete,
first-hand feedback from integrating Ledger primitives into StreamVaults — a DeFi
agent where the Ledger is the trust layer (device-signed **EIP-7702** atomic setup
via `signDelegationAuthorization` + **Clear Signing / ERC-7730**). Everything below
was hit while building Fase 1–3 (see `00_ledger_7702_clear_signing.md`).

Stack used: `@ledgerhq/device-management-kit` 1.5.1, `@ledgerhq/device-signer-kit-ethereum`
1.16.0, `@ledgerhq/device-transport-kit-speculos` 1.2.1, Speculos + the Ethereum
app 1.23 (built from `LedgerHQ/app-ethereum` via `ledger-app-builder`), `erc7730`
(Python).

---

## What worked well

- **ERC-7730 tooling is excellent.** `erc7730 generate` (bootstraps from an
  on-chain ABI) → `lint` (enforces device limits) → `calldata` (compiles to the
  device's serialized descriptors) is a clean, fast loop. Got a valid descriptor
  for a non-trivial contract in minutes.
- **The DMK composition is clean** once the packages are known: builder +
  transport + signer-kit, RxJS device actions with clear `status` states.
- **The 7702 clear-signing UX is genuinely good.** The device renders
  *"Delegate to Simple7702Account · Delegate on network Base · upgrade into smart
  contract account"* — exactly the human-in-the-loop boundary we wanted.
- **An official Speculos transport for the DMK exists**
  (`device-transport-kit-speculos`, with an `isE2E` flag) — great for automated
  testing.

---

## Gaps / friction (each is a concrete, PR-able doc or SDK fix)

### 1. The EIP-7702 delegate **whitelist** is not in the developer docs
The device only signs a 7702 delegation to a whitelisted contract — currently
**only `Simple7702Account`** (eth-infinitism) at
`0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9` (`chain_id = 0` → all chains). Any
other delegate is refused. We only discovered this by reading the app source
(`src/features/sign_authorization_eip7702/whitelist_7702.c`). 
**Fix:** document the whitelist on the `signDelegationAuthorization` page — which
delegate(s) are allowed, the address, and how the list is maintained/extended.
This is make-or-break for any dApp doing 7702 + Ledger (we had built our PoC
around a different, audited delegate that the device would have rejected).

### 2. 7702 signing is **off by default** and the failure is opaque
With the "smart account upgrade" setting off (the default), `signDelegationAuthorization`
fails. The device screen says *"Enable smart account upgrade in the settings"*,
but the DMK surfaces only **`Unexpected device exchange error happened`** — no
actionable code. 
**Fix:** (a) document that the user must enable the setting first (and ideally how
a dApp can detect it / prompt the user); (b) map the app's status word to a typed
DMK error like `Eip7702SigningDisabled` instead of the generic exchange error.

### 3. The DMK ESM build breaks Node ESM consumers
`@ledgerhq/device-management-kit`'s published ESM (`lib/esm/index.js`) uses
**directory imports without extensions** (`import … from './src'`), which Node's
strict ESM resolver rejects with `ERR_UNSUPPORTED_DIR_IMPORT`. We had to run our
scripts with **`bun`** instead of `node`. 
**Fix:** ship a Node-ESM-spec-compliant build (explicit `.js` extensions / proper
`exports`), or document that a bundler/Bun is required for Node consumers.

### 4. The Speculos + DMK testing path isn't discoverable from the docs
The bounty/ETHGlobal page and the signer docs don't mention
`device-transport-kit-speculos` or how to drive Speculos from the DMK
(`speculosTransportFactory(url, isE2E, deviceModelId)`, `speculosIdentifier`). We
found it on npm. Also, on a touchscreen model (flex) the device actions still wait
for on-screen approval; the `isE2E` flag didn't auto-complete the swipe/hold-to-sign
flow, so we had to drive `POST /finger` events manually. 
**Fix:** a "Testing your DMK integration with Speculos" guide (the transport
package, `isE2E` semantics per device model, and how approvals are auto-driven).

### 5. Getting a 7702-capable Ethereum app into Speculos is undocumented & heavy
Speculos doesn't bundle the Ethereum app ELF; you must clone `LedgerHQ/app-ethereum`
and build it with `ledger-app-builder` (an ~8 GB image) for a device target. There's
no documented quick path or prebuilt ELF for hackathon devs. 
**Fix:** publish a prebuilt Ethereum app ELF (per device model) for Speculos, or a
one-command "run the Ethereum app in Speculos" snippet.

### 6. `erc7730 generate` corrupts piped output (Rich line-wrapping)
`erc7730 generate … > file.json` wraps long lines (long function-signature keys)
to the terminal width even when piped, producing invalid JSON (a newline inside a
string literal). Worked around with `COLUMNS=100000`. 
**Fix:** don't pretty-wrap when stdout isn't a TTY (or add a `--output <file>` flag).

### 7. ERC-7730 device limits should be stated up front
`lint` enforces intent ≤ 30 chars and label ≤ 20 chars (else "may be truncated on
Ledger devices"). These limits aren't prominent in the authoring docs, so the first
lint pass surprised us. 
**Fix:** state the per-field character limits in the descriptor-authoring guide.

### 8. `signDelegationAuthorization` return — document the signature convention
The method returns `{ r, s, v }`. To build a viem EIP-7702 `authorizationList`
entry we needed `yParity` (`v >= 27 ? v - 27 : v`) and to re-pair it with
`(chainId, delegate, nonce)`. 
**Fix:** a short snippet showing how to turn the returned `Signature` into a
ready-to-send 7702 authorization (the most common next step).

### 9. `withContextModule` reads as "provide your own clear-signing" — but a production device rejects unsigned descriptors
`SignerEthBuilder.withContextModule` + `ContextModuleBuilder.addLoader` look like a
self-serve path to clear-sign your own contract immediately. In practice, Ledger's
calldata descriptors carry **PKI `signatures`** that the device verifies; a
descriptor a dApp serves itself (e.g. the output of `erc7730 calldata`) is unsigned,
so the device falls back to blind signing. Concretely:
`HttpCalldataDescriptorDataSource` builds each context's `payload` via
`HexStringUtils.appendSignatureToPayload(descriptor, signature)` + a PKI
`certificate` — the device-bound payload REQUIRES a Ledger-produced signature
appended to the descriptor. `erc7730 calldata` emits the descriptor but NOT that
signature (only Ledger generates it on registry merge), so there is **no local way**
to build a valid context — a custom loader can't even preview it on Speculos with
the production app, since the app verifies the appended signature. The single way to
clear-sign your contract is the registry (Ledger signs on merge). We spent real time
on the custom-loader path before realizing it's gated by Ledger-side signing.
**Fix:** state up front that custom-loader/self-served clear-signing is impossible
without a Ledger-signed descriptor; production clear-signing requires the registry.
Point `withContextModule` docs at what it's actually for (trusted names, tokens,
Ledger-signed content) vs. what it can't do (self-serve arbitrary contract metadata).

---

## Suggested improvements (summary)

| # | Area | Improvement |
|---|---|---|
| 1 | `signDelegationAuthorization` doc | Document the delegate whitelist (Simple7702Account address, policy) |
| 2 | DMK errors + 7702 doc | Typed error for "7702 disabled in settings" + how to detect/prompt |
| 3 | DMK package | Node-ESM-compliant build (or document Bun/bundler requirement) |
| 4 | Testing docs | "DMK + Speculos" guide (transport, `isE2E`, per-model approval) |
| 5 | Speculos docs | Prebuilt Ethereum app ELF / one-command run |
| 6 | `erc7730` CLI | No Rich wrapping when piped; `--output` flag |
| 7 | ERC-7730 authoring doc | State per-field char limits (intent ≤30, label ≤20) |
| 8 | 7702 signer doc | Snippet: `{r,s,v}` → viem `authorizationList` entry |
| 9 | `withContextModule` doc | State that custom-loader clear-signing is dev/Speculos-only; production needs a Ledger-signed (registry) descriptor |

> Net: the primitives are powerful and the clear-signing UX is great; the main
> friction is **undocumented device-level 7702 policy** (whitelist + the off-by-default
> setting) surfaced through **opaque errors**, plus the **Node-ESM build** and the
> **Speculos app-ELF** onboarding. All are doc/DX fixes, not protocol issues.
