const allowedHosts = new Set([
  "uploads.mangadex.org",
]);

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Method not allowed",
    };
  }

  const imageUrl = event.queryStringParameters?.url || "";
  if (!isAllowedUrl(imageUrl)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Invalid image URL",
    };
  }

  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "Ryuu Manga Reader Image Proxy/1.0" },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: `Image fetch failed: ${response.status}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: `Image proxy failed: ${error.message}`,
    };
  }
};
