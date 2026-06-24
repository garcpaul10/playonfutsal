# PlayOn — Business Overview

> **Living document.** This is the single source of truth for what PlayOn is and how it operates. Update it whenever the business changes, then mirror relevant changes into `PLAYON_REPLIT_PROMPT.md`.

| | |
|---|---|
| **Document** | PlayOn Business Overview |
| **Version** | 0.8.0 |
| **Last updated** | 2026-05-26 |
| **Owner** | PlayOn (founder/admin) |
| **Companion file** | `PLAYON_REPLIT_PROMPT.md`, `PLAYON_FUTURE_FEATURES.md` |

---

## 1. What PlayOn Is

PlayOn is a **futsal brand** running organized futsal programming for **youth** and **adult** players, operating out of the **Alumni Center in Lexington, KY** (a larger multi-court facility, where PlayOn runs futsal on **two dedicated courts**). PlayOn is the **administrator/operator** of all PlayOn events there — players and teams sign up through the system; they do not book courts or facilities themselves. It encompasses four core offerings:

1. **Leagues** — recurring, season-based competition with standings, fixtures, playoffs.
2. **Camps** — multi-day skill/development programs, primarily youth-focused.
3. **Drop-in sessions** — casual, single-session pay-to-play games with limited spots.
4. **Tournaments** — bracketed, often single-weekend competitive events.

The management system runs **all four offerings**, for **both age groups**, from **one platform** — including collecting money from players and **paying out** refs and coaches.

**Scope principle:** the *plan* is complete now; the *build* is phased. Architecture decisions account for everything below even when a feature ships later.

---

## 2. Offerings — How Each One Operates

**Offering mix by audience:**
- **Camps** — primarily **youth**.
- **Leagues** — both **youth and adults** (adult leagues run year-round).
- **Tournaments** — both **youth and adults**.
- **Drop-ins** — both, via the Friday age-banded structure (see §2.6).

In short: youth get the full range (camps, leagues, tournaments, drop-ins); adults are primarily leagues and tournaments, plus the Friday adult drop-in band.

### 2.1 Leagues
- Organized into **seasons** (e.g., Spring 2026 Adult Coed).
- Players join via **teams**; **free agents** (players without a team) can register individually and be placed onto teams. This is mainly an **adult-league** need (youth rarely sign up team-less); admins can form/balance teams from the free-agent pool or assign individuals to teams that need players.
- A season has **divisions/tiers** (by age, skill, or competitiveness).
- A **schedule of fixtures** (matchups, dates, times, venues/courts, assigned ref).
- Each fixture produces a **result** feeding **standings** (W/L/D, points, goal differential, goals for/against).
- **Tiebreakers** are configurable (head-to-head, goal diff, etc.).
- Supports **forfeits**, **playoffs/finals**, and optionally **promotion/relegation** between tiers.
- **Refs** assigned per fixture record/confirm results.

### 2.2 Camps
- Defined by a **date range**, **age group**, **capacity**, **price**.
- May contain **multiple sessions/days** with **daily check-in/attendance**.
- Players (or guardians for youth) **register** → **camp roster**.
- **Coaches** assigned to camps.
- Supports **capacity tiers**, **early-bird pricing**, and **late fees**.
- Youth camps require **waivers/consent** and **guardian** linkage (see §4).

### 2.3 Drop-in Sessions
- A **single dated session** with a **per-court spot capacity** and **price**.
- **Per-court caps:** each active court in a session has its own capacity (admin-editable, **default ~15–20 players per court**). A Friday session running both courts therefore holds two independent pools (e.g., 8–11 on the small court, 12–15 on the full court), each capped separately.
- When a court's pool is **full**, additional players join that court's **waitlist** (positions tracked); cancellations/no-shows auto-promote the next person.
- Can be generated from **recurring session templates** (e.g., the Friday bands).
- **Skill-level** and **age-group** filtering so players find the right session.
- **Cancellation window** (configurable) auto-promotes the next waitlisted player and notifies them.
- **No-show tracking** and attendance.
- **Admins retain full control:** they can change any court's cap on the fly (e.g., open more spots), manually add/move players between the active list and waitlist, or close a pool early.
- **Supervised, not officiated:** a PlayOn or Alumni Center **staff member supervises** and runs check-in; **no refs** on drop-in nights.
- Lightweight: no standings or brackets.

### 2.4 Tournaments
- A **bracketed event**: single elimination, double elimination, or **group stage → knockout**.
- Teams **register** with a **roster**.
- **Seeding** (manual or from group-stage results).
- System generates and progresses the **bracket** as results come in.
- Supports **consolation brackets** and configurable **tiebreakers**.
- Refs record results.

### 2.5 Facility & Courts

PlayOn is the **operator/administrator of all PlayOn events** at the **Alumni Center in Lexington, KY**. The Alumni Center is a larger multi-court facility; PlayOn has **dedicated two of its courts** to this futsal offering. PlayOn runs the programming — **players and teams sign up for offerings, they do not book or reserve courts.** Court usage is decided entirely by **admins** (with AI assistance); the court is an internal scheduling resource, never exposed to users as a reservable item.

