import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("Seeding PlayOn database…");

  // Venue: Alumni Center
  const venues = await db.select().from(schema.venuesTable);
  if (venues.length === 0) {
    await db.insert(schema.venuesTable).values({
      name: "Alumni Center",
      address: "151 Cooperative Extension Dr",
      city: "Lexington",
      state: "KY",
      zip: "40546",
      phone: "(859) 555-0100",
      notes: "Primary facility for all PlayOn programs. Two dedicated futsal courts.",
    });
    console.log("  + Alumni Center venue");
  }

  // Courts
  // Court 1: full-size 5v5 with goalies | Court 2: small-sided 4v4/3v3
  const courts = await db.select().from(schema.courtsTable);
  if (courts.length === 0) {
    await db.insert(schema.courtsTable).values([
      {
        name: "Court 1",
        type: "full",
        description: "Full-size futsal court — regulation 5v5 play with goalies",
        availableForScheduling: true,
        maxPlayers: 10,
      },
      {
        name: "Court 2",
        type: "small_sided",
        description: "Small-sided court — 4v4 or 3v3 formats, drop-ins and youth skills sessions",
        availableForScheduling: true,
        maxPlayers: 8,
      },
    ]);
    console.log("  + Court 1 (full/5v5+GK) & Court 2 (small-sided/4v4-3v3)");
  }

  // Age Groups — per-year U8–U18 + Adult (12 canonical values)
  const ageGroups = await db.select().from(schema.ageGroupsTable);
  const canonicalAgeGroups = [
    { label: "U8",    minAge: 8,  maxAge: 8,  division: "youth", displayOrder: 1  },
    { label: "U9",    minAge: 9,  maxAge: 9,  division: "youth", displayOrder: 2  },
    { label: "U10",   minAge: 10, maxAge: 10, division: "youth", displayOrder: 3  },
    { label: "U11",   minAge: 11, maxAge: 11, division: "youth", displayOrder: 4  },
    { label: "U12",   minAge: 12, maxAge: 12, division: "youth", displayOrder: 5  },
    { label: "U13",   minAge: 13, maxAge: 13, division: "youth", displayOrder: 6  },
    { label: "U14",   minAge: 14, maxAge: 14, division: "youth", displayOrder: 7  },
    { label: "U15",   minAge: 15, maxAge: 15, division: "youth", displayOrder: 8  },
    { label: "U16",   minAge: 16, maxAge: 16, division: "youth", displayOrder: 9  },
    { label: "U17",   minAge: 17, maxAge: 17, division: "youth", displayOrder: 10 },
    { label: "U18",   minAge: 18, maxAge: 18, division: "youth", displayOrder: 11 },
    { label: "Adult", minAge: 18, maxAge: null, division: "adult", displayOrder: 12 },
  ];
  const existingLabels = ageGroups.map((ag) => ag.label);
  const missingCanonical = canonicalAgeGroups.filter((ag) => !existingLabels.includes(ag.label));
  if (missingCanonical.length > 0) {
    await db.insert(schema.ageGroupsTable).values(missingCanonical);
    console.log(`  + ${missingCanonical.length} canonical age group(s): ${missingCanonical.map(a => a.label).join(", ")}`);
  }

  // Age Group Mappings: default court + format + timeband for key groups
  const mappings = await db.select().from(schema.ageGroupMappingsTable);
  if (mappings.length === 0) {
    const allAG = await db.select().from(schema.ageGroupsTable);
    const allCourts = await db.select().from(schema.courtsTable);
    const court1 = allCourts.find((c) => c.name === "Court 1")!;
    const court2 = allCourts.find((c) => c.name === "Court 2")!;

    const agByLabel = Object.fromEntries(allAG.map((ag) => [ag.label, ag]));

    // U8–U11: small-sided 4v4, Court 2, afternoon
    for (const label of ["U8", "U9", "U10", "U11"]) {
      if (agByLabel[label]) {
        await db.insert(schema.ageGroupMappingsTable).values({
          ageGroupId: agByLabel[label].id,
          defaultCourtId: court2.id,
          defaultFormat: "4v4",
          defaultDurationMinutes: 60,
          timebandStart: "15:00",
          timebandEnd: "19:00",
          notes: `${label}: 4v4 small-sided on Court 2. Afternoon time band.`,
        });
      }
    }

    // U12–U15: full 5v5 with GK, Court 1, late afternoon
    for (const label of ["U12", "U13", "U14", "U15"]) {
      if (agByLabel[label]) {
        await db.insert(schema.ageGroupMappingsTable).values({
          ageGroupId: agByLabel[label].id,
          defaultCourtId: court1.id,
          defaultFormat: "5v5",
          defaultDurationMinutes: 60,
          timebandStart: "17:00",
          timebandEnd: "20:00",
          notes: `${label}: Full 5v5 with goalies on Court 1.`,
        });
      }
    }

    // U16–U18: full 5v5 with GK, Court 1, evening
    for (const label of ["U16", "U17", "U18"]) {
      if (agByLabel[label]) {
        await db.insert(schema.ageGroupMappingsTable).values({
          ageGroupId: agByLabel[label].id,
          defaultCourtId: court1.id,
          defaultFormat: "5v5",
          defaultDurationMinutes: 75,
          timebandStart: "18:00",
          timebandEnd: "21:00",
          notes: `${label}: Full 5v5 with goalies on Court 1. 75-min slots.`,
        });
      }
    }

    // Adult: full 5v5 with GK, Court 1, evening
    if (agByLabel["Adult"]) {
      await db.insert(schema.ageGroupMappingsTable).values({
        ageGroupId: agByLabel["Adult"].id,
        defaultCourtId: court1.id,
        defaultFormat: "5v5",
        defaultDurationMinutes: 90,
        timebandStart: "19:00",
        timebandEnd: "22:00",
        notes: "Adult: Full 5v5 with goalies on Court 1. 90-min slots.",
      });
    }

    console.log("  + Age group mappings: U8–U11 (4v4/Court2), U12–U15 (5v5/Court1), U16–U18 (5v5/Court1), Adult (5v5/Court1)");
  }

  // Seasons
  const seasons = await db.select().from(schema.seasonsTable);
  if (seasons.length === 0) {
    await db.insert(schema.seasonsTable).values([
      { name: "Spring 2026", startDate: "2026-03-01", endDate: "2026-05-31", isActive: true },
      { name: "Fall 2026",   startDate: "2026-09-01", endDate: "2026-11-30", isActive: false },
    ]);
    console.log("  + Spring 2026 & Fall 2026 seasons");
  }

  // Leagues
  const leagues = await db.select().from(schema.leaguesTable);
  if (leagues.length === 0) {
    const [s1] = await db.select().from(schema.seasonsTable).limit(1);
    const allCourts = await db.select().from(schema.courtsTable);
    const court1 = allCourts.find((c) => c.name === "Court 1") ?? allCourts[0];
    await db.insert(schema.leaguesTable).values([
      {
        name: "Adult Rec League — Spring 2026",
        description: "Recreational 5v5 futsal for adults. Full-size court with goalies.",
        seasonId: s1.id,
        courtId: court1.id,
        ageGroup: "Adult",
        format: "5v5",
        status: "active",
        registrationPrice: "149.00",
        maxTeams: 8,
        registrationOpen: true,
        startDate: "2026-03-15",
        endDate: "2026-05-24",
      },
      {
        name: "U12 Youth League — Spring 2026",
        description: "Competitive 4v4 youth league for players aged 10–12.",
        seasonId: s1.id,
        courtId: court1.id,
        ageGroup: "U12",
        format: "4v4",
        status: "active",
        registrationPrice: "99.00",
        maxTeams: 6,
        registrationOpen: true,
        startDate: "2026-03-15",
        endDate: "2026-05-24",
      },
      {
        name: "U16 Youth League — Spring 2026",
        description: "High-intensity 5v5 league for ages 14–16.",
        seasonId: s1.id,
        courtId: court1.id,
        ageGroup: "U16",
        format: "5v5",
        status: "upcoming",
        registrationPrice: "119.00",
        maxTeams: 8,
        registrationOpen: true,
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      },
    ]);
    console.log("  + 3 leagues");
  }

  // Camps
  const camps = await db.select().from(schema.campsTable);
  if (camps.length === 0) {
    const allCourts = await db.select().from(schema.courtsTable);
    const court1 = allCourts.find((c) => c.name === "Court 1") ?? allCourts[0];
    const court2 = allCourts.find((c) => c.name === "Court 2") ?? allCourts[0];
    await db.insert(schema.campsTable).values([
      {
        name: "Spring Break Futsal Camp",
        description: "Full-week intensive skills camp for youth players (ages 8–11, 4v4 small-sided format on Court 2). Mon–Fri 9am–3pm.",
        courtId: court2.id,
        ageGroup: "U12",
        price: "129.00",
        maxParticipants: 20,
        registrationOpen: true,
        status: "upcoming",
        startDate: "2026-04-06",
        endDate: "2026-04-10",
      },
      {
        name: "Goalkeeper Academy",
        description: "Specialist goalkeeper training on full-size Court 1 for ages 12–15. Single-day 8am–4pm.",
        courtId: court1.id,
        ageGroup: "U14",
        price: "89.00",
        maxParticipants: 8,
        registrationOpen: true,
        status: "upcoming",
        startDate: "2026-05-17",
        endDate: "2026-05-17",
      },
    ]);
    console.log("  + 2 camps");
  }

  // Drop-ins
  const dropins = await db.select().from(schema.dropinsTable);
  if (dropins.length === 0) {
    const allCourts = await db.select().from(schema.courtsTable);
    const court1 = allCourts.find((c) => c.name === "Court 1") ?? allCourts[0];
    const court2 = allCourts.find((c) => c.name === "Court 2") ?? allCourts[0];
    await db.insert(schema.dropinsTable).values([
      {
        name: "Monday Adult Open Run",
        courtId: court1.id,
        ageGroup: "Adult",
        startsAt: new Date("2026-05-27T19:00:00"),
        durationMinutes: 90,
        price: "12.00",
        maxPlayers: 10,
        status: "upcoming",
        registrationOpen: true,
      },
      {
        name: "Wednesday Youth Skills Session",
        courtId: court2.id,
        ageGroup: "U12",
        startsAt: new Date("2026-05-29T16:30:00"),
        durationMinutes: 60,
        price: "8.00",
        maxPlayers: 8,
        status: "upcoming",
        registrationOpen: true,
      },
      {
        name: "Saturday Family Futsal",
        courtId: court2.id,
        ageGroup: "Coed",
        startsAt: new Date("2026-06-01T10:00:00"),
        durationMinutes: 60,
        price: "10.00",
        maxPlayers: 8,
        status: "upcoming",
        registrationOpen: true,
      },
    ]);
    console.log("  + 3 drop-in sessions");
  }

  // Tournaments
  const tournaments = await db.select().from(schema.tournamentsTable);
  if (tournaments.length === 0) {
    const allCourtsT = await db.select().from(schema.courtsTable);
    const court1T = allCourtsT.find((c) => c.name === "Court 1") ?? allCourtsT[0];
    const court2T = allCourtsT.find((c) => c.name === "Court 2") ?? allCourtsT[0];
    await db.insert(schema.tournamentsTable).values([
      {
        name: "Memorial Day Shootout 2026",
        description: "Annual 3v3 futsal tournament — open to all skill levels. Played on Court 2 (small-sided).",
        ageGroup: "Adult",
        format: "3v3",
        courtId: court2T.id,
        status: "upcoming",
        teamPrice: "75.00",
        maxTeams: 16,
        registrationOpen: true,
        startDate: "2026-05-23",
        endDate: "2026-05-24",
        prizePot: "500.00",
      },
      {
        name: "Youth Cup 2026",
        description: "Multi-bracket youth tournament — U10 (3v3 Court 2), U12 (4v4 Court 2), U14 (5v5 Court 1).",
        ageGroup: "U12",
        format: "5v5",
        courtId: court1T.id,
        status: "upcoming",
        teamPrice: "100.00",
        maxTeams: 24,
        registrationOpen: true,
        startDate: "2026-06-14",
        endDate: "2026-06-15",
        prizePot: null,
      },
    ]);
    console.log("  + 2 tournaments");
  }

  // Waiver Template — seed the default liability waiver if none exists
  const waiverTemplates = await db.select().from(schema.waiverTemplatesTable);
  if (waiverTemplates.length === 0) {
    await db.insert(schema.waiverTemplatesTable).values({
      name: "PlayOn Liability Waiver & Release",
      version: 1,
      body: `RELEASE AND WAIVER OF LIABILITY, ASSUMPTION OF RISK, AND INDEMNITY AGREEMENT

In consideration of being permitted to participate in futsal, recreational soccer, and related athletic activities ("Activities") organized by PlayOn Sports / Alumni Center ("PlayOn"), I, the undersigned participant (or the parent or legal guardian signing on behalf of a minor), agree to the following:

1. ASSUMPTION OF RISK. I acknowledge that participation in the Activities involves inherent risks of physical injury, including but not limited to sprains, fractures, concussions, and other bodily harm. I voluntarily and knowingly assume all such risks.

2. RELEASE OF LIABILITY. To the fullest extent permitted by law, I hereby release, discharge, and covenant not to sue PlayOn, Alumni Center, their respective officers, directors, employees, volunteers, agents, and affiliates (collectively, "Released Parties") from any and all claims, demands, losses, damages, costs, and causes of action arising out of or related to my (or my child's) participation in the Activities, whether caused by the negligence of the Released Parties or otherwise.

3. INDEMNIFICATION. I agree to indemnify and hold harmless the Released Parties from any loss, liability, damage, or cost they may incur arising from my (or my child's) participation in the Activities.

4. MEDICAL AUTHORIZATION. In the event of an emergency, I authorize PlayOn personnel to secure medical treatment for me (or my child) and agree to be responsible for all related costs.

5. PHOTO/VIDEO CONSENT. I consent to the use of photographs and video footage taken during Activities for PlayOn's promotional and educational purposes, without compensation.

6. ACKNOWLEDGMENT. I have carefully read this Agreement, understand its terms, and sign it freely. I acknowledge this waiver is binding upon my heirs and legal assigns. This Agreement shall be governed by applicable state law.`,
      applicableTo: "all",
      isActive: true,
    });
    console.log("  + Waiver template v1 (PlayOn Liability Waiver & Release)");
  }

  // Session Templates — Friday bands (always reseed to ensure correct configuration)
  const existingTemplates = await db.select().from(schema.sessionTemplatesTable);
  if (existingTemplates.length === 0) {
    const allCourts = await db.select().from(schema.courtsTable);
    const court1 = allCourts.find(c => c.name === "Court 1");
    const court2 = allCourts.find(c => c.name === "Court 2");
    if (court1 && court2) {
      await db.insert(schema.sessionTemplatesTable).values([
        // Slot 1: Youth U8–U11 — 5:30–7:30 PM on small-sided Court 2
        {
          name: "Friday Youth Drop-in (U8–U11)",
          dayOfWeek: 5,
          startTime: "17:30",
          durationMinutes: 120,
          ageGroup: "u8",
          skillLevel: "all",
          courtId: court2.id,
          defaultCap: 12,
          cancellationWindowMinutes: 120,
          description: "Friday 5:30–7:30 PM futsal for U8–U11 on the small-sided court.",
          extraPoolsConfig: null,
          isActive: true,
        },
        // Slot 2: Youth U12–U15 — 5:30–7:30 PM on full Court 1
        {
          name: "Friday Youth Drop-in (U12–U15)",
          dayOfWeek: 5,
          startTime: "17:30",
          durationMinutes: 120,
          ageGroup: "u12",
          skillLevel: "all",
          courtId: court1.id,
          defaultCap: 16,
          cancellationWindowMinutes: 120,
          description: "Friday 5:30–7:30 PM futsal for U12–U15 on the full court.",
          extraPoolsConfig: null,
          isActive: true,
        },
        // Slot 3: Adult Open — 7:30–9:30 PM on BOTH courts (Court 1 primary + Court 2 extra pool)
        {
          name: "Friday Adult Drop-in — Open",
          dayOfWeek: 5,
          startTime: "19:30",
          durationMinutes: 120,
          ageGroup: "adult",
          skillLevel: "all",
          courtId: court1.id,
          defaultCap: 16,
          cancellationWindowMinutes: 120,
          description: "Friday 7:30–9:30 PM adult drop-in on both courts. All skill levels welcome.",
          extraPoolsConfig: [
            { courtId: court2.id, ageGroup: "adult", skillLevel: "all", cap: 14 },
          ],
          isActive: true,
        },
      ] as any);
      console.log("  + 3 Friday session templates (Youth U8–U11 @ 5:30, Youth U12–U15 @ 5:30, Adult Open @ 7:30 both courts)");
    }
  }

  // Activity log
  const activity = await db.select().from(schema.activityTable);
  if (activity.length === 0) {
    await db.insert(schema.activityTable).values([
      { type: "announcement", message: "Spring 2026 season registration is now open!", programName: null, userId: null },
      { type: "announcement", message: "Court 1 (full-size 5v5) and Court 2 (small-sided 4v4/3v3) now available for bookings.", programName: null, userId: null },
    ]);
    console.log("  + 2 activity items");
  }

  console.log("Seed complete.");
  await pool.end();
}

seed().catch((e) => {
  console.error("Seed error:", e);
  pool.end();
  process.exit(1);
});
