# PlayOn — Replit Build Prompt

> **Living document.** The prompt used to build PlayOn in Replit. Keep in sync with `PLAYON_OVERVIEW.md`.
>
> **How to use:** Paste **§4 Master Prompt** into Replit's AI agent for the initial scaffold (Phase 1). Then build phase by phase using the **§5 Scoped Phase Prompts**, testing after each. The full plan (§3) is complete now even though features ship in phases — this keeps early architecture decisions from blocking later features.

| | |
|---|---|
| **Document** | PlayOn Replit Build Prompt |
| **Version** | 0.8.0 |
| **Last updated** | 2026-05-26 |
| **Companion file** | `PLAYON_OVERVIEW.md`, `PLAYON_FUTURE_FEATURES.md` |
| **Phase 1 platform** | Responsive web app (mobile-first) |
| **Phase 2 platform** | Native mobile app (shared API) |

---

## 1. Recommended Tech Stack

- **Frontend:** React + Vite + Tailwind CSS (responsive, mobile-first).
- **Backend:** Node.js + Express, REST API designed for reuse by a future native app.
- **Database:** PostgreSQL + ORM (Prisma or Drizzle).
- **Auth:** Email/password + magic link; role-based access control (RBAC) with staff permission tiers.
- **Payments in:** Stripe Checkout + webhooks.
- **Payments out:** Stripe Connect (connected accounts for refs/coaches).
- **Notifications:** Email (transactional provider) + push; **SMS optional** (e.g., Twilio — confirm).
- **Hosting:** Replit Deployments.
- **Phase 2 native:** React Native / Expo on the same API.

---

## 2. Architecture Principles (apply from day one)

These keep later phases unblocked even though they ship later:

1. **API-first.** All features behind a clean REST API so the native app reuses it.
2. **Polymorphic Offering model.** One `Offering` base with type-specific extensions (league/camp/dropin/tournament) so new behaviors slot in.
3. **Pricing is a configurable layer, not a field.** Prices live in admin-editable `PricingRule` records per category — never hardcoded — so admins change pricing anytime without a developer. A `FacilitySplitRule` per venue computes facility cut vs. PlayOn net.
4. **Money is double-sided.** Model **Payments (in)** and **Payouts (out)** as first-class from the start, even if payouts ship in a later phase.
5. **Admins can override everything.** Every automated output (AI schedules, waitlist promotion, standings, bracket progression, computed prices) must be manually editable by an admin. Automation proposes; admins dispose.
6. **AI is assistive, behind the API, RBAC-scoped.** AI calls the Anthropic Claude API server-side (never expose keys client-side). The AI assistant can only read/act on data the requesting user is permitted to see. AI scheduling produces a `ScheduleProposal` for admin approval — it never auto-publishes.
7. **Location-aware, single-location default.** Include a nullable/​default `location` reference so multi-location is a later toggle, not a rewrite.
8. **Versioned waivers + versioned pricing/splits.** Store which version was signed/applied; never mutate signed or historical financial records.
9. **Audit everything sensitive.** Payments, payouts, results, permissions, waivers, pricing/split edits, and admin overrides write to an `AuditLog`.
10. **Notification abstraction.** A channel-agnostic notification layer (email/push/SMS) so adding SMS later is config, not rework.
11. **Account-gated actions.** Public can browse; registration/payment requires login.

---

## 3. Complete Phased Plan

Everything PlayOn needs, organized by build order. Each phase is independently testable.

