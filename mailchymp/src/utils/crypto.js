const crypto = require("crypto");

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function makeToken32() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

function makeOtp6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function safeCompareHash(input, hash) {
  const h1 = Buffer.from(sha256(input), "hex");
  const h2 = Buffer.from(hash, "hex");
  if (h1.length !== h2.length) return false;
  return crypto.timingSafeEqual(h1, h2);
}

module.exports = {
  sha256,
  makeToken32,
  makeOtp6,
  safeCompareHash,
  crypto,
};
