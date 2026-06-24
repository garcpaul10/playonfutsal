import { ne } from "drizzle-orm";
import {
  spotsTable,
  campRegistrationsTable,
  leagueRegistrationsTable,
  tournamentRegistrationsTable,
} from "@workspace/db";

/** Excludes cancelled drop-in spots from dashboard/listing queries. */
export const activeSpotCondition = ne(spotsTable.status, "cancelled");

/** Excludes cancelled camp registrations from dashboard/listing queries. */
export const activeCampRegCondition = ne(campRegistrationsTable.status, "cancelled");

/** Excludes cancelled league registrations from dashboard/listing queries. */
export const activeLeagueRegCondition = ne(leagueRegistrationsTable.status, "cancelled");

/** Excludes cancelled tournament registrations from dashboard/listing queries. */
export const activeTournamentRegCondition = ne(tournamentRegistrationsTable.status, "cancelled");
