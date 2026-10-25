# HomeNode R1-H4 · Experimental authenticated LAN capability gateway

**Risk classification: preview / local operator testing.** This independently started HTTPS read-only capability service is designed for one trusted private LAN. It is NOT a secure multi-user Git forge, remote Git transport, remote runner, or production security audit. Nothing is installed or network-exposed by merging this change.

Existing GitPorch dashboard and Git daemon remain restricted to 127.0.0.1. **Never expose ports 3690 or 9418 by firewall, port-forward, tunnel, reverse proxy, or wildcard bind.**

## Available endpoints (both require TLS and a bearer token)

| Method | Path | Meaning |
| --- | --- | --- |
| GET | /v1/health | Gateway process is responding, not proof of Git/disk/offline readiness |
| GET | /v1/capabilities | Versioned static installed-feature declaration, not functional certification |

No repositories, private file paths, builds, authentication data or remote commands are exposed. All other URLs return 404 after authentication; non-GET methods return 405. Browser Origin/cookies and CORS are disallowed; no user-supplied Git command is executed.

## Setup, Windows PowerShell

1. Install Node.js 20+ and Git; prepare a private secret directory **outside** the cloned GitPorch repo and its `data/` folder.
2. Find the exact machine private IPv4 via `ipconfig`. Bind to that IPv4, or first test on `127.0.0.1`. The example must be replaced with your actual address.
3. Provide a PEM certificate with an IP Subject Alternative Name (SAN) for the exact bind address, and its matching private key. Create a private 32-byte random bearer token file (64 hex digits). All credential files must have absolute paths and restricted filesystem ACLs.

For an isolated loopback lab with OpenSSL installed, run:

~~~powershell
$secretDir = Join-Path $env:USERPROFILE 'PhiOSSecrets\HomeNode'
New-Item -ItemType Directory -Force $secretDir | Out-Null
$env:GITPORCH_HOMENODE_BIND = '127.0.0.1'
openssl req -x509 -newkey rsa:3072 -nodes -days 90 -keyout (Join-Path $secretDir 'tls-key.pem') -out (Join-Path $secretDir 'tls-cert.pem') -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $secretDir 'bearer-token.txt'), $token)
Remove-Variable token, bytes
$env:GITPORCH_HOMENODE_TLS_CERT_FILE = Join-Path $secretDir 'tls-cert.pem'
$env:GITPORCH_HOMENODE_TLS_KEY_FILE = Join-Path $secretDir 'tls-key.pem'
$env:GITPORCH_HOMENODE_TOKEN_FILE = Join-Path $secretDir 'bearer-token.txt'
$env:GITPORCH_HOMENODE_PORT = '3743'
~~~

**Security:** this pilot's TLS private key is unencrypted on disk. Restrict its ACL and token file ACL to the operator and authorized OS accounts, never publish credentials, and rotate the certificate/token periodically. Windows and client browsers do not automatically trust self-signed certificates. Independently verify fingerprints before manually trusting a cert. A stronger certificate and secret storage method is required for production.

4. Before starting any listener, review the LAN IP, certificate SAN, keys, disk backup, machine permissions, router and Windows Firewall. Allow only trusted LAN clients to the single gateway port. Do not open any WAN port or expose the existing GitPorch services.
5. Preflight, then deliberately start:

~~~powershell
npm test
npm run gateway -- preflight
npm run gateway -- serve --i-accept-lan-read-only
~~~

The gateway starts **only** from the last explicit command; `npm start` is unchanged. The preflight only checks local file readability, size, and token format. It does NOT verify certificate SAN, signer trust, expiration, ACL security or penetration testing. Stopping the foreground command stops the listener; no startup service is configured.

## Trusted client probe

The URL is `https://<actual-private-IP>:3743/v1/capabilities`. Use a client that verifies the operator-approved certificate or CA, and passes an Authorization Bearer header loaded securely from its own private settings. Do not bypass validation with curl `-k`, put tokens in URLs, copy tokens into chat/GitHub, or embed them into public JavaScript. This version deliberately has no browser CORS.

## PhiOS / EnterTheField.org switching contract

| Mode | Endpoint source | Responsibility |
| --- | --- | --- |
| PUBLIC | EnterTheField.org / GitHub | Cloud content; gracefully report internet outage |
| LOCAL | Trusted PhiOS native companion to authenticated LAN gateway | Independently verified TLS trust and stored token; no public-browser credentials |
| OFFLINE | Installed local GitPorch/apps/models/assets | No Internet dependency; do not confuse cached display with running services |

A publicly served HTTPS web page cannot simply call private LAN services: browser CORS and private-network policies apply, and this gateway intentionally blocks browser Origin requests. A public DNS record does not make private IP services reachable from the internet. The future PhiOS **native companion** must hold secrets outside frontend JavaScript and provide an explicitly trusted same-origin interface if browser integration is needed.

The gateway is an **availability/capability handshake**, NOT a proxy to ports 3690/9418 or a transport for Git operations.

## Acceptance

Run full `npm test` and manual tests for incorrect/missing bearer token, wrong Host, plaintext HTTP rejection, invalid bind addresses, TLS certificate trust failure, forbidden browser Origin, no state-mutating routes, service teardown, and Windows Firewall access from a nontrusted host.

**Never equate `GATEWAY_RESPONDING_ONLY` with a validated backup, repository health, verified build, secure implementation, or installed PhiOS.** R1-H5 can add an authenticated local companion and tested failover after an independent security review.
