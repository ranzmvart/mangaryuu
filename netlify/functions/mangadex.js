const API_ORIGIN = "https://api.mangadex.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const prefix = "/api/mangadex";
    let targetPath = event.path.startsWith(prefix) ? event.path.slice(prefix.length) : event.path;
    if (!targetPath || targetPath === "/") targetPath = "/manga";
    if (!targetPath.startsWith("/")) targetPath = `/${targetPath}`;

    const query = event.rawQuery ? `?${event.rawQuery}` : "";
    const targetUrl = `${API_ORIGIN}${targetPath}${query}`;

    const response = await fetch(targetUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Ryuu Manga Reader Netlify Proxy/1.0",
      },
    });

    const text = await response.text();

    return {
      statusCode: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
      },
      body: text,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "MangaDex proxy failed",
        message: error.message,
      }),
    };
  }
};
