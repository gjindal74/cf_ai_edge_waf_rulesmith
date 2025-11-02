# Edge WAF Rulesmith 🛡️

An AI-powered application that generates and deploys Cloudflare Web Application Firewall (WAF) rules from natural language. Built entirely on Cloudflare's developer stack using Workers AI, Cloudflare Workers, and Cloudflare Pages.

## Features

- 🤖 **AI-Powered Rule Generation**: Translates natural language into WAF rule expressions
- 💬 **Chat Interface**: Interactive chat-based UI for describing security requirements
- ✅ **Rule Validation**: Preview and validate WAF expressions before deployment
- 🚀 **Direct Deployment**: Apply rules directly to your Cloudflare zones via API
- 📝 **Session Memory**: Maintains chat history and context using Workers KV
- 🎨 **Modern UI**: Clean, responsive interface built with vanilla HTML/CSS/JavaScript

## Architecture

- **Backend**: Cloudflare Worker handling API requests, Workers AI integration, and Cloudflare API calls
- **Frontend**: Static site on Cloudflare Pages with chat interface
- **AI Model**: Llama 3 via Workers AI
- **Storage**: Workers KV for session persistence

## Prerequisites

1. Cloudflare account with:
   - Workers AI enabled (Dashboard → Workers & Pages → AI)
   - Workers KV namespace (we'll create this)
   - API token with Zone and Account permissions

2. Node.js and npm installed
3. Wrangler CLI: `npm install -g wrangler` or use `npx wrangler`

## Installation

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd cf_ai_edge_waf_rulesmith
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create KV Namespaces

```bash
# Create production namespace
npx wrangler kv namespace create "SESSION_STORE"

# Create preview namespace
npx wrangler kv namespace create "SESSION_STORE" --preview
```

Copy the `id` from each output and update `wrangler.toml`:
- Replace `your-kv-namespace-id-here` with the production namespace ID
- Replace `your-kv-preview-id-here` with the preview namespace ID

### 4. Configure Secrets

Set your Cloudflare credentials as secrets:

```bash
# Required: API token with Zone and Account permissions
npx wrangler secret put CLOUDFLARE_API_TOKEN

# Required: Your Cloudflare Account ID
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID

# Optional: Default Zone ID
npx wrangler secret put CLOUDFLARE_ZONE_ID
```

**Getting your credentials:**

- **API Token**: https://dash.cloudflare.com/profile/api-tokens
  - Create Custom Token
  - Permissions: Firewall Services (Edit), Zone (Read)
  - Include your zones or all zones
  
- **Account ID**: Dashboard → Any zone → Right sidebar → Account ID
- **Zone ID**: Dashboard → Your zone → Overview page

**Note**: For local reference, you can create `LOCAL_CONFIG.txt` (gitignored) to store your values, but wrangler uses `secret put` commands, not .env files.

### 5. Enable Workers AI

1. Go to Cloudflare Dashboard → Workers & Pages → AI
2. Click "Enable Workers AI" if not already enabled

## Local Development

### Start Worker (Backend)

```bash
npm run dev
```

This starts the worker in remote mode (required for Workers AI) on `http://localhost:8787`

### Start Frontend (UI)

In another terminal:

```bash
npm run dev:frontend
```

Opens the UI on `http://localhost:8788` (or shown URL)

Open your browser to the frontend URL and start using the application!

## Usage Examples

Try these prompts in the chat:

- `block SQL injections on /login endpoint`
- `allow traffic only from Canada for /admin route`
- `rate limit requests to /api endpoint`
- `block requests with suspicious user agents`
- `challenge requests with high threat scores on /dashboard`

## Deployment

### Deploy Worker

```bash
npm run deploy
```

Your worker will be available at: `https://edge-waf-rulesmith.your-subdomain.workers.dev`

### Deploy Frontend

```bash
npm run pages:deploy
```

Or connect your repository to Cloudflare Pages for automatic deployments.

After deploying, update `public/app.js`:
- Change `YOUR_WORKER_URL_HERE` to your actual worker URL
- Redeploy frontend: `npm run pages:deploy`

## Project Structure

```
├── src/
│   └── index.js          # Worker backend (API routes)
├── public/
│   ├── index.html       # Frontend UI
│   ├── app.js           # Frontend JavaScript
│   └── styles.css       # Styling
├── wrangler.toml        # Worker configuration
└── package.json         # Dependencies
```

## API Endpoints

- `POST /api/chat` - Generate WAF rule from natural language
- `GET /api/rules` - List existing WAF rules
- `POST /api/rules` - Create/deploy a WAF rule
- `POST /api/rules/preview` - Validate a rule expression
- `DELETE /api/rules/:id` - Delete a WAF rule

## Troubleshooting

### Workers AI not available
- Ensure Workers AI is enabled in Dashboard → Workers & Pages → AI
- Verify you're using `npm run dev` (remote mode required)

### KV namespace not found
- Verify the namespace IDs in `wrangler.toml` are correct
- Run `npx wrangler kv namespace list` to see your namespaces

### Invalid API token
- Verify your token has Firewall Services (Edit) and Zone (Read) permissions
- Check the token is set: `npx wrangler secret list`

### Frontend can't connect to Worker
- Verify worker is running (`npm run dev`)
- Check browser console (F12) for errors
- Verify CORS headers are present

## Security

- Never commit API tokens or secrets to version control
- Review generated rules before deploying to production
- Test rules in log mode before enabling blocking
- Set up your own Cloudflare account and resources

