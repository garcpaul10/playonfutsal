import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tournamentsTable } from "./tournaments";
import { teamsTable } from "./teams";

export const tournamentSeedsTable = pgTable(
  "tournament_seeds",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    seed: integer("seed").notNull(),
    groupName: text("group_name"),
    divisionId: integer("division_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uniq_tourney_seed_team").on(t.tournamentId, t.teamId)],
);

export const insertTournamentSeedSchema = createInsertSchema(tournamentSeedsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTournamentSeed = z.infer<typeof insertTournamentSeedSchema>;
export type TournamentSeed = typeof tournamentSeedsTable.$inferSelect;
