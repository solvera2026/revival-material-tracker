const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Netlify environment variable: ${name}`);
  return value;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };

  try {
    const scriptUrl = getRequiredEnv("APPS_SCRIPT_URL");
    const token = getRequiredEnv("APPS_SCRIPT_TOKEN");

    if (event.httpMethod === "GET") {
      const action = event.queryStringParameters?.action || "openJobs";
      const url = new URL(scriptUrl);
      url.searchParams.set("action", action);
      url.searchParams.set("token", token);

      const response = await fetch(url.toString(), { method: "GET" });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { ok: false, error: text || "Apps Script returned a non-JSON response" };
      }
      return json(response.ok ? 200 : response.status, data);
    }

    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const payload = event.body ? JSON.parse(event.body) : {};
    payload.token = token;

    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { ok: false, error: text || "Apps Script returned a non-JSON response" };
    }

    if (!response.ok || data.ok === false) return json(500, data);
    return json(200, data);
  } catch (error) {
    return json(500, { ok: false, error: error.message || "Server error" });
  }
};
