import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

const mapCharacterRow = (row) => {
  if (!row) return null;

  return {
    sessionId: row.session_id,
    characterId: row.character_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    inputType: row.input_type,
    sourceInput: row.source_input,
    profile: JSON.parse(row.profile_json),
  };
};

export class SessionStore {
  constructor({ filename = ":memory:", ttlMs = DEFAULT_SESSION_TTL_MS, now = Date.now } = {}) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });

    this.database = new DatabaseSync(filename);
    this.ttlMs = ttlMs;
    this.now = now;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS character_profiles (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        input_type TEXT NOT NULL CHECK (input_type IN ('prompt', 'known')),
        source_input TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at)
    `);
    this.database.exec("PRAGMA optimize");

    this.insertSession = this.database.prepare(`
      INSERT INTO sessions (id, created_at, last_active_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    this.insertCharacter = this.database.prepare(`
      INSERT INTO character_profiles (
        id, session_id, input_type, source_input, profile_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.selectCharacter = this.database.prepare(`
      SELECT
        sessions.id AS session_id,
        sessions.expires_at,
        character_profiles.id AS character_id,
        character_profiles.input_type,
        character_profiles.source_input,
        character_profiles.profile_json
      FROM sessions
      INNER JOIN character_profiles ON character_profiles.session_id = sessions.id
      WHERE sessions.id = ? AND sessions.expires_at > ?
    `);
    this.touchSession = this.database.prepare(`
      UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?
    `);
    this.deleteSessionStatement = this.database.prepare("DELETE FROM sessions WHERE id = ?");
    this.deleteExpiredStatement = this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?");
  }

  createSession({ inputType, sourceInput, profile }) {
    this.cleanupExpired();
    const timestamp = this.now();
    const expiresAt = timestamp + this.ttlMs;
    const sessionId = randomUUID();
    const characterId = randomUUID();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertSession.run(sessionId, timestamp, timestamp, expiresAt);
      this.insertCharacter.run(
        characterId,
        sessionId,
        inputType,
        sourceInput,
        JSON.stringify(profile),
        timestamp,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      sessionId,
      characterId,
      expiresAt: new Date(expiresAt).toISOString(),
      inputType,
      sourceInput,
      profile,
    };
  }

  getCharacter(sessionId, { refresh = true } = {}) {
    this.cleanupExpired();
    const timestamp = this.now();
    const row = this.selectCharacter.get(sessionId, timestamp);
    if (!row) return null;

    if (refresh) {
      row.expires_at = timestamp + this.ttlMs;
      this.touchSession.run(timestamp, row.expires_at, sessionId);
    }

    return mapCharacterRow(row);
  }

  deleteSession(sessionId) {
    return this.deleteSessionStatement.run(sessionId).changes > 0;
  }

  cleanupExpired() {
    return this.deleteExpiredStatement.run(this.now()).changes;
  }

  close() {
    this.database.close();
  }
}

