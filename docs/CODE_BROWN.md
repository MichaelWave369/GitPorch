# Code Brown · CB-001
**The human usability gauntlet for the Φ ecosystem**

> If Brown can't figure it out, we haven't finished building it.

This is a friendly mnemonic named for a real-world, nondeveloper usability encounter, **not** a judgment of anyone's intelligence. A confusing screen is an application design problem to investigate, not evidence that the visitor is wrong.

## The six checks
1. **Understand (5 seconds).** Ask a fresh visitor what the app is for, without explaining it.
2. **Find action.** Watch them find the primary action without coaching.
3. **First success (30 seconds).** Can they reach one meaningful outcome without instruction?
4. **Device controls.** Can they navigate using the controls available on that device (including Xbox browser/controller where supported)?
5. **Error recovery.** Can they recover after a realistic mistake without developer assistance?
6. **Would return.** After trying it, do they say they would use it again? Ask, don't infer.

These are **observation goals, not automated performance claims**. For timing checks, start timing at first exposure and record the observed result; the report currently stores the observation in free-text evidence rather than a stopwatch-certified metric. Test on supported devices only, and document unsupported devices instead of quietly awarding a pass. Involve new users and people with varied accessibility needs where possible.

## Browser checklist (first usable interface)
After Pages deploys, visit [Code Brown QA](./code-brown.html), fill the six outcomes, and export a report JSON file. Everything is local to that browser tab; **no results are submitted or stored remotely**. The tester alias is optional. Avoid personal information in notes.

## CLI
Requires Node 20+, no npm dependencies.

    node src/code-brown-cli.mjs examples/code-brown.example.json
    node src/code-brown-cli.mjs path/to/human-report.json --require-pass

Possible results:
- **PASS:** all six checks reported passed, each with an observation, and the report declares a human-led session. **Self-reported**, not independently verified.
- **FAIL:** at least one observed check failed, with evidence.
- **PENDING:** incomplete/untested report, or a report not claiming human observation.
- **INVALID:** malformed input, unsupported check, or a claimed pass/fail without evidence.

By default PENDING exits 0 so existing CI is not blocked by missing manual review. With \`--require-pass\`, PENDING exits 1. FAIL or INVALID always exit nonzero. **Do not gate all repos on this until real human sessions and reasonable device scope are defined.**

## Adoption
Put a Code Brown JSON report in the app's own repository (for example \`qa/code-brown.json\`), retain the test date, device/browser and a short observation per check. Link a Code Brown report in the PR/release notes. Repeat after major interaction changes. The first rollout targets discoverability and public apps such as REELCommons, PhiBox, SPARK and Field Atlas, but these **have not been automatically certified** by adding this tool.

Machine CI can separately validate links, basic semantics, keyboard focus, performance and console errors; those checks supplement rather than replace real human observation. This v0.1 creates a portable manual acceptance protocol and JSON validator, **not a cross-repository scanner, CI fleet or accessibility audit**.

Ledger above ego: if someone gets stuck, fix the experience rather than blaming the person.
