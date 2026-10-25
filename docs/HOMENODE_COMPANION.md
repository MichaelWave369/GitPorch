# GitPorch R1-H5 · PhiOS HomeNode native companion

The one-shot **Node.js command-line companion** makes an authenticated, certificate-pinned request to R1-H4's **metadata-only** LAN capability gateway. It does not start a daemon, expose an HTTP listener, modify any repository, sync GitHub, run builds, or provide a browser API. It is an integration contract for a future locally installed PhiOS companion, not a deployed PhiOS app.

## Modes and truthful states

| Requested mode | Network action | Outcome |
| --- | --- | --- |
| OFFLINE | No request | OFFLINE_SELECTED_NOT_VERIFIED: local apps/models/backups are **not** checked |
| PUBLIC | No request | PUBLIC_SELECTED_NOT_PROBED: website/internet availability is **not** checked |
| LOCAL | One authenticated pinned TLS request to LAN gateway | LOCAL_GATEWAY_VERIFIED_ONLY if handshake/capabilities succeed |
| LOCAL, failed | No retry or public fallback | Effective OFFLINE with a categorized error and offlineServicesVerified=false |

Local gateway verification **does not** prove Git history integrity, repo inventory accuracy, service installation, offline asset availability or backup restoration. It only establishes that the expected gateway answered with the expected restricted capability schema using the pinned certificate and token.

## Operator setup

First complete [R1-H4 LAN Gateway](HOMENODE_NETWORK.md) on the server machine. Use its private network IP and valid IP-SAN TLS certificate. On the client machine, copy only the server's **public TLS certificate** and an independently provisioned client bearer token into an ACL-restricted private directory, separate from the GitPorch source and any public web project. This pilot shares the R1-H4 bearer token, so it does **not** have per-client identities, independent scopes, issuance, revocation, or a credential broker. Never commit these files or embed the token in browser JavaScript.

The fingerprint should be established through a trusted second channel (operator-verified certificate or authenticated, separately trusted communication). The local fingerprint helper can display a candidate SHA-256 fingerprint, **not authenticate its origin**.

~~~powershell
# The following paths and IP are examples. Set the actual client private paths/IP.
npm run companion -- fingerprint 'C:\Private\PhiOS\tls-cert.pem'
$env:GITPORCH_COMPANION_IP = '192.168.1.50'
$env:GITPORCH_COMPANION_PORT = '3743'
$env:GITPORCH_COMPANION_CERT_FILE = 'C:\Private\PhiOS\tls-cert.pem'
$env:GITPORCH_COMPANION_TOKEN_FILE = 'C:\Private\PhiOS\client-token.txt'
$env:GITPORCH_COMPANION_CERT_SHA256 = '<64-hex-fingerprint-verified-out-of-band>'
npm run companion -- preflight
npm run companion -- status --mode local
~~~

The private certificate file is used as an explicit trust anchor. The native client also requires its exact SHA-256 certificate pin and checks the IP Subject Alternative Name and expiration. The HTTPS connection validates the TLS certificate again, enforces the pin and hostname, sends a Bearer token header (not URL query), and rejects unexpected capability schemas. Do not bypass TLS validation.

Other explicit modes require no secrets or internet connection:

~~~powershell
npm run companion -- status --mode public
npm run companion -- status --mode offline
~~~

The companion uses the exact configured private IPv4 address (or 127.0.0.1 on the same computer) and a configurable high port. It rejects public IPs, wildcard addresses, URL strings and hostname redirection. It makes one GET to `/v1/capabilities`, has a 5-second timeout and a 16 KiB response bound, never follows redirects, and never emits a bearer token, certificate, private path or raw network error.

## Failure and integration contract

The companion returns version `gitporch.homenode.companion.v1` with `requestedMode`, `effectiveMode`, `status`, `localGatewayVerified`, and a strictly limited capability summary. On Local failure, `effectiveMode` changes to OFFLINE and `offlineServicesVerified` remains false. Consumers must not interpret that as installed or operational offline services; it is only a selection result. No automatic public fallback occurs.

Possible failure categories: LOCAL_CONFIGURATION_REQUIRED, LOCAL_UNTRUSTED, LOCAL_REJECTED, LOCAL_BAD_RESPONSE, LOCAL_TIMEOUT and LOCAL_UNAVAILABLE. None should be silently converted into green status.

**EnterTheField.org:** Do **not** insert tokens into public JS, localStorage, client-side fetch calls, DNS records, or GitHub Pages. This CLI cannot directly power the public website because the R1-H4 gateway intentionally rejects browser Origin requests and sends no CORS. A future locally installed PhiOS app may consume this module and expose sanitized status over a **separate, secured local IPC or same-origin bridge** only after a threat model and browser security review. No public website or PhiOS repo is changed here.

## QA / limitations

Focused local integration tests cover Public/Offline no-network behavior; public-IP refusal; real local TLS; correct, incorrect and unavailable certificate/token/server; unexpected/unsafe capability payloads; and symlinked token refusal where supported. The full GitPorch suite and actual two-PC Windows LAN test must still run before claiming this is green.

Security limitations: manual trust-on-provisioning, shared static bearer token, private PEM/key custody, possible local process compromise, no platform keychain/DPAPI yet, no ACL verification on Windows, no certificate rotation automation, and no verified browser bridge. The operator must protect token files and independently validate the HomeNode gateway's security.

**Ledger Above Ego:** mode selection is not a disaster-recovery certificate.