PlayOn's **two dedicated courts** can both be in use simultaneously, so PlayOn can run two offerings at the same time.

| Court | Format | Notes |
|---|---|---|
| **Court 1 — Full court** | **5v5 futsal** | Larger goals, **goalkeepers allowed**. Used for full-sided leagues, tournaments, adult play, etc. |
| **Court 2 — Small court** | **4v4 or 3v3 futsal** | Smaller space; format (4v4 vs 3v3) is set by the admin **per event/session**. No dedicated goalies (small-sided). Used for small-sided games, youth, skills, casual drop-ins, etc. |

- **No user bookings.** Individuals cannot reserve court time. Players/teams register for **offerings**; admins assign each session/fixture to a court.
- **Admin-managed court pool:** admins can **add or remove courts** from the set the AI is allowed to schedule on (each court has an `availableForScheduling` flag). The AI only schedules across **currently active** courts — so the two dedicated courts today can become three+ or drop to one without code changes.
- **Admin-decided, AI-assisted court assignment:** the AI scheduler proposes which court each session/fixture goes on; the **admin decides and can override**. No offering is locked to a court (fully flexible).
- Each court is an **independent scheduling resource** — the system prevents two things being assigned to the **same court at the same time** (an internal conflict guardrail, not user-facing booking), while allowing all active courts to run concurrently.
- A session/fixture on Court 2 records which **format** (4v4 or 3v3) it's using.
- Court format/capacity feeds the **AI scheduler** (it knows the full court fits 5v5 with goalies and the small court runs 4v4/3v3).

### 2.6 Scheduling Rules & Age Groups

These are the operating rules the AI scheduler follows. All are **admin-editable**; the AI proposes, the admin approves.

**Youth is the determining factor.** For *every* event type, youth availability is the primary scheduling constraint. Youth availability is driven by the **Fayette County Public Schools** calendar — when school is in or out determines youth timing (e.g., school-night curfews, breaks, summer availability). Adults flex around youth.

**Friday drop-in (the anchor recurring session):**

| Time band | Group | Court / format |
|---|---|---|
| **5:30–7:30pm** | Youth **8–11** | Small court — 3v3 / 4v4 |
| **5:30–7:30pm** | Youth **12–15** | Full court — 5v5 |
| **7:30–9:30pm** | Adults | Both courts available |

- The two youth groups run **concurrently** (one per court) in the 5:30–7:30 band; both courts then open to **adults** at 7:30–9:30.
- Fixed time bands (not dynamically calculated).
- **Supervision, not officiating:** Friday drop-ins are **casual play supervised by a PlayOn or Alumni Center staff member — there are no refs.** Refs are only for competitive results (leagues and tournaments). The Friday staff member runs check-in and supervises; they don't officiate or record results.

**Season alignment hints (not blackouts):** the AI uses **KSSL**, **KPL**, and **ECNL** schedules as *alignment hints* to time PlayOn seasons effectively (e.g., slot offerings into gaps in the broader youth-soccer calendar). These are guidance, not hard date-conflict constraints.

**Adult cadence:** **adult leagues run year-round**, independent of the school calendar.

**External calendar data (hybrid model):** the system fetches public calendars where available (Fayette County schools especially) and **admins confirm/fill gaps each season**. The AI **never schedules on unconfirmed dates** — confirmed calendar data is a prerequisite for a schedule proposal.

---

## 3. Roles & Who Uses the System

> **Confirmed:** Admins + Players + Refs/Coaches. **Account always required** to register/pay (no guest checkout); public pages allow browsing only.

| Role | What they do |
|---|---|
| **Admin / Staff** | Full control, with **permission tiers** (e.g., super-admin vs. limited staff). Manages offerings, teams, venues, schedules, rosters, payments, payouts, reports. |
| **Player** | Registers for offerings, joins teams, claims drop-in spots, views schedule/standings/stats, pays, signs waivers, manages notification preferences. |
| **Parent/Guardian** | A player-type account managing one or more **youth** player profiles: registers them, signs waivers, pays. |
| **Ref** | Assigned to fixtures/tournaments; records/confirms results; has **availability**; is **paid out** for assignments. |
| **Coach** | Assigned to teams/camps; views rosters/schedules; holds **certifications & background-check status**; may be **paid out**. |
| **Team Captain** *(optional)* | A player with rights to manage their team's roster and register the team for events. |

---

## 4. Waivers, Youth Handling & Compliance

- **Waivers are required for EVERYONE — youth and adults alike.** Every player signs a **digital, versioned waiver** (which version was signed, by whom, when) before they can play. For youth, the **guardian signs** on the child's behalf.
- Every player/program is tagged **youth** or **adult** (configurable age groups: U8, U10, U12, U14, adult coed/men's/women's).
- **Youth** programs require, on top of the universal waiver:
  - **Guardian accounts** managing **multiple children**.
  - **Photo/media consent** capture.
  - Coach **background-check status** tracking and **certifications**.
