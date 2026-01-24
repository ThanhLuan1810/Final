const { URL } = require("url");

function baseUrl(PORT) {
  return (
    String(process.env.BASE_URL || "")
      .trim()
      .replace(/\/+$/, "") || `http://127.0.0.1:${PORT}`
  );
}

function injectOpenPixel(html, token, base) {
  const pixel = `<img src="${base}/t/o/${token}.gif" width="1" height="1" style="display:none" alt="">`;
  if (/<\/body>/i.test(html))
    return html.replace(/<\/body>/i, pixel + "</body>");
  return html + pixel;
}

// rewrite href for http/https only, keep mailto/tel/#/relative
function rewriteLinksForClick(html, token, base) {
  return html.replace(
    /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
    (m, u1, u2, u3) => {
      const url = (u1 || u2 || u3 || "").trim();
      if (!url) return m;
      if (/^(mailto:|tel:|#)/i.test(url)) return m;
      if (!/^https?:\/\//i.test(url)) return m;

      const encoded = encodeURIComponent(url);
      const newUrl = `${base}/t/c/${token}?url=${encoded}`;

      if (u1) return `href="${newUrl}"`;
      if (u2) return `href='${newUrl}'`;
      return `href=${newUrl}`;
    },
  );
}

function injectTracking(html, token, base) {
  let out = html;
  out = rewriteLinksForClick(out, token, base);
  out = injectOpenPixel(out, token, base);
  return out;
}

function validateRedirectUrl(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(raw || ""));
  } catch {
    decoded = String(raw || "");
  }

  let u;
  try {
    u = new URL(decoded);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(u.protocol)) return null;
  return u.toString();
}

module.exports = { baseUrl, injectTracking, validateRedirectUrl };
