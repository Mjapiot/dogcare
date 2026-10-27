/**
 * Runs the real Supabase migrations against an in-process PostgreSQL (PGlite)
 * with a minimal emulation of Supabase's auth/storage schemas and roles, so
 * that RLS policies and RPCs can be tested without Docker or a remote project.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const SUPABASE_EMULATION = /* sql */ `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ), ''
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.objects to anon;
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end
  $$;
  grant execute on function storage.foldername(text) to authenticated;
`;

export type Db = PGlite;
export type Tx = Transaction;

export async function createTestDb(): Promise<Db> {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await db.exec(SUPABASE_EMULATION);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: Db, id: string, displayName: string): Promise<string> {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('display_name', $3::text))`,
    [id, `${displayName.toLowerCase()}@example.test`, displayName],
  );
  return id;
}

/** Runs `fn` as an authenticated user, inside a transaction (RLS applies). */
export async function asUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Runs `fn` as an anonymous visitor. */
export async function asAnon<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return fn(tx);
  });
}

export async function rows<T = Record<string, unknown>>(
  tx: Tx | Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, unknown>>(
  tx: Tx | Db,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await rows<T>(tx, sql, params);
  if (result.length !== 1) throw new Error(`Expected one row, got ${result.length}`);
  return result[0];
}
