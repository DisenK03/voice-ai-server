# Real-Time Voice AI Server

A production-ready template for building real-time voice AI phone systems. Create your own AI phone agent with natural conversation capabilities using streaming STT, LLM, and TTS - all with sub-second latency.

**Use this as a starting point to build:**
- Customer support hotlines
- Appointment scheduling systems
- Order status and tracking bots
- Technical support agents
- Healthcare intake systems
- Restaurant reservation systems
- Any AI-powered phone service

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Twilio](https://img.shields.io/badge/Twilio-F22F46?style=flat&logo=twilio&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat&logo=openai&logoColor=white)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REAL-TIME VOICE AI                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐     ┌─────────────────────────────────────────────────┐     │
│   │  Caller  │────▶│              Twilio Media Streams               │     │
│   │  Phone   │◀────│         (WebSocket - 8kHz mulaw audio)          │     │
│   └──────────┘     └─────────────────────────────────────────────────┘     │
│                                       │                                     │
│                                       ▼                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                        Voice Server (Node.js)                       │  │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │  │
│   │  │   Deepgram  │    │   OpenAI    │    │      ElevenLabs         │ │  │
│   │  │  STT ~300ms │───▶│ GPT Streaming│───▶│    TTS ~200ms          │ │  │
│   │  │  (Nova-2)   │    │   ~500ms    │    │ (Turbo v2.5, ulaw)     │ │  │
│   │  └─────────────┘    └─────────────┘    └─────────────────────────┘ │  │
│   │                                                                     │  │
│   │  ┌─────────────────────────────────────────────────────────────┐   │  │
│   │  │                  Production Features                         │   │  │
│   │  │  • Circuit Breakers  • Cost Tracking  • Session Recording   │   │  │
│   │  │  • Graceful Shutdown • Retry Logic    • Latency Metrics     │   │  │
│   │  └─────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Total Round-Trip Latency: ~1 second (user speaks → AI responds)
```

## Features

### Core Voice Pipeline
- **Streaming STT** - Deepgram Nova-2 with real-time transcription (~300ms)
- **Streaming LLM** - OpenAI GPT-4 with token streaming (~500ms first token)
- **Streaming TTS** - ElevenLabs Turbo v2.5 with natural voice (~200ms)
- **Smart Interruption** - Detects when user starts speaking, stops AI response

### Production Reliability
- **Circuit Breakers** - Automatic failure detection and recovery for all external services
- **Retry Logic** - Exponential backoff with jitter for transient failures
- **Graceful Shutdown** - Completes active calls before server restart
- **Cost Tracking** - Real-time cost per call (STT minutes, TTS characters, LLM tokens)

### Call Intelligence
- **Caller Verification** - Match phone numbers to known users
- **Session Recording** - Full transcript storage with timestamps
- **Conversation Memory** - Maintains context across the call (capped for memory safety)
- **Auto-Hangup** - Detects conversation completion and ends gracefully

## Quick Start

### Prerequisites
- Node.js 18+
- Twilio account with a phone number
- Deepgram API key
- OpenAI API key
- ElevenLabs API key
- (Optional) Supabase for database features

### Installation

```bash
git clone https://github.com/yourusername/realtime-voice-ai.git
cd realtime-voice-ai
npm install
```

### Configuration

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
```

Required environment variables:
```env
# Server
PORT=3001
VOICE_SERVER_URL=https://your-server.railway.app

# AI Services
DEEPGRAM_API_KEY=your_deepgram_key
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Optional: default is Rachel

# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token

# Database (Optional)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Running Locally

```bash
# Development with hot reload
npm run dev

# Production build
npm run build
npm start
```

### Twilio Setup

1. Get a Twilio phone number
2. Set the Voice webhook URL to: `https://your-server.railway.app/twiml`
3. Set webhook method to POST

## Project Structure

```
src/
├── index.ts                 # Server entry point, WebSocket routing
├── voice-session/           # Voice call session management
│   ├── index.ts            # Main session orchestrator
│   ├── audio-handler.ts    # Audio streaming coordination
│   ├── prompts.ts          # System prompts and greetings
│   ├── verification.ts     # Caller verification flow
│   └── types.ts            # TypeScript interfaces
├── server/
│   └── routes.ts           # HTTP routes (health, TwiML, SMS)
├── deepgram.ts             # Streaming speech-to-text
├── openai.ts               # Streaming LLM responses
├── elevenlabs.ts           # Streaming text-to-speech
├── caller-verification/    # Phone number verification
├── session-recorder/       # Call transcript recording
└── utils/
    ├── circuit-breaker.ts  # Failure protection
    ├── retry.ts            # Retry with backoff
    ├── cost-tracker.ts     # Usage cost tracking
    └── logger.ts           # Structured logging
```

## How It Works

### Voice Flow
1. **Incoming Call** → Twilio sends TwiML request to `/twiml`
2. **WebSocket Connect** → Twilio opens media stream to `/media-stream`
3. **Audio In** → 8kHz mulaw audio streamed to Deepgram for transcription
4. **Transcription** → Deepgram sends real-time transcripts (interim + final)
5. **Silence Detection** → Wait 1.8s of silence to capture complete thought
6. **LLM Response** → OpenAI generates streaming response
7. **TTS** → ElevenLabs converts text chunks to audio as they arrive
8. **Audio Out** → Audio streamed back through Twilio to caller

### Circuit Breaker Pattern
Each external service (Deepgram, OpenAI, ElevenLabs) is protected:
```
CLOSED → [3 failures] → OPEN → [30s timeout] → HALF_OPEN → [2 successes] → CLOSED
```

### Cost Tracking
Real-time cost calculation per call:
- Deepgram: ~$0.0043/min (Nova-2)
- OpenAI: ~$0.01/1K tokens (GPT-4-turbo)
- ElevenLabs: ~$0.30/1K chars (Turbo v2.5)
- Twilio: ~$0.014/min (voice)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with circuit breaker status |
| `/stats` | GET | Cost tracking and memory usage |
| `/metrics` | GET | Prometheus-format metrics |
| `/twiml` | POST | Twilio voice webhook (returns TwiML) |
| `/sms` | POST | Twilio SMS webhook |
| `/media-stream` | WS | WebSocket for Twilio media streams |

## Deployment

### Railway (Recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

## Performance Tuning

### Voice Quality
ElevenLabs settings in `elevenlabs.ts`:
```typescript
voice_settings: {
  stability: 0.6,          // Balance consistency vs expressiveness
  similarity_boost: 0.75,  // Voice matching accuracy
  style: 0.35,             // Friendly but professional
  speed: 0.92,             // Natural conversational pace
}
```

### Speech Recognition
Deepgram settings in `deepgram.ts`:
```typescript
{
  utterance_end_ms: 3000,  // Wait for complete thoughts
  endpointing: 1500,       // Pause tolerance
  smart_format: true,      // Better punctuation
}
```

## Customization

This template is designed to be forked and customized for your specific use case.

### Quick Start Customization
Set these environment variables to personalize your AI:
```env
AI_NAME=Sophie           # Your AI's name
COMPANY_NAME=Acme Corp   # Your company name
```

### Voice Selection
Browse [ElevenLabs Voice Library](https://elevenlabs.io/voice-library) and set:
```env
ELEVENLABS_VOICE_ID=your_chosen_voice_id
```

### Building Your Own AI Agent

**1. Define your AI's personality** in `src/voice-session/prompts.ts`:
```typescript
// Customize the system prompt for your use case
return `You are ${AI_NAME}, a friendly ${YOUR_ROLE} for ${COMPANY_NAME}.

YOUR JOB:
1. Greet callers warmly
2. ${YOUR_SPECIFIC_TASK_1}
3. ${YOUR_SPECIFIC_TASK_2}
4. ${YOUR_SPECIFIC_TASK_3}

PERSONALITY:
- ${YOUR_TONE_AND_STYLE}
`;
```

**2. Add custom actions** - Extend the response parser in `src/voice-session/response-parser.ts` to handle domain-specific tags and trigger custom logic.

**3. Integrate your backend** - Connect to your database, CRM, or booking system in `src/supabase.ts` or add your own service integrations.

**4. Customize verification** - Modify `src/caller-verification/` to match callers against your user database.

### Example Use Cases

| Use Case | AI Role | Key Features |
|----------|---------|--------------|
| Customer Support | Support Agent | Issue classification, ticket creation, escalation |
| Appointment Booking | Scheduling Assistant | Calendar integration, availability check, confirmation |
| Order Status | Order Tracker | Order lookup, shipping updates, return initiation |
| Technical Support | Tech Support Agent | Troubleshooting scripts, ticket escalation, callback scheduling |
| Restaurant Reservations | Host | Table availability, party size, special requests |

## License

MIT License - feel free to use this in your own projects.

## Contributing

Pull requests welcome. For major changes, open an issue first.
