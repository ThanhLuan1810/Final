const crypto = require("crypto");

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function makeToken32() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

module.exports = { sha256, makeToken32, crypto };
