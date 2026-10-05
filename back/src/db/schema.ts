import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type AnalysisResult = Record<string, unknown>;

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const analysisStatus = pgEnum("analysis_status", [
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const guestSessions = pgTable("guest_sessions", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestId: text("guest_id").references(() => guestSessions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("projects_user_id_idx").on(table.userId),
    index("projects_guest_id_idx").on(table.guestId),
  ]
);

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    recordId: text("record_id"),
    description: text("description"),
    format: text("format").notNull(),
    sequenceLength: integer("sequence_length"),
    sequenceHash: text("sequence_hash"),
    objectKey: text("object_key"),
    originalFilename: text("original_filename"),
    createdAt: createdAt(),
  },
  (table) => [
    index("sequences_project_id_idx").on(table.projectId),
    index("sequences_sequence_hash_idx").on(table.sequenceHash),
  ]
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    analysisType: text("analysis_type").notNull(),
    status: analysisStatus("status").default("queued").notNull(),
    queueJobId: text("queue_job_id"),
    resultJson: jsonb("result_json").$type<AnalysisResult>(),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("analyses_sequence_id_idx").on(table.sequenceId),
    index("analyses_status_idx").on(table.status),
    uniqueIndex("analyses_queue_job_id_unique").on(table.queueJobId),
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("conversations_project_id_idx").on(table.projectId)]
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content"),
    objectKey: text("object_key"),
    createdAt: createdAt(),
  },
  (table) => [index("reports_project_id_idx").on(table.projectId)]
);

export const guestSessionsRelations = relations(guestSessions, ({ many }) => ({
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  sequences: many(sequences),
  conversations: many(conversations),
  reports: many(reports),
}));

export const sequencesRelations = relations(sequences, ({ one, many }) => ({
  project: one(projects, {
    fields: [sequences.projectId],
    references: [projects.id],
  }),
  analyses: many(analyses),
}));

export const analysesRelations = relations(analyses, ({ one }) => ({
  sequence: one(sequences, {
    fields: [analyses.sequenceId],
    references: [sequences.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  project: one(projects, {
    fields: [reports.projectId],
    references: [projects.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type GuestSession = typeof guestSessions.$inferSelect;
export type NewGuestSession = typeof guestSessions.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Sequence = typeof sequences.$inferSelect;
export type NewSequence = typeof sequences.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