| Phase | Scope | Notes |
|---|---|---|
| **P1 — Foundation** | Auth; roles + staff permission tiers; user/player profiles; guardian↔child links; venue (Alumni Center, Lexington KY) + **admin-managed court pool** (two dedicated courts now — full 5v5-with-goalies + small-sided 4v4/3v3 — each with an `availableForScheduling` flag so admins add/remove courts; same-court time-conflict prevention; NOT user-bookable); **editable AgeGroups (8–11, 12–15, adult) with default court/format/time-band mappings**; **a unique QR code per user/player (and later per team) for scan-based check-in**; location-aware base; brand theming; AuditLog skeleton; notification abstraction (email first). | Everything depends on this. |
| **P2 — Pricing & Admin Core** | Admin-editable **PricingRule** per category (drop-in/camp/league/tournament); **FacilitySplitRule** per venue (percentage/flat/hybrid); revenue computation (gross/facility/net); global **admin console** with override controls + permission tiers. | Foundational: every offering references pricing + split. |
| **P3 — Drop-ins** | Session creation; **recurring session templates** (Friday bands); skill/age filtering; **per-court capacity caps (admin-editable, default ~15–20)** with an **independent waitlist per court pool** + auto-promotion; cancellation window; no-show/attendance; **day-of check-in / front-desk view** (mark present, paid-vs-owes at a glance, fill no-shows from waitlist); payment status (in-app + external). Uses P2 pricing. | Proves registration + payment + day-of loop. |
| **P4 — Camps** | Camp creation; **multi-day sessions + daily check-in (front-desk view)**; rosters; coach assignment; **versioned waivers** + **photo/media consent** for youth; age-eligibility check. Uses P2 pricing. | Adds rosters + youth compliance. |
| **P5 — Leagues** | Seasons; divisions/tiers; teams (+optional captain); fixture **schedule generation**; **same-court time-conflict prevention**; ref assignment; results entry; **auto standings + tiebreakers**; forfeits; playoffs; optional promotion/relegation. Uses P2 pricing. | Adds scheduling + standings. |
| **P6 — Tournaments** | Team registration + rosters; bracket formats (single/double elim, group→knockout); seeding; bracket progression; consolation brackets; tiebreakers. Uses P2 pricing. | Reuses teams/results from P5. |
| **P7 — Payments In (full)** | Stripe Checkout + webhooks; **refunds & credits**; **configurable refund/credit POLICY** (e.g., weather cancel → auto account credit; drop >48h before camp → X% refund); **discount/promo codes**; **family/sibling discounts**; **early-bird & late fees**; **installment/payment plans**; admin financial dashboard (paid/owed per offering, facility split breakdown, reconciliation). | Hardens money-in. |
| **P8 — Payouts (Stripe Connect)** | Ref/coach **connected-account onboarding**; amount-owed-per-assignment tracking; payout execution; payout history & status in the financial dashboard. | Money-out; depends on assignments (P5/P6) + payments (P7). |
| **P9 — AI Scheduling (two-stage)** | **Stage 1:** AI suggests pre-filled **events** (EventSuggestion) from demand + calendar landscape → **admin verifies/configures/locks** into an Offering. **Stage 2:** AI generates the **schedule details** (ScheduleProposal) within the locked event, following the rules (youth-first via **Fayette County Schools**; fixed Friday bands; age→court/format; **KSSL/KPL/ECNL** hints; year-round adult leagues; active court pool; no unconfirmed dates) → **admin approves**. Includes **external-calendar ingestion** (hybrid fetch + admin-confirm) + `RecurringScheduleRule`. Anthropic API server-side. | Depends on venues/age-groups + scheduling (P5/P6). |
| **P10 — AI Help Assistant** | Role-scoped chat assistant for **all users** (players/guardians/refs/coaches/admins). Answers from data the user may see (RBAC-enforced); can draft announcements for admins. Anthropic API server-side. | Depends on most data existing. |
| **P11 — Engagement & Family Experience** | **SMS/text in scope** (youth/guardian messages by text: waitlist, rainouts, receipts, schedule changes); **substitute-ref alert** (leagues & tournaments only — texts unscheduled refs to claim an open assignment; Fridays have no refs); automated reminders; announcements; **family dashboard** (one glance: family's week + balances across all children); **returning-player re-enrollment**; **end-of-season/camp youth recaps**; player **stats + attendance streaks** — **youth stats private/positive; competitive leaderboards adults + older youth only**. | Retention + family stickiness. |
| **P12 — Ops & Compliance** | Venue availability calendars; weather/cancellation + rescheduling workflows; **incident/injury reports**; **insurance tracking**; minor-data privacy controls; full audit-log surfacing. | Operational hardening. |
| **P13 — Memberships** | Membership/subscription tiers (recurring billing via Stripe); pricing gates/perks wired into the P2 pricing engine. **Design TBD** — see OVERVIEW. | Build once tiers are decided. |
| **P14 — Growth** | Public browse pages; marketing/landing pages; **referral program**; reporting dashboards (participation/revenue/retention); finalize **open API**. | Acquisition + insight. |
| **P15 — Native app** | Expo app on the shared API; push notifications. | After web is stable. |
| **Future — Multi-location** | Flip the location-aware model into true multi-venue/franchise support. | Not built; not blocked. |

---

## 4. Master Prompt (paste into Replit)

```
You are building "PlayOn," a management platform for a futsal brand running LEAGUES, CAMPS, DROP-IN SESSIONS, and TOURNAMENTS for YOUTH and ADULT players. It collects money from players AND pays out refs/coaches. Build a responsive, mobile-first web app: React + Vite + Tailwind frontend; Node/Express REST API (designed for reuse by a future native app); PostgreSQL + ORM; role-based auth with staff permission tiers; Stripe for payments in and Stripe Connect for payouts. Architect for hundreds of users now, scaling to thousands.

ARCHITECTURE PRINCIPLES (apply now even for later features):
- API-first; all features behind a clean REST API.
- Polymorphic Offering model: one base Offering with type-specific extensions (league/camp/dropin/tournament).
- Money is double-sided: model Payments (in) and Payouts (out) as first-class entities now.
- Location-aware but single-location by default (nullable location ref) so multi-location is a later toggle, not a rewrite.
- Versioned, immutable signed waivers.
- AuditLog for payments, payouts, results, permissions, waivers.
- Channel-agnostic notification layer (email/push/SMS) so SMS can be added later via config.
- Account always required to register/pay; public pages can browse only (no guest checkout).

ROLES (RBAC):
- Admin/Staff (with permission tiers): full control over offerings, teams, venues, schedules, rosters, payments, payouts, reports.
- Player: registers, joins teams, claims drop-in spots, views schedule/standings/stats, pays, signs waivers, sets notification prefs.
- Parent/Guardian (player-type account): manages one or more YOUTH player profiles; registers, signs waivers, pays.
- Ref: assigned to fixtures/tournaments; records results; has availability; paid out via Connect.
- Coach: assigned to teams/camps; views rosters/schedules; has certifications + background-check status; paid out via Connect.

CORE DATA MODEL:
User; PlayerProfile (age group, isYouth, stats); GuardianLink (parent->youth, one-to-many); StaffProfile (certifications, backgroundCheckStatus, availability, connectAccountId); Team (+optional captain); Venue (the Alumni Center, Lexington KY — a larger facility where PlayOn manages two dedicated courts); Court (belongs to Venue; format: full_5v5_goalies | small_sided; smallSidedMode nullable: 4v4 | 3v3 set per session by admin; availableForScheduling flag so admins add/remove courts from the AI pool; an internal admin-scheduled resource, NOT user-bookable); AgeGroup (label e.g. 8-11/12-15/adult, default court+format, default time band); RecurringScheduleRule (admin-editable recurring pattern, e.g. the Friday drop-in bands); ExternalCalendar (source: fayette_schools | KSSL | KPL | ECNL; type: youth_availability | alignment_hint; dates; confirmed flag); Offering (type, ageGroup, status, isPublic, location, pricingRuleRef); Season (divisions, tiebreaker rules, playoff config); SessionTemplate (recurring drop-ins); Fixture (teams, datetime, venue/court, ref, result); Standing (computed); Bracket (elim/group + consolation); Registration (player/team->offering, paymentStatus, waiverStatus, appliedDiscounts); RSVP/Spot (player -> a specific COURT POOL within a drop-in session; waitlist position, noShow; each court pool has its own admin-editable capacity, default ~15-20); Waiver (version, signedAt, signer; REQUIRED for ALL players youth+adult, guardian signs for youth); Payment (amount, method, status, discounts; supports DEPOSIT vs BALANCE for leagues/tournaments: depositPaid, balanceAmount, balanceDueDate = first game); Payout (staff, assignment, amount, status); PricingRule (category, base price, tier prices, earlyBird+cutoff, lateFee, memberPrice, installments, version); FacilitySplitRule (venue, optional offering override, type: percentage|flat|hybrid, values, version); RevenueRecord (offering, gross, facilityCut, playonNet); Membership (tier); DiscountCode; ServiceFeeConfig (admin-editable pass-through fee on in-app card payments, default ~3-4%, non-refundable); RefundCreditPolicy (admin rules: weather->credit, drop>48h->X% refund, etc.); AccountCredit (User credit balance usable on future registrations, optional expiry); SubRefAlert (LEAGUES & TOURNAMENTS ONLY — admin-triggered alert texting unscheduled refs to claim an open assignment, first-come, with claim tracking; Fridays have no refs); CheckIn (attendance: who, event/day/court-pool/team, present|no_show, timestamp, checkedInBy, method: QR|manual; surfaces payment + waiver status; player-level for drop-ins/camps/leagues, team-level for tournaments); QRCode (ONE durable code PER PERSON = their PlayOn ID, works across ALL events they register for — not per-registration; teams also get a code for tournament team check-in; manual fallback always available); Notification; Announcement; Assignment (ref/coach -> fixture/team/camp/tournament; drives payout); IncidentReport; AuditLog; EventSuggestion (Stage-1 AI proposal: suggested type/timing + pre-filled settings; status accepted|rejected|configured; generatedBy AI); ScheduleProposal (Stage-2 AI draft schedule WITHIN a configured/locked Offering; fixtures/courts/times; status: draft|approved|rejected, generatedBy AI); AssistantConversation (user, role-scoped messages).

PRICING ENGINE (admin-controlled):
- Prices are NOT hardcoded fields. Each Offering references a PricingRule that ADMINS create and edit via the UI.
- Per-category pricing: Drop-in (per session, per skill tier, member price, packs); Camp (per camp or per day, early-bird + cutoff, late fee, sibling/family discount, deposit vs full); League (team fee and/or per-player/free-agent fee, member price, installments); Tournament (per-team entry, optional per-player, early-bird, member price).
- FacilitySplitRule per venue (optional per-offering override): percentage, flat court-rental fee, or hybrid. Compute gross revenue, facility cut, and PlayOn net for every offering (RevenueRecord).
- Pricing and split changes are versioned + audited and apply to FUTURE registrations only.

ADMIN CONTROL (complete):
- Admins can create/edit/remove every entity and MANUALLY OVERRIDE every automated output (AI schedules, waitlist promotion, standings, bracket progression, computed prices).
- Permission tiers: super-admin can grant scoped staff access (e.g., schedule-only).
- All admin changes to sensitive data write to AuditLog.

AI FEATURES (Anthropic Claude API, server-side only — never expose API keys client-side):
- AI Scheduling is TWO-STAGE with an admin gate between, applied to ALL offering types:
  - STAGE 1 (AI suggests EVENTS): the AI surveys youth/school timing, season-alignment hints, what's already running, and seasonal demand, and proposes WHICH events should exist and roughly WHEN (e.g., "start a U10 spring league mid-March"; for drop-ins, "demand is high — add a second Friday session"). Each suggestion is PRE-FILLED with proposed settings (age group, court(s), format, fee from PricingRule, capacity, duration). It schedules NOTHING yet. Persist as EventSuggestion.
  - ADMIN GATE: the admin accepts/rejects each suggestion, toggles the pre-filled details on/off and adjusts them, and LOCKS the event into a configured Offering. Nothing proceeds without this.
  - STAGE 2 (AI schedules DETAILS within the locked event): only now does the AI generate the actual fixtures, court assignments, time slots, and matchups, FOLLOWING THE SCHEDULING RULES above and staying inside the admin's locked config. Output is a ScheduleProposal.
  - BOTH stages are proposals; the Stage-2 schedule is still reviewed and approved before publishing. No scheduling on unconfirmed external dates. Support natural-language re-optimization at Stage 2.
- AI Help Assistant for ALL users: role-aware chat that only reads/acts on data the requesting user is permitted to see (enforce RBAC server-side). Helps players/guardians (schedules, registration, balances), refs/coaches (assignments, result entry), and admins (queries, drafting announcements).
- Working default model: Claude Sonnet 4.6 for the assistant; a more capable model (e.g., Claude Opus) may be used for complex schedule optimization. Verify current model IDs in Anthropic docs at build time.

FACILITY & COURTS:
- PlayOn is the OPERATOR/ADMINISTRATOR of all PlayOn events at the Alumni Center, Lexington KY — a larger multi-court facility where PlayOn has dedicated TWO courts to futsal. Model the venue with two courts that PlayOn manages (the facility may have more courts, but PlayOn only controls these two).
- IMPORTANT: there is NO user-facing court booking. Individuals/teams CANNOT reserve courts. They sign up for OFFERINGS only. Admins (with AI assistance) decide what runs on each court.
- PlayOn's two dedicated courts can both be used simultaneously (PlayOn can run two offerings at once).
- ADMIN-MANAGED COURT POOL: admins can ADD or REMOVE courts from the set the AI is allowed to schedule on (each Court has an availableForScheduling flag). The AI schedules only across currently-active courts — today two, but this can change without code edits.
- Court 1 = FULL court: 5v5 futsal, larger goals, goalkeepers allowed.
- Court 2 = SMALL court: small-sided, run as 4v4 OR 3v3, set by the ADMIN per session/event (store the mode on the session/fixture).
- Court assignment is FULLY FLEXIBLE and ADMIN-CONTROLLED — no offering is locked to a court. The AI scheduler PROPOSES which court each session/fixture uses; the admin decides and can override.
- Each court is an INTERNAL scheduling resource: prevent the admin/AI from assigning two events to the SAME court at the same time (a conflict guardrail), while allowing both courts to run concurrently. This is NOT a booking system.

SCHEDULING RULES (admin-editable; the AI follows these, proposes, admin approves):
- YOUTH-FIRST: for EVERY event type, youth availability is the PRIMARY scheduling constraint; adults flex around youth. Youth availability is driven by the FAYETTE COUNTY PUBLIC SCHOOLS calendar (in-session vs out-of-school timing).
- FRIDAY DROP-IN (anchor recurring session, fixed time bands): Youth 8-11 on the small court (3v3/4v4) AND Youth 12-15 on the full court (5v5) run CONCURRENTLY 5:30-7:30pm; Adults get BOTH courts 7:30-9:30pm. Friday drop-ins are STAFF-SUPERVISED (a PlayOn or Alumni Center staff member runs check-in and supervises) with NO REFS — refs are only for league/tournament results.
- AGE GROUPS map to default court/format: 8-11 -> small (4v4/3v3); 12-15 -> full (5v5); adults -> both. Make age groups + their court/time mappings admin-editable.
- SEASON-ALIGNMENT HINTS (not blackouts): use KSSL, KPL, and ECNL schedules as hints to time PlayOn seasons effectively (slot offerings into gaps in the broader youth-soccer calendar). These are guidance, not hard date conflicts.
- ADULT LEAGUES RUN YEAR-ROUND, independent of the school calendar.
- EXTERNAL CALENDAR DATA (HYBRID): fetch public calendars where available (Fayette County Schools especially) AND let admins confirm/fill gaps each season. The AI must NOT propose schedules on UNCONFIRMED dates — confirmed calendar data is a prerequisite.
- OFFERING MIX BY AGE: Camps primarily youth; Leagues both youth + adults; Tournaments both youth + adults; Drop-ins both (via the Friday bands).

OFFERING BEHAVIORS:
- Drop-in: single dated session; can be generated from a recurring SessionTemplate (the Friday bands); skill/age filtering; PER-COURT capacity pools (default ~15-20 each) with an independent waitlist per pool; configurable cancellation window auto-promotes waitlist; track attendance + no-shows. STAFF-SUPERVISED (PlayOn or Alumni Center staff runs check-in + supervises), NO refs. No standings/brackets.
- Camp: date range, age group, capacity, price; may contain multiple sessions/days with PER-DAY check-in; register -> roster; assign coaches; ALL players need a signed versioned waiver (youth adds guardian signature + photo/media consent); verify age eligibility.
- League: seasons with divisions/tiers; teams (+free agents, mainly adult) play a generated fixture schedule (prevent same-court and ref time conflicts); refs enter results; auto standings (W/L/D, points, goal diff, GF/GA) with configurable tiebreakers; support forfeits, playoffs, optional promotion/relegation.
- Tournament: teams register with rosters; bracket formats (single elim, double elim, group stage -> knockout); seeding; auto bracket progression; consolation brackets; tiebreakers.

CHECK-IN (front-desk tool on phone/tablet; applies to ALL event types):
- PRIMARY FAST-PATH = QR CODES: every player and every team has a QR code in the app/web; ref/admin/staff SCANS to check in instantly. Manual search-and-tap is always the fallback (dead phone, won't scan, walk-ins). Support optional self-check-in at a kiosk.
- Universal: per-day attendee/roster list markable Present/No-show (scan or tap); payment status (paid/owes) inline with ability to mark cash/external on the spot; youth WAIVER flag if unsigned; quick search + running present-vs-expected count; all actions admin-overridable + audit-logged (record method: QR | manual).
- Drop-ins: staff member (no ref) sees the TWO court pools separately; no-shows free spots and the next waitlisted player can be pulled in (gets a text).
- Camps: PER-DAY check-in against the camp roster.
- Leagues: PLAYER-LEVEL check-in with ROSTER-ELIGIBILITY VERIFICATION — confirm the right players are checked in for the correct team, flag ringers/ineligible players. Include a QUICK ADD-PLAYER flow for game-day additions (create/attach to roster on the spot, capture waiver (guardian signs if youth)). Note forfeit if a team can't field enough eligible players.
- Tournaments: TEAM SELF-CHECK-IN the DAY BEFORE via app/web (captain confirms team + roster); admins see confirmations ahead of time and chase stragglers before brackets are set, so no-shows are resolved before event day. Event-day = quick QR scan for any remaining confirmations.

PAYMENTS IN (mixed):
- Stripe Checkout for in-app; external/offline marked by admins (cash/Venmo/invoice) with method+amount.
- paymentStatus: unpaid | paid_inapp | paid_external | refunded | waived.
- SERVICE FEE: add a clearly-labeled, admin-editable pass-through service fee (default ~3-4%) on IN-APP CARD payments to cover Stripe's cost (~2.9% + $0.30). Disclose it at checkout. Applies to in-app card payments only by default (not cash/external) — admin-configurable.
- Support refunds/credits, discount/promo codes, family/sibling discounts, early-bird + late fees, installment/payment plans.
- DEPOSITS (leagues & tournaments): a deposit holds the spot at registration; the BALANCE is due on or before the team's FIRST GAME. Track outstanding balance, show it on the team/family view, send reminders, and flag/block a team from playing if unpaid by the first fixture (admin-overridable). Deposit amount + balance-due rule are admin-editable per offering.
- REFUND-FEE HANDLING: Stripe does NOT return its processing fee on refunds, so the SERVICE FEE is NON-REFUNDABLE; refunds apply to the program fee per the RefundCreditPolicy. Account credits may have a configurable expiry.
- INSURANCE: the facility (Alumni Center) holds the insurance; PlayOn still captures signed waivers + tracks coach clearance expiry.
- NEVER store raw card data; delegate to Stripe.

PAYOUTS OUT:
- Refs/coaches onboard as Stripe Connect connected accounts.
- Track amount owed per assignment, payout status, and history.

YOUTH & COMPLIANCE:
- WAIVERS REQUIRED FOR EVERYONE (youth + adult): every player signs a versioned digital waiver before they can play; for youth the GUARDIAN signs. No play without a signed current-version waiver.
- Tag players/offerings youth or adult (U8, U10, U12, U14, adult coed/men's/women's).
- Youth adds on top: guardian accounts manage multiple children, photo/media consent, coach background-check status + certifications.
- Verify age eligibility at registration. Protect minor PII. Incident/injury reports. AuditLog for sensitive actions.

BRAND/THEME (from the PlayOn logo — athletic, bold, clean):
- Primary maroon #740D2A; Deep maroon #4B0014; Maroon shadow #550010; Charcoal #1F2629; Slate gray #575C5C; Off-white #EEE9E9; White #FFFFFF.
- Mobile-first, large tap targets, WCAG AA contrast, crest/shield + running player + futsal ball motif.

BUILD ORDER:
Build PHASE 1 ONLY now: auth; roles + staff permission tiers; user/player profiles; guardian links; venue (Alumni Center, Lexington KY) + an admin-managed court pool (PlayOn's two dedicated courts now — Court 1 full 5v5 with goalies, Court 2 small-sided 4v4/3v3 — each with an availableForScheduling flag so admins can add/remove courts) with same-court time-conflict prevention (NOT user-bookable); editable AgeGroups (8-11, 12-15, adult) with default court/format/time-band mappings; location-aware base; AuditLog skeleton; email notification abstraction; brand theming. Stub the rest of the data model (including PricingRule, FacilitySplitRule, RecurringScheduleRule, ExternalCalendar, ScheduleProposal, AssistantConversation) so later phases slot in, but don't build their UIs yet. Seed the venue, both courts, and the three age groups. Also create and maintain a living markdown file PLAYON_FUTURE_FEATURES.md in the repo — a product roadmap / parking lot where the owner records new ideas for later; keep it updated as features are proposed and promoted into the build. Then STOP and give me a README of what was built and how to run it, so I can test before Phase 2 (Pricing & Admin Core).
```

---

## 5. Scoped Phase Prompts (paste one at a time, after Phase 1)

**P2 — Pricing & Admin Core:**
```
Add the PRICING ENGINE and ADMIN CONSOLE. Build admin-editable PricingRule records per category: Drop-in (per session, per skill tier, member price, packs); Camp (per camp or per day, early-bird + cutoff date, late fee, sibling/family discount, deposit vs full); League (team fee and/or per-player/free-agent fee, member price, installments); Tournament (per-team entry, optional per-player, early-bird, member price). Build FacilitySplitRule per venue with optional per-offering override, type percentage | flat | hybrid, and compute RevenueRecord (gross, facility cut, PlayOn net) per offering. Prices/splits are versioned + audited and apply to future registrations only. Build a global admin console where admins can edit any entity and manually override any automated value, with permission tiers (super-admin can scope staff access). Every future offering reads its price from its PricingRule.
```

**P3 — Drop-ins:**
```
Add DROP-IN SESSIONS. Admins create sessions (date/time, which active courts are in use, skill level, age group per court) and recurring SessionTemplates that auto-generate sessions (including the Friday bands). PER-COURT CAPACITY: each court in a session has its own admin-editable spot cap (default ~15-20). A session running two courts holds two INDEPENDENT pools (e.g., 8-11 on small, 12-15 on full), each with its own cap and its own waitlist. Pricing from the drop-in PricingRule (P2). Players filter by skill/age and claim a spot in the relevant court pool; when that pool is full, they join THAT pool's waitlist (positions tracked). A configurable cancellation cutoff auto-promotes the next waitlisted player and notifies them. ADMINS retain full control: change any court's cap on the fly, manually add/move players between active list and waitlist, or close a pool early. Track attendance and no-shows. DAY-OF CHECK-IN / FRONT-DESK VIEW for the supervising staff member (PlayOn or Alumni Center staff — NO ref on drop-in nights): players check in by QR SCAN (manual tap/search fallback); see the two court pools separately, mark players present, see paid-vs-owes inline (mark cash payment on the spot), flag any unsigned waiver (ALL players need one; guardian signs for youth), and pull the next waitlisted player into a no-show's spot (auto-texts them). Each RSVP has paymentStatus (unpaid|paid_inapp|paid_external|refunded|waived); admins can mark external payment or override.
```

**P4 — Camps:**
```
Add CAMPS. Admins create a camp (date range, age group, capacity), optionally with multiple sessions/days and a per-day DAY-OF CHECK-IN / FRONT-DESK VIEW (mark each camper present, see paid-vs-owes at a glance). Pricing from the camp PricingRule (P2), including early-bird/late/sibling logic. Players/guardians register -> roster. Assign coaches. ALL registrations require a signed VERSIONED waiver before confirmation (youth adds guardian signature + photo/media consent). Verify the player's age matches the camp's age group. Roster export for admins.
```

**P5 — Leagues:**
```
Add LEAGUES. Admins create a season (divisions/tiers, tiebreaker rules, playoff config). Pricing from the league PricingRule (P2: team and/or per-player fees). Teams register into divisions (optional captain manages roster). A DEPOSIT holds the team's spot at registration; the BALANCE is due on or before the team's FIRST GAME — track it, remind, and block play if unpaid by the first fixture (admin-overridable). Support FREE AGENTS (mainly adult leagues): players register individually into a free-agent pool, and admins assign/balance them onto teams. Generate an editable fixture schedule (teams, datetime, venue/court, ref) preventing same-court and ref time conflicts; admins can manually edit any fixture. Refs enter results; standings auto-compute per division (W/L/D, points, goal diff, GF/GA) with configured tiebreakers. PLAYER-LEVEL CHECK-IN per fixture via QR scan (manual fallback): verify the right players are checked in for the correct team and flag ringers/ineligible players against the roster; include a QUICK ADD-PLAYER flow for game-day additions (create/attach to roster on the spot, capture waiver (guardian signs if youth)). Note forfeit if a team can't field enough eligible players. Support forfeits, playoffs, and optional promotion/relegation. Players/teams see schedule + standings.
```

**P6 — Tournaments:**
```
Add TOURNAMENTS. Admins create a tournament with a format (single elim, double elim, or group stage -> knockout). Pricing from the tournament PricingRule (P2). Teams register with rosters. A DEPOSIT holds the team's spot; the BALANCE is due on or before the team's first game (tracked, reminded, play blocked if unpaid — admin-overridable). Seed teams (manual or from group results). TEAM SELF-CHECK-IN the DAY BEFORE via app/web (captain confirms team + roster); admins see confirmations ahead of time and chase stragglers so no-shows are resolved before brackets are set. Event-day check-in is a quick QR scan for anything outstanding. Generate the bracket; refs enter results and the bracket progresses automatically, including a consolation bracket; admins can override any result/seed. Apply configured tiebreakers. Show the live bracket to all users.
```

**P7 — Payments In (full):**
```
Integrate Stripe Checkout for in-app payments on all registrations/RSVPs with webhooks setting paymentStatus=paid_inapp. Add a clearly-labeled, admin-editable SERVICE FEE (default ~3-4%) on in-app card payments to cover Stripe's processing cost, disclosed at checkout, applied to in-app card payments only by default (admin-configurable). Add refunds/credits and a CONFIGURABLE REFUND/CREDIT POLICY engine: admins define rules (e.g., weather cancellation -> automatic account credit; drop more than 48h before a camp -> X% refund; no-show -> no refund) and the system applies them consistently, with account credits usable toward future registrations (configurable expiry). The SERVICE FEE is NON-REFUNDABLE (Stripe keeps its fee on refunds). Add discount/promo codes, family/sibling discounts, early-bird and late fees, installment/payment plans, and DEPOSIT + BALANCE handling for leagues/tournaments (deposit at registration, balance due on/before first game, reminders, play blocked if unpaid by first fixture — admin-overridable), all wired to the P2 PricingRule. Build an admin financial dashboard: outstanding balances, paid vs unpaid per offering, external-payment log, refunds/credits issued, facility-split breakdown (gross/facility/net), and revenue by offering and date range. Never store raw card data.
```

**P8 — Payouts (Stripe Connect):**
```
Add ref/coach PAYOUTS via Stripe Connect. Staff onboard as connected accounts. For each Assignment, track amount owed; let admins approve and execute payouts; record payout status and history. Surface payouts owed vs paid in the financial dashboard. Never store raw bank data; delegate onboarding to Stripe Connect.
```

**P9 — AI Scheduling, two-stage (Anthropic API):**
```
Add TWO-STAGE AI SCHEDULING, server-side via the Anthropic Claude API (never expose the key client-side), with an ADMIN GATE between stages. Applies to all four offering types.

STAGE 1 — AI SUGGESTS EVENTS: from demand signals + the calendar landscape (youth/school timing, season-alignment hints, what's already running, seasonal demand), the AI proposes WHICH events should exist and roughly WHEN. Each proposal is PRE-FILLED with suggested settings (age group, court(s), format, fee from PricingRule, capacity, duration) and saved as an EventSuggestion. It schedules NOTHING. (For drop-ins, Stage 1 mainly suggests demand-driven changes like adding a second Friday session.)

ADMIN GATE: build the admin UI to accept/reject each EventSuggestion, toggle the pre-filled details on/off, adjust them, and LOCK the event into a configured Offering. Nothing proceeds without this.

STAGE 2 — AI SCHEDULES DETAILS within the locked event: generate the actual fixtures, court assignments, time slots, and matchups as a ScheduleProposal, staying inside the admin's locked config and FOLLOWING THE SCHEDULING RULES: (1) YOUTH-FIRST via the Fayette County Public Schools calendar; (2) FRIDAY bands — Youth 8-11 (small 3v3/4v4) + Youth 12-15 (full 5v5) concurrently 5:30-7:30pm, Adults both courts 7:30-9:30pm; (3) age-group->court/format mappings; (4) KSSL/KPL/ECNL as alignment hints, not blackouts; (5) adult leagues year-round; (6) schedule only across the ACTIVE court pool, never two events on one court at once; (7) NO scheduling on unconfirmed external dates.

Also build EXTERNAL CALENDAR ingestion: fetch public calendars where available (Fayette County Schools) + an admin UI to confirm/fill dates and mark KSSL/KPL/ECNL alignment windows. BOTH stages are proposals; render the Stage-2 schedule for the admin to review, edit, reassign courts, and approve/reject before publishing. Support natural-language re-optimization at Stage 2 (e.g., "keep youth games before 7:30pm", "align the fall season to the ECNL gap"). Working default model: Claude Sonnet 4.6; use a more capable model for complex solves. Verify current model IDs at build time.
```

**P10 — AI Help Assistant (Anthropic API):**
```
Add an AI HELP ASSISTANT for ALL users, server-side via the Anthropic Claude API. It is role-aware and RBAC-enforced: it can only read/act on data the requesting user is permitted to see. Players/guardians ask about schedules, registration, and balances; refs/coaches ask about assignments and how to submit results; admins can query data and draft announcements. Persist AssistantConversation per user. Never expose the API key client-side. Default model Claude Sonnet 4.6 (verify current ID at build time).
```

**P11 — Engagement & Family Experience:**
```
Add engagement + family experience. Per-user notification preferences across email/push AND SMS/TEXT (SMS is IN SCOPE, via a provider like Twilio), with YOUTH/GUARDIAN messages sent by TEXT as priority cases: waitlist movement, cancellations/rainouts, payment receipts, and schedule changes — reliable and automatic. Add a SUBSTITUTE-REF ALERT (LEAGUES & TOURNAMENTS ONLY — Friday drop-ins are staff-supervised with no refs): when an assigned ref drops/no-shows for a league or tournament fixture, an admin triggers an alert that texts all unscheduled refs asking them to log in and CLAIM the open assignment (first-come); admin sees who claimed it. Automated reminders (upcoming sessions, payment due), results/standings updates, and admin announcements to targeted audiences. Build a FAMILY DASHBOARD: a guardian's home screen showing, in one glance across ALL their children, what the family has this week and what they owe. Add RETURNING-PLAYER RE-ENROLLMENT that pre-fills next season's signup from last season (a couple of taps). Add END-OF-SEASON / END-OF-CAMP YOUTH RECAPS (games played, a coach note, simple positive stats). Add player stats and attendance streaks — but keep YOUTH STATS PRIVATE/POSITIVE; show competitive LEADERBOARDS for ADULTS and OLDER YOUTH only.
```

**P12 — Ops & Compliance:**
```
Add operations + compliance. Court availability calendars with same-court time-conflict prevention across all offerings; weather/cancellation handling with rescheduling workflows that notify affected players; incident/injury reports; insurance tracking; minor-data privacy controls; and an admin view of the AuditLog.
```

**P13 — Memberships (design TBD):**
```
Add MEMBERSHIPS. Define membership tiers with recurring billing via Stripe Subscriptions. Memberships gate or discount offering prices (via the P2 PricingRule member rates) and/or unlock perks. (NOTE: confirm exact tiers, benefits, and billing cadence before building — see OVERVIEW open questions.)
```

**P14 — Growth:**
```
Add growth features. Public browse pages for offerings (registration still requires login). Marketing/landing pages. A referral program. Reporting dashboards for participation, revenue, and retention. Finalize and document the open REST API for the future native app and integrations.
```

**P15 — Native app:**
```
Build a React Native / Expo app consuming the existing REST API, with push notifications. Mirror core player flows: browse, register, pay, view schedule/standings/stats, claim drop-in spots, manage youth players, and use the AI help assistant.
```

---

## 6. Non-Functional Requirements

- **Responsive/mobile-first** — primary usage is phones.
- **Accessibility** — WCAG AA contrast, keyboard nav, large tap targets.
- **Security** — server-side RBAC; no card/bank data stored; signed waivers immutable; minor PII protected; **Anthropic API keys server-side only, never in client code**.
- **Performance** — paginate rosters/standings/brackets; index foreign keys; cache standings.
- **Auditability** — payments, payouts, results, permissions, waivers, **pricing/split edits, and admin overrides** logged with who/when.
- **Reliability** — idempotent Stripe webhooks; prevent same-court time conflicts at the DB level.
- **AI guardrails** — Stage 1 (event suggestions) and Stage 2 (schedule details) are both admin-gated; nothing publishes without admin approval; the help assistant enforces RBAC and never reveals data outside the user's permission scope.
- **Foundation-first** — the delight features (AI, recaps, dashboards, stats) only matter if registration, payment, scheduling, and day-of check-in are *boringly reliable* first. Treat those four as the bar that must be met on the busiest Friday before layering on the rest.
- **Seed data** — demo leagues/camps/sessions/tournaments + sample pricing rules and a facility split for testing each phase.

---

## 7. Confirmed Decisions & Open Questions (mirror of OVERVIEW §10)

**Confirmed:** web-first/native-later; full youth support; hundreds→thousands; replaces spreadsheets; ref/coach payouts via Connect; single location (don't architect against multi); account always required; admins fully control pricing per category + facility split; all automation admin-overridable; **two-stage AI scheduling (suggest events → admin configures/locks → schedule details → admin approves), all offering types**; AI help assistant for all users (RBAC-scoped); AI on the Anthropic Claude API; **per-court drop-in caps (~15–20) with per-pool waitlists**; **youth stats private/positive, leaderboards adults + older youth only**; **experience layer: day-of check-in, refund/credit policy, family dashboard, youth recaps, returning-player re-enrollment**; foundation-first; **facility (Alumni Center) holds insurance, PlayOn captures waivers/clearances**; **pass-through service fee (~3–4%, non-refundable, in-app card only)**; **SMS/text in scope for youth/guardian + sub-ref alert**; **free agents mainly adult-league**; **substitute-ref alert (leagues/tournaments only, first-come claim)**; **Friday drop-ins staff-supervised with NO refs**; **check-in across all event types via QR scan (primary) + manual fallback — drop-ins per court pool, camps per day, leagues PLAYER-level with roster-eligibility + game-day add-player, tournaments TEAM self-check-in the day before via app/web**; **Fridays are the first thing to get production-ready (build broad, no thin MVP, Fridays first in sequence)**; **leagues & tournaments require a DEPOSIT (balance due on/before first game, play blocked if unpaid, admin-overridable)**; **waivers required for EVERYONE (youth + adult; youth adds guardian sig + media consent)**; **ONE durable QR code per person (their PlayOn ID) across all events**; **third living doc PLAYON_FUTURE_FEATURES.md (roadmap/parking lot) maintained alongside these**.

**Open:** membership tiers/benefits/cadence (TBD); Alumni Center facility terms; Stripe confirmation at setup; service fee on external/cash (defaulted off); account-credit expiry default; exact required waivers/clearances (facility + attorney); promotion-relegation include-or-skip (defaulted optional); AI model choice (Sonnet 4.6 default, Opus for heavy solves) — verify current model IDs at build time.

**Open:** membership tiers/benefits/cadence (TBD); facility-split shape vs. real agreements; Stripe confirmation at setup; SMS provider/scope; promotion-relegation include-or-skip (defaulted optional); AI model choice (Sonnet 4.6 default, Opus for heavy solves) — verify current model IDs at build time.

---

## 8. Changelog

| Version | Date | Change |
|---|---|---|
| 0.8.0 | 2026-05-26 | DEPOSITS for leagues/tournaments (deposit holds spot; balance due on/before first game; play blocked if unpaid, admin-overridable) -> PAYMENTS IN + P5/P6/P7 + Payment entity. WAIVERS now universal (youth + adult; youth adds guardian sig + media consent) -> YOUTH&COMPLIANCE block, camp behavior, P3/P4 + add-player flows + Waiver entity. QR now ONE durable code PER PERSON (PlayOn ID) across all events -> QRCode entity + CHECK-IN block. Master Prompt BUILD ORDER now directs creating/maintaining PLAYON_FUTURE_FEATURES.md (roadmap). Updated decisions mirror + companion-file refs. |
| 0.7.2 | 2026-05-26 | Check-in upgraded to QR-scan primary (per player + per team) with manual fallback; QR generation added to P1; QRCode entity added. Leagues -> PLAYER-level check-in with roster-eligibility verification + quick game-day add-player (P5). Tournaments -> TEAM self-check-in the DAY BEFORE via app/web (P6). Updated CHECK-IN block, CheckIn entity, P3, decisions mirror. Build broad (no thin MVP), Fridays first. |
| 0.7.1 | 2026-05-26 | Friday drop-ins clarified as STAFF-SUPERVISED with NO refs; substitute-ref alert scoped to leagues/tournaments only. Added a CHECK-IN block (Master Prompt) + CheckIn entity covering all event types: drop-ins (two court pools, pull from waitlist), camps (per-day), leagues (per-fixture team confirm/forfeit), tournaments (team-level day-start). Updated P3/P5/P6/P11 prompts + decisions mirror. |
| 0.7.0 | 2026-05-26 | Added pass-through SERVICE FEE (~3-4%, non-refundable, in-app card only) + refund-fee handling (Stripe keeps fee on refunds) + account-credit expiry to PAYMENTS IN/P7. Facility holds insurance (PlayOn captures waivers/clearances). Free-agent handling -> P5 (mainly adult). SMS/text confirmed in scope + SUBSTITUTE-REF ALERT (texts unscheduled refs to claim open assignment) -> P11. New entities ServiceFeeConfig/RefundCreditPolicy/AccountCredit/SubRefAlert. Updated decisions mirror + open questions. |
| 0.6.0 | 2026-05-26 | Two-stage admin-gated AI scheduling: Stage 1 EventSuggestion (AI suggests pre-filled events) -> admin verifies/configures/locks -> Stage 2 ScheduleProposal (AI schedules details within locked event) -> admin approves; all offering types. Added EventSuggestion entity; rewrote P9 + Master Prompt AI block. Integrated experience recommendations into phases: day-of check-in/front-desk (P3/P4), configurable refund/credit policy (P7), family dashboard + youth recaps + returning-player re-enrollment + youth-priority notifications + youth-stats-privacy (P11 renamed Engagement & Family Experience). Added foundation-first NFR. Updated decisions mirror. |
| 0.5.1 | 2026-05-26 | Per-court drop-in capacity caps (admin-editable, default ~15-20) with independent per-pool waitlists. Updated RSVP/Spot entity + P3 prompt; reinforced admin override of caps/waitlists. |
| 0.5.0 | 2026-05-26 | Major scheduling-logic addition. Admin-managed court pool (availableForScheduling flag, add/remove courts). New SCHEDULING RULES block in Master Prompt: youth-first via Fayette County Schools calendar; fixed Friday bands (8-11 small + 12-15 full concurrently 5:30-7:30, adults both 7:30-9:30); age-group->court/format mappings; KSSL/KPL/ECNL alignment hints; adult leagues year-round; hybrid external-calendar (fetch + admin-confirm, no scheduling on unconfirmed dates); offering-mix-by-age. New entities AgeGroup/RecurringScheduleRule/ExternalCalendar + Court.availableForScheduling. Updated P1 (age groups + court pool), P9 (rules + calendar ingestion), Master Prompt AI scheduling + BUILD ORDER. |
| 0.4.3 | 2026-05-26 | Clarified Alumni Center is a larger multi-court facility; PlayOn manages two DEDICATED courts within it. Updated Venue entity + FACILITY block + P1/BUILD ORDER wording. |
| 0.4.2 | 2026-05-26 | Operating model fix: venue = Alumni Center, Lexington KY; PlayOn operates all events; NO user court booking (courts are internal admin-scheduled resources, players sign up for offerings only). Court entity + FACILITY block + P1 + AI scheduling (Master + P9) reworded; "double-booking" reframed as same-court time-conflict prevention in P5/P12/NFRs. |
| 0.4.1 | 2026-05-26 | Specified two courts: Court (format full_5v5_goalies | small_sided, smallSidedMode 4v4/3v3 per booking) as independent bookable resources with PER-COURT double-booking. Added FACILITY & COURTS block to Master Prompt; updated AI scheduling (both courts, flexible assignment) in Master Prompt + P9; updated P1 to seed venue + both courts. |
| 0.4.0 | 2026-05-26 | Added Pricing & Admin Core phase (P2): admin-editable per-category PricingRule + FacilitySplitRule (percentage/flat/hybrid) + revenue computation + global admin override console. Added AI Scheduling (P9, proposes→admin approves, considers court/time/season) and AI Help Assistant (P10, RBAC-scoped, all users) on the Anthropic Claude API. Renumbered to 15 phases. Added architecture principles for pricing, admin override, and AI; updated Master Prompt, data model, NFRs, decisions. |
| 0.3.0 | 2026-05-26 | Expanded to complete 12-phase plan + future multi-location. Added architecture principles, payouts (Connect), full payments-in, memberships, engagement, ops/compliance, growth, native. Master Prompt now encodes the full data model + principles; added scoped prompts P7–P12. |
| 0.2.0 | 2026-05-26 | Defaulted decisions confirmed. |
| 0.1.0 | 2026-05-26 | Initial: stack, 7-phase plan, Master Prompt, scoped prompts, theme, NFRs. |
