import type { ColumnType, Generated } from "kysely";

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type UsersTable = {
  id: string;
  email: string;
  display_name: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
};

export type DevicesTable = {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  last_seen_at: Timestamp | null;
};

export type DB = {
  users: UsersTable;
  devices: DevicesTable;
};
