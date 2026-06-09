import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("email", "text", (column) => column.notNull().unique())
    .addColumn("display_name", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("devices")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("user_id", "text", (column) => column.notNull().references("users.id").onDelete("cascade"))
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("platform", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("last_seen_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("devices_user_id_idx")
    .ifNotExists()
    .on("devices")
    .column("user_id")
    .execute();

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
        CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync_dev_password';
      END IF;
    END $$;
  `.execute(db);

  await sql`
    GRANT CONNECT ON DATABASE origin TO powersync_role;
    GRANT USAGE ON SCHEMA public TO powersync_role;
    GRANT SELECT ON users, devices TO powersync_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        CREATE PUBLICATION powersync FOR TABLE users, devices;
      ELSE
        ALTER PUBLICATION powersync SET TABLE users, devices;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        DROP PUBLICATION powersync;
      END IF;
    END $$;
  `.execute(db);
  await db.schema.dropTable("devices").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
}
