/**
 * Edge WAF Rulesmith - Cloudflare Worker
 * Handles WAF rule generation using Workers AI
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API routes
      if (path === "/api/chat" && request.method === "POST") {
        return handleChat(request, env, corsHeaders);
      } else if (path === "/api/rules" && request.method === "GET") {
        return handleListRules(request, env, corsHeaders);
      } else if (path === "/api/rules" && request.method === "POST") {
        return handleCreateRule(request, env, corsHeaders);
      } else if (path === "/api/rules/preview" && request.method === "POST") {
        return handlePreviewRule(request, env, corsHeaders);
      } else if (path.startsWith("/api/rules/") && request.method === "DELETE") {
        return handleDeleteRule(request, env, corsHeaders);
      } else {
        return new Response("Not Found", { 
          status: 404, 
          headers: corsHeaders 
        });
      }
    } catch (error) {
      console.error("Error:", error);
      console.error("Error stack:", error.stack);
      
      // Return proper JSON error response
      const errorMessage = error.message || "Internal server error";
      const errorDetails = process.env.NODE_ENV === 'development' ? error.stack : undefined;
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          details: errorDetails,
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};

/**
 * Handle chat requests - generate WAF rules from natural language
 */
async function handleChat(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const { message, sessionId, history = [] } = body;

  if (!message) {
    return new Response(
      JSON.stringify({ error: "Message is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Build conversation context
  const conversationHistory = history
    .slice(-10) // Keep last 10 messages for context
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");

  // Create prompt for Workers AI
  const systemPrompt = `You are an expert Cloudflare WAF (Web Application Firewall) rule generator. 
Your task is to translate natural language security requirements into Cloudflare WAF rule expressions.

Cloudflare WAF rules use the Expression Editor syntax. Key concepts:
- Use CF expression syntax like: (http.request.uri.path eq "/login") 
- Common fields: http.request.uri.path, http.request.method, ip.geoip.country, http.request.headers, etc.
- Logical operators: and, or, not
- Comparison operators: eq, ne, contains, matches, startsWith, endsWith
- Examples:
  * Block SQL injection: (http.request.body.truncated eq false and http.request.body contains "' OR '1'='1")
  * Allow only from Canada: (ip.geoip.country ne "CA")
  * Block specific endpoint: (http.request.uri.path eq "/admin")
  * Rate limiting: (cf.threat_score gt 50)
  * Block specific user agents: (http.request.headers["user-agent"][*] contains "badbot")

When generating rules:
1. Parse the user's intent accurately
2. Generate valid CF expression syntax
3. Include a human-readable description
4. Suggest appropriate action (block, challenge, log, etc.)
5. If the request is unclear, ask clarifying questions

Respond in JSON format:
{
  "rule": "WAF expression here",
  "description": "Human readable description",
  "action": "block|challenge|log|allow",
  "confidence": "high|medium|low",
  "explanation": "Brief explanation of the rule logic"
}`;

  const userPrompt = conversationHistory
    ? `${conversationHistory}\n\nuser: ${message}\nassistant:`
    : `user: ${message}\nassistant:`;

  // Call Workers AI
  // Workers AI binding (automatically available in --remote mode or production)
  const aiBinding = env.AI;
  
  if (!aiBinding) {
    console.error("Workers AI binding not found. Available env keys:", Object.keys(env));
    console.error("Note: Workers AI requires --remote mode. Run: npm run dev (which uses --remote)");
    throw new Error("Workers AI is not available. For local dev, use 'npm run dev' (remote mode) or deploy to production.");
  }

  const model = env.AI_MODEL || "@cf/meta/llama-3-8b-instruct";
  
  console.log("Calling Workers AI with model:", model);
  
  let aiResponse;
  try {
    // Try different Workers AI API formats
    if (typeof aiBinding.run === 'function') {
      aiResponse = await aiBinding.run(model, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });
    } else if (typeof aiBinding === 'object' && aiBinding.run) {
      aiResponse = await aiBinding.run(model, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });
    } else {
      throw new Error("Workers AI binding does not have a 'run' method");
    }
  } catch (aiError) {
    console.error("Workers AI error:", aiError);
    console.error("Error details:", JSON.stringify(aiError, Object.getOwnPropertyNames(aiError)));
    throw new Error(`AI service error: ${aiError.message || String(aiError)}`);
  }

  // Parse AI response - Workers AI returns response in different formats depending on model
  let aiContent = "";
  if (typeof aiResponse === "string") {
    aiContent = aiResponse;
  } else if (aiResponse.response) {
    aiContent = aiResponse.response;
  } else if (aiResponse.text) {
    aiContent = aiResponse.text;
  } else if (Array.isArray(aiResponse) && aiResponse.length > 0) {
    aiContent = aiResponse[0].response || aiResponse[0].text || String(aiResponse[0]);
  } else {
    aiContent = JSON.stringify(aiResponse);
  }
  
  // Try to extract JSON from response
  let ruleData;
  try {
    // Find JSON in the response (might be wrapped in markdown code blocks)
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      ruleData = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback: create a structured response from plain text
      ruleData = {
        rule: extractExpression(aiContent),
        description: aiContent.substring(0, 200),
        action: inferAction(aiContent),
        confidence: "medium",
        explanation: aiContent,
      };
    }
  } catch (e) {
    // If parsing fails, create a fallback response
    ruleData = {
      rule: extractExpression(aiContent),
      description: aiContent.substring(0, 200),
      action: inferAction(aiContent),
      confidence: "medium",
      explanation: aiContent,
    };
  }

  // Save conversation to KV (optional, for session persistence)
  const sessionKey = sessionId || `session_${Date.now()}`;
  if (env.SESSION_STORE) {
    const sessionData = {
      history: [...history, { role: "user", content: message }],
      lastUpdated: Date.now(),
    };
    await env.SESSION_STORE.put(
      `chat:${sessionKey}`,
      JSON.stringify(sessionData),
      { expirationTtl: 3600 } // 1 hour
    );
  }

  return new Response(
    JSON.stringify({
      sessionId: sessionKey,
      message: aiContent,
      rule: ruleData,
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Handle rule listing from Cloudflare API
 */
async function handleListRules(request, env, corsHeaders) {
  const url = new URL(request.url);
  const zoneId = url.searchParams.get("zone_id") || env.CLOUDFLARE_ZONE_ID;

  if (!zoneId) {
    return new Response(
      JSON.stringify({ error: "zone_id is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return new Response(
      JSON.stringify({ error: "Cloudflare API token not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/rules`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Handle rule creation/deployment to Cloudflare
 */
async function handleCreateRule(request, env, corsHeaders) {
  const {
    zone_id,
    expression,
    action = "block",
    description,
    enabled = true,
  } = await request.json();

  const zoneId = zone_id || env.CLOUDFLARE_ZONE_ID;

  if (!zoneId || !expression) {
    return new Response(
      JSON.stringify({ error: "zone_id and expression are required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return new Response(
      JSON.stringify({ error: "Cloudflare API token not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const rulePayload = {
      action: action,
      filter: {
        expression: expression,
      },
      description: description || "WAF rule",
      enabled: enabled,
    };

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/rules`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([rulePayload]), // API expects array
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Handle rule preview (validation)
 */
async function handlePreviewRule(request, env, corsHeaders) {
  const { expression } = await request.json();

  if (!expression) {
    return new Response(
      JSON.stringify({ error: "expression is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Basic validation - check for common CF expression patterns
  const validation = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check for basic syntax
  if (!expression.trim()) {
    validation.valid = false;
    validation.errors.push("Expression cannot be empty");
  }

  // Check for balanced parentheses
  const openParens = (expression.match(/\(/g) || []).length;
  const closeParens = (expression.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    validation.valid = false;
    validation.errors.push("Unbalanced parentheses");
  }

  // Check for common CF fields
  const commonFields = [
    "http.request.uri.path",
    "http.request.method",
    "ip.geoip.country",
    "http.request.headers",
    "cf.threat_score",
  ];
  const hasKnownField = commonFields.some((field) =>
    expression.includes(field)
  );
  if (!hasKnownField) {
    validation.warnings.push(
      "Expression doesn't contain common Cloudflare fields - verify syntax"
    );
  }

  return new Response(JSON.stringify(validation), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Handle rule deletion
 */
async function handleDeleteRule(request, env, corsHeaders) {
  const url = new URL(request.url);
  const ruleId = url.pathname.split("/").pop();
  const zoneId = url.searchParams.get("zone_id") || env.CLOUDFLARE_ZONE_ID;

  if (!ruleId || !zoneId) {
    return new Response(
      JSON.stringify({ error: "rule_id and zone_id are required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return new Response(
      JSON.stringify({ error: "Cloudflare API token not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/rules/${ruleId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Helper: Extract WAF expression from AI response
 */
function extractExpression(text) {
  // Try to find expression in code blocks or parentheses
  const codeBlockMatch = text.match(/```[\s\S]*?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[0].replace(/```/g, "").trim();
  }

  const parenMatch = text.match(/\([^)]+\)/);
  if (parenMatch) {
    return parenMatch[0];
  }

  return text.substring(0, 200); // Fallback
}

/**
 * Helper: Infer action from text
 */
function inferAction(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes("block") || lowerText.includes("deny")) {
    return "block";
  }
  if (lowerText.includes("challenge")) {
    return "challenge";
  }
  if (lowerText.includes("allow") || lowerText.includes("permit")) {
    return "allow";
  }
  return "log";
}

