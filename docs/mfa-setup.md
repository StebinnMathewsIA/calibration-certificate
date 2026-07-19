# MFA setup — identity-provider enforced, tablet as second factor (#50)

Decision (review session, 2026-07): two-factor authentication is enforced **at
the identity provider**, not in the app. The first sign-in on a device carries
the MFA challenge; after that the enrolled tablet itself is the possession
factor (refresh token in hardware-backed storage) and the device PIN at
signing is the knowledge factor. Technicians feel MFA once per device, not per
shift.

## Why the app needs no changes

- Sign-in runs through the **system browser** (`expo-web-browser` →
  Supabase → IdP). Whatever challenge the IdP mandates — MFA prompt,
  passkey, password reset — simply appears in that flow.
- The session refresh token is stored with **expo-secure-store**, which is
  the Android Keystore / iOS Keychain — hardware-backed, per-device,
  non-exportable. Possession of a signed-in session ⇒ possession of the
  enrolled device.
- The **signing re-prompt** (`expo-local-authentication`,
  `disableDeviceFallback: false`) uses biometrics where present and falls
  back to the **device PIN/pattern automatically** on tablets without
  biometric hardware. Every certificate signature therefore requires a fresh
  local credential confirmation.

## Owner configuration (consoles, ~15 minutes)

### Microsoft Entra — pick ONE path

**Path A — Security defaults (free, tenant-wide):**
[entra.microsoft.com](https://entra.microsoft.com) → Identity → Overview →
Properties → *Manage security defaults* → **Enabled**. All users must
register MFA within 14 days; challenges are risk-based/first-device rather
than every sign-in — exactly the once-per-device feel we want.

**Path B — Conditional Access (needs Entra ID P1):**
Entra → Protection → Conditional Access → New policy:
- Users: the technicians group (exclude a break-glass admin account)
- Target resources: All cloud apps (or the Supabase app registration)
- Grant: **Require multifactor authentication**
- Session: leave sign-in frequency at default so token refresh keeps
  enrolled devices signed in; do NOT enable "every time"

**Passkeys (optional, both paths):** Entra → Protection → Authentication
methods → Policies → **Passkey (FIDO2)** → enable for the technicians group.
One screen-lock gesture, phishing-resistant.

### Google Workspace (if technicians use Google sign-in)

Admin console → Security → Authentication → **2-Step Verification** →
enforce for the technicians' organisational unit. Allow passkeys ("skip
passwords when possible").

### Apple

Apple IDs require Apple's own 2FA by default — nothing to configure.

### Device policy (MDM or issue checklist)

- Every field tablet MUST have a screen lock (PIN/pattern) set — this is the
  knowledge factor at signing. Enforce via MDM if available; otherwise it is
  a checklist item when issuing a tablet.

## Assessor note

Record in the e-signature procedure: sign-in identity is MFA-protected at
the IdP; the cryptographic signing action additionally requires a fresh
device-credential confirmation (biometric or PIN) at the moment of signing,
captured as the intent-to-sign event in the audit trail.
