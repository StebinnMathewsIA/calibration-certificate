# Prowalco Calibration App Constitution

This file governs how work is done in this repository. It takes precedence over
convenience. Any contributor — human or AI assistant — must follow it.

*(Ported from the TummyTally constitution and adopted here via issue #1.)*

## Article 1 — Every change starts as a GitHub issue (the prime directive)

**No code is written until the request exists as a GitHub issue, and that issue
has been specced out.**

This applies to *every* feature request or bug report, **including ones made
casually in chat**. If someone says "can you also add X" or "X is broken" in a
conversation, the first action is **not** to edit code — it is to:

1. **Log it on GitHub** as an issue:
   - a **feature request** → label `enhancement`
   - a **bug** → label `bug`
2. **Spec it out** in the issue body using the template below before any
   implementation begins.
3. Only then begin implementation, referencing the issue number in commits
   (e.g. `Closes #12`).

If a single chat message contains several distinct requests, open a **separate
issue for each** so they can be tracked, tested, and closed independently.

## Article 2 — Specs are mandatory

Every issue must be specced before work starts. Use this template:

```
### Summary
One or two sentences: what and why.

### Motivation
The user problem this solves.

### Proposed behaviour
Concretely, what the app/system will do. Include UX, data, and edge cases.

### Out of scope
What this explicitly does not cover.

### Acceptance criteria
- [ ] Testable, user-observable statements that define "done".
```

A bug issue replaces *Proposed behaviour* with *Steps to reproduce*,
*Expected*, and *Actual*.

## Article 3 — Close the issue when it is ready for testing

When implementation is complete and pushed, **close the issue** with state
reason `completed` and a short comment summarising what shipped and how to test
it.

Closing means "ready for the user to test", **not** "verified in production".
The user performs acceptance testing separately. When they want a change or find
a problem, that becomes a **new** issue (Article 1) — we do not reopen-and-grow
a closed issue into a catch-all.

## Article 4 — Track what still needs human testing

Anything that cannot be verified in this environment (native iOS/Android
behaviour, biometrics, on-device UX, provider sign-ins, third-party services)
must be recorded in [`docs/TESTING.md`](docs/TESTING.md) as an unchecked test
case, so the user has a single living checklist of what to confirm on real
devices.

## Article 5 — Honesty about state

Never imply that infrastructure exists when it does not. Backends, credentials,
deployments, and external services must be described accurately: what is code in
this repo vs. what the user still has to provision and deploy.

## Article 6 — Version 0: commit straight to `main`

We are currently in **version 0** (pre-release). Until the user explicitly
declares **version 1**, all changes are committed **directly to `main`** — no
feature branches or pull requests are required, and there is no need to ask
before pushing to `main`. Speed of iteration wins while the app is still taking
shape.

The user will say when we move to version 1. From that point this article is
superseded: work returns to feature branches + PRs, and `main` becomes
protected. Until then, "commit it" means "commit it to `main`".

---

*Amendments to this constitution are themselves changes, and so must follow
Article 1: open an issue, spec it, implement, close.*