- **Age-eligibility verification** at registration (player's age group must match offering).
- **Data privacy for minors** — minimize and protect youth PII; guardian controls youth data.
- **Incident/injury reports** and **insurance tracking** for operational/legal coverage (facility holds the insurance — see §5).
- **Audit logs** for sensitive changes (payments, results, waivers, permissions).

---

## 5. Money & Payments

> **Confirmed:** Mixed in-app + external payments; PlayOn pays refs/coaches out; **admins fully control pricing per category and the facility revenue split.**

### Pricing engine (per category)
Each offering category prices differently. Pricing lives in a dedicated, **admin-editable** layer — not a single hardcoded field — so admins can change prices anytime without a developer.

| Category | Pricing basis | Admin-configurable factors |
|---|---|---|
| **Drop-ins** | Per session (per player) | Base price, per skill-tier price, member price, drop-in pack/bundle |
| **Camps** | Per camp or per day | Base price, early-bird price + cutoff date, late fee, sibling/family discount, deposit vs. full |
| **Leagues** | Per team and/or per player, per season | Team fee, individual/free-agent fee, member price, installment plan, **deposit + balance-due date** |
| **Tournaments** | Per team entry (optionally per player) | Entry fee, early-bird, member price, **deposit + balance-due date** |

- All prices, discounts, fees, and member rates are set and edited by **admins** through the UI.
- Pricing changes are **versioned/audited** (who changed what, when) and apply to future registrations, not retroactively.

### Facility revenue split
- Each **venue** (and optionally each offering) has a **split rule** with the facility. Configurable types:
  - **Percentage** — facility takes X% of revenue.
  - **Flat fee** — facility charges a fixed court-rental fee (per hour/session/event).
  - **Hybrid** — flat fee + percentage, or a guarantee-plus-split.
- The system computes **gross revenue, facility cut, and PlayOn net** for every offering and shows it in reporting.
- Admins create/edit split rules; rules are versioned/audited.

> **Note:** split rules are per-venue with optional per-offering override, supporting flat/percentage/hybrid. Confirm exact terms against your actual Alumni Center agreement.

### Insurance & liability
- **The Alumni Center (facility) holds the insurance.** PlayOn is the program operator; the facility carries the liability coverage for play on the courts.
- The system still captures **signed liability waivers** per registration (youth especially) and tracks **coach clearance/background-check expiry** (see §4), since those support the facility's coverage and PlayOn's duty of care regardless of who insures.
- *(Confirm with the facility/an attorney exactly what PlayOn must collect — the system is built to store whatever waivers/clearances are required.)*

### Service fee (pass-through processing cost)
- PlayOn charges a **service fee** on **in-app card payments** to cover Stripe's processing cost (Stripe = ~2.9% + $0.30/transaction; effective rate a bit over 3% on small amounts).
- Implemented as a **clearly-labeled, admin-editable service fee** (default ~3–4%) shown at checkout — legal in most US states when disclosed clearly. Familiar to families (like Eventbrite/ticketing fees), and common for seasonal camps/classes.
- **Applies to in-app card payments only** by default (no card cost on cash/Venmo) — admin can change this. *(Assumption — confirm.)*

### Collecting (money in)
- **In-app payment** via Stripe Checkout for registration/spots/camp/tournament fees (+ service fee above).
- **External/offline** (cash, Venmo, invoice): admins mark **"paid externally"** with method/amount.
- Every registration/RSVP carries **payment status**: `unpaid | paid_inapp | paid_external | refunded | waived/comp`.
- **Refunds & credits**, **discount/promo codes**, **family/sibling discounts**, **early-bird & late fees**, and **installment/payment plans**.
- **Deposits (leagues & tournaments):** a **deposit holds the spot** at registration; the **balance is due on or before the team's first game**. The system tracks the outstanding balance, shows it on the family/team view, sends reminders, and **flags/blocks a team from playing if the balance isn't paid by the first fixture** (admin-overridable). Deposit amount and the balance-due rule are admin-editable per offering.
- **Refund-fee handling:** Stripe does **not** return its processing fee on refunds, so the **service fee is non-refundable** (it covered a cost already incurred); refunds apply to the program fee per the refund policy. Account credits' expiry is set by policy (see §8 ops).

### Memberships *(wanted; mechanism TBD — see §7)*
- A **membership/subscription** concept that can gate or discount pricing and/or unlock perks.
- Architecture supports recurring billing; exact tiers/benefits are an **open design question**.

### Paying out (money out)
- **Refs and coaches are paid through the system** (planned via **Stripe Connect** connected accounts).
- Track **amount owed per assignment**, payout status, and history.
- Staff onboard as connected accounts before they can be paid.

### Reporting
- Admin **financial dashboard**: who's paid, who owes, totals per offering, refunds, **payouts owed/paid**, reconciliation.

> **Never store raw card data** — all card handling is delegated to Stripe; users enter card details with Stripe directly.

---

## 6. Admin Control

> **Confirmed:** Admins have **complete control of the system** and can change anything within it.

- Admins can create, edit, and remove every entity: offerings, pricing, splits, teams, players, venues/courts, schedules, fixtures, rosters, brackets, waivers, discounts, memberships, notifications, and user roles/permissions.
- **Manual override everywhere:** anything the system automates (scheduling, waitlist promotion, standings, bracket progression, pricing) can be **manually overridden** by an admin.
- **Permission tiers** let a super-admin grant limited staff scoped access (e.g., a venue manager who only manages schedules).
- All admin changes to sensitive data are written to the **AuditLog**.

## 7. AI Features

> **Confirmed:** AI for automatic scheduling (field space, time, season, and more) **and** a helpful assistant for all users.

### AI scheduling assistant (admin-facing) — two-stage, admin-gated

The AI works in **two stages with an admin gate between them**. The AI never invents an event into existence, and detailed scheduling only happens inside parameters an admin has already locked.

**Stage 1 — AI suggests *what & when* (event-level).** The AI surveys the landscape (youth/school timing, season-alignment hints, what's already running, seasonal demand) and proposes **which events should happen and roughly when** — e.g., "start a U10 spring league mid-March," "run a youth camp over fall break," or for drop-ins, "demand is high — add a second Friday session." It does **not** schedule anything yet; it recommends events to exist, each **pre-filled with suggested settings** (proposed age group, court(s), format, fee from the pricing rules, capacity, duration).

**Admin gate — verify & configure.** For each suggested event the admin **accepts or rejects** it, then **toggles the pre-filled details on/off and adjusts** them (age group, court(s), format, fees, capacity, days, duration) until the event is configured correctly, and **locks** it. Nothing proceeds without this step.

**Stage 2 — AI schedules *the details* (within the locked event).** Only now does the AI do the heavy lifting *inside the admin's configured constraints* — generating the actual fixtures, court assignments, time slots, and matchups. It follows the operating rules in **§2.6**:
  - **Youth-first:** youth availability (driven by the **Fayette County Public Schools** calendar) is the primary constraint for *all* events; adults flex around it.
  - **Active court pool:** schedules only across courts currently flagged available.
  - **Court/format fit:** full court = 5v5 with goalies; small court = 4v4/3v3.
  - **Fixed Friday drop-in bands:** youth 8–11 (small) and 12–15 (full) concurrently 5:30–7:30; adults both courts 7:30–9:30.
  - **Season-alignment hints:** KSSL, KPL, ECNL (hints, not blackouts).
  - **Adult leagues year-round**; season of the year, preferred windows, and team/ref constraints (avoid back-to-backs, balance home/away, ref availability).

**Both stages are proposals the admin approves**, and the **Stage-2 schedule is still reviewed and confirmed** before publishing. This two-stage flow applies to **all four offering types** (drop-ins mainly get Stage-1 demand suggestions since their structure is templated).

- **Confirmed calendar data required:** the AI won't propose dates that depend on unconfirmed external calendars (hybrid fetch + admin confirmation — see §2.6).
- Admins can ask for **re-optimization** at Stage 2 ("spread games over more weekends," "keep youth games before 7:30pm") in natural language.

### AI help assistant (all users)
- A built-in assistant that helps **every role** with relevant, role-aware answers:
  - **Players/guardians:** "When's my next game?", "How do I register my kid for camp?", "What do I owe?"
  - **Refs/coaches:** "What are my assignments this week?", "How do I submit a result?"
  - **Admins:** "Show unpaid registrations for the spring league," "Draft an announcement about a rainout."
- The assistant only surfaces data the user is **permitted** to see (respects RBAC).

### Provider
- Built on the **Anthropic Claude API**. Working default model: **Claude Sonnet 4.6** (strong reasoning at lower cost) for the assistant; scheduling optimization may use a more capable model (e.g., Claude Opus) for complex constraint-solving. Model IDs rotate — verify current IDs at the Anthropic docs at build time.
- AI is an **assistive layer**, not an authority: it suggests, the human (admin or user) decides.

## 8. Engagement, Operations & Growth

**Engagement & retention**
- **Notifications** (email / **SMS (text)** / push) with per-user **preferences**. **SMS is in scope** — parents read texts, not app inboxes — so **youth/guardian messages go by text**: waitlist movement, cancellations/rainouts, payment receipts, and schedule changes. (Requires an SMS provider, e.g. Twilio.)
- **Automated reminders** (upcoming session, payment due), **waitlist-promotion alerts**, **results/standings** updates, **announcements**.
- **Player stats** and **attendance streaks**. **Youth stats stay private/positive** (participation, recaps); **competitive leaderboards are for adults and older youth only** (see decision in §10).
- **End-of-season / end-of-camp recaps for youth** (games played, a coach note, simple positive stats) — parents value these and they drive re-registration.

**Operations**
- **Venue & court management**, **court availability calendars**, **court-conflict prevention** (no two events on one court at once), **recurring schedule generation**, **weather/cancellation** handling, **rescheduling** workflows.
- **Day-of check-in / front-desk view** — a fast, first-class screen for running events smoothly. How it works per event type is detailed in **§8a Check-In** below. *This is a make-or-break operational feature, not an afterthought.*
- **Built-in refund & credit policy** — configurable rules (e.g., weather cancellation → automatic account credit; drop >48h before camp → X% refund) so cancellations are handled consistently and the rules are clear to families upfront, rather than improvised case-by-case. **Account credits can have a configurable expiry**; the **service fee is non-refundable** (see §5).
- **Substitute-ref alert (leagues & tournaments only)** — refs are used for competitive results, **not** for Friday drop-ins (those are staff-supervised). When an assigned ref drops/no-shows for a **league or tournament** fixture, an admin can trigger an alert that **texts all unscheduled refs** asking them to log in and **claim the open assignment** on a first-come basis; the admin sees who claimed it.

**Family experience**
- **Family dashboard** — since one guardian may have multiple children across different programs, the guardian's home screen answers "what does my family have this week, and what do I owe?" in one glance, across all children. Get this right and PlayOn becomes indispensable to busy families.
- **Returning-player re-enrollment** — next season's signup pre-fills from last season so re-registering is a couple of taps, not a fresh form.

**Growth & business**
- **Public-facing pages** to browse offerings (registration still requires an account).
- **Marketing/landing pages**, **referral program**.
- **Reporting dashboards** (participation, revenue, retention).
- **Open API** to power the future native app and integrations.
- **Multi-location**: NOT built now (single location — the Alumni Center, Lexington KY), but the data model **must not block** a future expansion.

> **Foundation-first principle:** these delight features only matter if registration, payment, scheduling, and day-of check-in are *boringly reliable* first. Build the core to the point you'd trust it on the busiest Friday, then layer the rest on top.

---

## 8a. Check-In (all event types)

Check-in is the front-desk tool whoever is running an event uses to know who's here, who's paid, and who's missing. It's deliberately simple — usable on a phone or tablet by a staff member, coach, ref, or admin. The core is the same everywhere; the details differ by event type.

**QR codes are the primary fast-path — one code per person, like an ID.** Each player has **a single durable QR code** in the app/web that serves as their PlayOn ID and works for **every event they ever register for** — no juggling separate codes per program. The ref, admin, or staffer **scans it to check the person in instantly** and sees their identity, today's check-in, and payment/waiver status. Teams also get a code for team-level (tournament) check-in. Manual **search-and-tap is always available as a fallback** (dead phone, code won't scan, walk-ins). QR also supports optional **self-check-in** at a kiosk.

**Universal behaviors (every event):**
- A **roster/attendee list** for the specific day, each person markable **Present / Not yet / No-show** (by QR scan or tap).
- **Payment status at a glance** next to each name (`paid` / `owes`) — collect or flag a balance; mark a cash/external payment on the spot.
- **Waiver/consent check** for youth — a clear flag if a required waiver isn't signed, handled before play.
- **Search/quick-find** by name, and a **running count** (present vs expected) per court/group/team.
- Everything is **admin-overridable** (add a walk-in, move someone, reopen a closed list); all check-in actions are timestamped in the audit log.

**Drop-ins (Friday):** A **PlayOn or Alumni Center staff member** (no ref) opens the session and sees the **two court pools separately** — 8–11 on the small court, 12–15 on the full court, then adults at 7:30. Players scan in (or are tapped in) as they arrive; **no-shows free a spot, and the next waitlisted player can be pulled in** right there (they get a text). The staff member supervises play; nothing competitive is recorded.

**Camps (multi-day):** Check-in runs **per day** against the camp roster (scan or tap), giving daily attendance across the camp's run. Same paid/owes and waiver flags; useful for knowing which campers attended which days. A coach or admin runs it.

**Leagues (PLAYER-level, per fixture):** League check-in is **player-level**, because roster integrity matters — the system **verifies the right players are checked in for the correct team** (no ringers, no ineligible players). The ref or admin scans each player's QR (or taps) against that team's roster; mismatches/ineligible players are flagged. A **quick "add player" flow** lets a team register a new player who showed up that day (create/attach to the roster on the spot, capture waiver if youth), so game-day additions aren't blocked. Forfeit can be noted if a team can't field enough eligible players; results recorded after the match.

**Tournaments (TEAM self-check-in, day BEFORE):** To keep event day calm, **team check-in happens the day before** and teams can **check in themselves through the app/web** (captain confirms the team and roster). Admins see who's confirmed ahead of time and chase stragglers before brackets are set, so no-shows are handled *before* event day rather than during it. On event day, any remaining confirmations/roster checks are a quick QR scan.

> The common thread: whoever's running it always knows **who's here, who owes, and whether youth waivers are signed** — fast, via QR, without a spreadsheet or a phone call.

---

## 9. Core Concepts / Data Model (Plain English)

The "nouns" the system revolves around; the prompt translates these into a schema.

- **User** — anyone with a login (one or more roles; permission tier for staff).
- **Player Profile** — a person who plays (linked to a User, or managed by a guardian). Age group, youth/adult flag, stats/history.
- **Guardian Link** — parent User → one or more youth Player Profiles.
- **Staff/Ref/Coach Profile** — certifications, background-check status, availability, payout (Connect) account.
- **Team** — named group of players; belongs to leagues/tournaments; optional captain.
- **Venue** — the facility PlayOn operates in: the **Alumni Center, Lexington, KY**, a larger multi-court building where PlayOn uses **two dedicated courts** (single location now).
- **Court** — a court within the venue, with a **format/type** (full 5v5-with-goalies, or small-sided 4v4/3v3), an **availableForScheduling** flag (admins add/remove courts from the AI's pool), and availability. The small court records 4v4 vs 3v3 per session. Courts are **admin-scheduled internal resources** — not user-bookable.
- **AgeGroup** — a configurable band (e.g., 8–11, 12–15, adult) mapped to default court/format and time bands.
- **RecurringScheduleRule** — admin-editable recurring pattern (e.g., the Friday drop-in: youth 8–11 small court + 12–15 full court 5:30–7:30, adults both courts 7:30–9:30).
- **ExternalCalendar** — imported/fetched dates (Fayette County Schools = hard youth-availability input; KSSL/KPL/ECNL = season-alignment hints), each with a **confirmed** flag set by an admin.
- **Offering** — umbrella for the four products; type `league | camp | dropin | tournament`; age group, price, status, public/visible flag.
- **Season** (leagues) — time-bounded container with divisions, tiebreaker rules, playoff config.
- **Session Template** (drop-ins) — recurring pattern generating sessions.
- **Fixture / Match** — scheduled game (teams, datetime, venue/court, ref, result).
- **Standing** — computed from fixture results.
- **Bracket** (tournaments) — elimination/group structure + consolation.
- **Registration** — player/team → offering (payment status + waiver status + applied discounts).
- **RSVP / Spot** (drop-ins) — claimed place in a specific **court pool** within a session + waitlist position + no-show flag. Each court pool has its own admin-editable capacity (default ~15–20).
- **CheckIn** — an attendance record (who, which event/day/court pool/team, present/no-show, timestamp, who checked them in, method: QR or manual); surfaces payment + waiver status. Player-level for drop-ins/camps/leagues; team-level (self-service, day-before) for tournaments.
- **QRCode** — **one durable code per person** (their PlayOn ID), not per registration. It works across **every event they're registered for** — drop-ins, camps, leagues, tournaments — so a player keeps a single code forever. Scanning it pulls up who they are, what they're checked into today, and their payment + waiver status. Teams also get a code for team-level (tournament) check-in. Manual search/tap is the fallback.
- **Waiver** — versioned signed consent tied to a player, **required for ALL players (youth + adult)**; for youth the guardian signs. No play without a signed current-version waiver.
- **Payment** — money-in record (amount, method, status, discounts, linked registration), including **deposit vs. balance** for leagues/tournaments (deposit paid, balance amount, balance-due date = first game).
- **Payout** — money-out record (staff member, assignment, amount, status).
- **PricingRule** — per-category, admin-editable pricing (base, tiers, early-bird/late, member rate, installments); versioned.
- **FacilitySplitRule** — per-venue (optional per-offering) split: percentage, flat fee, or hybrid; versioned.
- **RevenueRecord** — computed gross / facility cut / PlayOn net per offering.
- **Membership** — subscription tier a User may hold (gates pricing/perks).
- **DiscountCode / Promo** — code, type, eligibility, expiry.
- **ServiceFeeConfig** — admin-editable pass-through fee on in-app card payments (default ~3–4%, non-refundable).
- **RefundCreditPolicy** — admin-defined refund/credit rules (e.g., weather → credit; drop >48h → X% refund); credits may have an expiry.
- **AccountCredit** — a credit balance on a User's account, usable toward future registrations, with optional expiry.
- **SubRefAlert** — an admin-triggered alert texting unscheduled refs to claim an open assignment (first-come), with claim tracking.
- **Notification / Announcement** — message + channel + audience.
- **Assignment** — ref/coach attached to a fixture/team/camp/tournament (drives payout).
- **IncidentReport** — injury/incident record.
- **AuditLog** — who changed what, when (incl. all admin overrides + pricing/split edits).
- **EventSuggestion** — a Stage-1 AI proposal for an event to exist (suggested type, timing, and pre-filled settings); admin accepts/rejects, toggles/adjusts details, and locks it into a configured Offering.
- **ScheduleProposal** — a Stage-2 AI-generated draft schedule (fixtures, courts, times) *within a configured/locked event*, pending admin review/approval.
- **AssistantConversation** — a user's role-scoped chat with the AI help assistant.

---

## 10. Confirmed Decisions & Open Items

**Confirmed (2026-05-26):**
1. Responsive **web app first**; **native app** Phase 2. ✅
2. Full **youth support** (guardians, versioned waivers, coach background-check + certifications). ✅
3. **Hundreds now → thousands** scaling target. ✅
4. **Replaces spreadsheets**; no migration at launch. ✅
5. **Refs/coaches paid out through the system** (Stripe Connect). ✅
6. **Single location** now; do **not** architect against future multi-location. ✅
7. **Account always required** to register/pay; public browse only. ✅
8. **Admins fully control pricing per category + facility split**; all automation is admin-overridable. ✅
9. **AI scheduling proposes, admin approves** (no auto-publish). ✅
10. **AI help assistant for all users**, role-scoped to permitted data. ✅
11. AI built on the **Anthropic Claude API**. ✅
12. **Two-stage AI scheduling:** Stage 1 AI suggests *events* (pre-filled) → admin verifies/configures/locks → Stage 2 AI schedules *details* within that config → admin approves. Applies to all four offering types. ✅
13. **Per-court drop-in caps** (admin-editable, default ~15–20) with an independent waitlist per court pool. ✅
14. **Youth stats stay private/positive; competitive leaderboards are adults + older youth only.** ✅
15. **Build the experience layer:** day-of check-in, refund/credit policy, family dashboard, youth recaps, returning-player re-enrollment, youth-priority notifications. ✅
16. **Facility (Alumni Center) holds the insurance**; PlayOn still captures waivers + coach clearances. ✅
17. **Service fee** (~3–4%, admin-editable) on in-app card payments to cover Stripe cost; **non-refundable**; in-app card payments only by default. ✅
18. **SMS (text) is in scope** for youth/guardian messages and the sub-ref alert (provider e.g. Twilio). ✅
19. **Free-agent handling is mainly an adult-league need**; admins form/balance teams from the free-agent pool. ✅
20. **Substitute-ref alert (leagues & tournaments only):** texts unscheduled refs to claim an open assignment (first-come). ✅
21. **Friday drop-ins are staff-supervised, NO refs** (PlayOn or Alumni Center staff runs check-in + supervises). Refs are only for league/tournament results. ✅
22. **Check-in works across all event types** via **QR scan (primary) + manual fallback**: drop-ins per court pool; camps per day; **leagues PLAYER-level with roster-eligibility verification + quick game-day add-player**; **tournaments TEAM self-check-in the day BEFORE** (via app/web). ✅
23. **Fridays are the first thing to get production-ready**; the rest of the system follows (no thin MVP — build broad, Fridays first in sequence). ✅
24. **Leagues & tournaments require a deposit** to hold the spot; **full balance due on or before the first game** (tracked, reminded, play blocked if unpaid — admin-overridable). ✅
25. **Waivers required for EVERYONE** (youth + adult); youth adds guardian signature + media consent on top. ✅
26. **One durable QR code per person** (their PlayOn ID) works across all events they register for — not a separate code per registration. ✅
27. **A third living doc, `PLAYON_FUTURE_FEATURES.md`** (product roadmap / parking lot), is maintained alongside these two; new ideas land there until promoted into the build. ✅

**Open design questions:**
- **Memberships:** wanted, but tiers/benefits/billing cadence undecided. Architecture supports it; specifics TBD.
- **Facility terms:** Alumni Center arrangement (flat rent / per-hour / percentage) — confirm exact terms; the split model adapts.
- **Stripe** assumed as processor (collect + Connect payouts) — confirm at account setup.
- **Service fee on external/cash payments:** defaulted to **not** applied — confirm.
- **Account-credit expiry length** — set by policy; pick a default (e.g., 12 months).
- **Exact waivers/clearances required by the facility/Kentucky** — confirm with facility + attorney; system stores whatever's needed.
- **Promotion/relegation** in leagues — include or skip? Defaulted to "supported but optional."
- **AI model choice:** Sonnet 4.6 default for assistant; possibly Opus for heavy schedule optimization — confirm budget/latency preference. Verify current model IDs at build time.

---

## 11. Brand & Visual Identity

From the PlayOn logo (athletic, bold, energetic).

| Token | Hex | Use |
|---|---|---|
| **Primary maroon** | `#740D2A` | Primary buttons, headers, key accents |
| **Deep maroon** | `#4B0014` | Hover/active states, dark accents |
| **Maroon shadow** | `#550010` | Gradients, depth |
| **Charcoal / near-black** | `#1F2629` | Text, dark UI surfaces, footer |
| **Slate gray** | `#575C5C` | Secondary text, borders |
| **Off-white** | `#EEE9E9` | Backgrounds, cards |
| **Pure white** | `#FFFFFF` | Surfaces, contrast |

- **Mood:** competitive, clean, sporty, premium-but-accessible.
- **Logo motif:** running player + futsal ball inside a shield/crest.

---

## 12. Changelog

| Version | Date | Change |
|---|---|---|
| 0.8.0 | 2026-05-26 | Added DEPOSITS for leagues & tournaments (deposit holds spot; balance due on/before first game; tracked + play blocked if unpaid, admin-overridable). WAIVERS now required for EVERYONE (youth + adult); youth adds guardian sig + media consent. QR is now ONE durable code per person (their PlayOn ID) across all events, not per-registration. Added third living doc PLAYON_FUTURE_FEATURES.md (roadmap/parking lot). Section 4 retitled; entities updated. Decisions 24-27. |
| 0.7.2 | 2026-05-26 | Check-in upgraded: QR-code scan is the primary fast-path (per player + per team) with manual fallback. Leagues now PLAYER-level check-in with roster-eligibility verification + quick game-day add-player flow. Tournaments now TEAM SELF-check-in the day BEFORE via app/web (calmer event day). New QRCode entity; CheckIn entity updated (method + team-level). Decisions 22-23 (Fridays first, no thin MVP). |
| 0.7.1 | 2026-05-26 | Clarified Friday drop-ins are STAFF-SUPERVISED with NO refs (refs only for league/tournament results); scoped the substitute-ref alert to leagues/tournaments only. Added §8a Check-In detailing how check-in works for all four event types (drop-ins per court pool, camps per day, leagues per fixture, tournaments per team), with universal who's-here/who-owes/waiver-status behaviors. New CheckIn entity. Decisions 21-22. |
| 0.7.0 | 2026-05-26 | Added: facility (Alumni Center) holds insurance + PlayOn still captures waivers/coach clearances; pass-through SERVICE FEE (~3-4%, admin-editable, non-refundable, in-app card only) to cover Stripe cost; refund-fee handling (service fee non-refundable, Stripe keeps its fee on refunds) + account-credit expiry; free-agent handling clarified as mainly adult-league; SMS/text confirmed in-scope for youth/guardian + sub-ref alert; substitute-ref alert (texts unscheduled refs to claim open assignment). New entities (ServiceFeeConfig, RefundCreditPolicy, AccountCredit, SubRefAlert). Decisions 16-20 + refreshed open questions. |
| 0.6.0 | 2026-05-26 | Restructured AI scheduling into a TWO-STAGE admin-gated flow (Stage 1: AI suggests pre-filled events -> admin verifies/configures/locks -> Stage 2: AI schedules details within config -> admin approves); applies to all offering types. Added EventSuggestion entity. Added experience layer from recommendations: day-of check-in/front-desk view, built-in refund/credit policy, family dashboard, youth recaps, returning-player re-enrollment, youth-priority notifications, youth-stats-privacy stance (leaderboards adults/older-youth only), foundation-first principle. Decisions 12-15. |
| 0.5.1 | 2026-05-26 | Drop-ins now use PER-COURT capacity caps (admin-editable, default ~15-20) with an independent waitlist per court pool. Reinforced admin full control over caps/waitlists. Updated §2.3 + RSVP/Spot entity. |
| 0.5.0 | 2026-05-26 | Major scheduling-logic addition. Admin-managed court pool (add/remove courts the AI schedules on). Added §2.6 Scheduling Rules: youth-first (Fayette County Schools calendar drives youth timing); Friday drop-in bands (8–11 small + 12–15 full concurrently 5:30–7:30, adults both courts 7:30–9:30); KSSL/KPL/ECNL as season-alignment hints; adult leagues year-round; hybrid external-calendar model (fetch + admin-confirm, no scheduling on unconfirmed dates). Added offering-mix-by-age. New entities: AgeGroup, RecurringScheduleRule, ExternalCalendar, Court.availableForScheduling. Expanded AI scheduling section. |
| 0.4.3 | 2026-05-26 | Clarified the Alumni Center is a larger multi-court facility; PlayOn dedicates TWO of its courts to futsal (not a two-court building). Updated venue wording in §1, §2.5, and data model. |
| 0.4.2 | 2026-05-26 | Clarified operating model: PlayOn is the OPERATOR of all events at the Alumni Center, Lexington KY. NO user-facing court booking — players/teams sign up for offerings only; admins (AI-assisted) assign sessions/fixtures to courts. Reframed "double-booking" as internal same-court time-conflict prevention. Added venue name throughout. |
| 0.4.1 | 2026-05-26 | Specified facility: single venue, TWO courts — Court 1 full 5v5 (larger goals, goalies allowed); Court 2 small-sided 4v4 or 3v3 (format chosen per booking). Fully flexible court assignment (AI optimizes, admin overrides); per-court double-booking. Updated Court entity + added §2.5 Facility & Courts. |
| 0.4.0 | 2026-05-26 | Added per-category pricing engine (drop-ins/camps/leagues/tournaments) with admin-editable rules; facility revenue split (percentage/flat/hybrid, per-venue). Added full Admin Control section (override everything, permission tiers). Added AI Features: AI scheduling (proposes → admin approves, considers court space/time/season) and role-scoped AI help assistant for all users, built on the Anthropic Claude API. New entities + decisions + open questions. Renumbered sections. |
| 0.3.0 | 2026-05-26 | Expanded to full lifecycle scope: ref/coach payouts (Stripe Connect), memberships (TBD), discounts/promos/installments, notifications/SMS, recurring schedules, venue availability, incident reports, audit logs, public pages (account required), open API, compliance/youth privacy, leaderboards/stats. |
| 0.2.0 | 2026-05-26 | Owner confirmed four defaulted items. |
| 0.1.0 | 2026-05-26 | Initial draft: offerings, roles, mixed payments, youth handling, brand palette. |
