import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "./session-store.js";

const profile = {
  displayName: "Ephemeral Character",
  voice: { voiceId: "af_heart", speakingSpeed: 1 },
};

test("SessionStore refreshes active sessions and cascades explicit deletion", () => {
  let timestamp = 1_000;
  const store = new SessionStore({ ttlMs: 500, now: () => timestamp });

  try {
    const session = store.createSession({
      inputType: "prompt",
      sourceInput: "An ephemeral character",
      profile,
    });

    timestamp = 1_300;
    const active = store.getCharacter(session.sessionId);
    assert.equal(active.profile.displayName, "Ephemeral Character");
    assert.equal(active.expiresAt, new Date(1_800).toISOString());

    assert.equal(store.deleteSession(session.sessionId), true);
    assert.equal(store.getCharacter(session.sessionId), null);
  } finally {
    store.close();
  }
});

test("SessionStore deletes a character when its inactive session expires", () => {
  let timestamp = 2_000;
  const store = new SessionStore({ ttlMs: 500, now: () => timestamp });

  try {
    const session = store.createSession({
      inputType: "known",
      sourceInput: "A known fictional character",
      profile,
    });

    timestamp = 2_501;
    assert.equal(store.getCharacter(session.sessionId), null);
    assert.equal(store.deleteSession(session.sessionId), false);
  } finally {
    store.close();
  }
});
