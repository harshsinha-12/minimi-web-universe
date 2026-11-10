# USER_CONTEXT.md

## Developer Profile and Engineering Memory

### 1. Who I Am

I'm Harsh Sinha, a Computer Science & Data Analytics undergraduate at IIT Patna, graduating in 2027.

- GitHub: https://github.com/harshsinha-12
- Portfolio: https://www.harshsinha.dev/
- Current role: Founding AI Engineer at Scalio (joined October 15, 2026)
- Previous role: Founder's Office / Software Engineer at Multibagg AI
- Primary interests: AI agents, LLM engineering, RAG, backend systems, financial technology, and production AI infrastructure.

I'm comfortable with advanced system architecture, distributed processing, databases, model orchestration, and evaluation frameworks. Don't unnecessarily simplify technical explanations.

### 2. My Technical Stack

**Primary:** TypeScript, JavaScript, Node.js, Next.js, React, Python, PostgreSQL, Prisma.

**LLM engineering:** OpenAI, Gemini, LangGraph, multi-agent systems, function calling, RAG, prompt engineering, structured outputs, embeddings, reranking, and LLM evaluation.

**Infrastructure:** Redis, BullMQ, Docker, Azure, AWS, GitHub Actions, streaming/SSE, queues, caching, and asynchronous workflows.

**Retrieval:** Qdrant, Pinecone, hybrid search, metadata filtering, embeddings, document chunking, reranking, and source attribution.

Prefer TypeScript and Node.js for this assignment. Use libraries where they provide clear value, but avoid unnecessary dependencies or frameworks.

### 3. Previous Projects and Architectural Experience

#### Ask Iris - Production Multi-Agent Research Assistant

Built at Multibagg AI.

Approximate production scale:

- 500,000+ queries processed
- 100,000+ financial research documents
- 20 million+ structured financial records

Architecture involved:

- Router/master agent for interpreting user intent
- Specialized agents for stocks, ETFs, mutual funds, and IPOs
- Web search, SQL, financial data, and vector retrieval tools
- Hybrid retrieval, reranking, and context construction
- Citation-grounded answers
- Streaming responses
- Conversation context management
- Structured tool calls and tool-result validation

Evaluation experience:

- LLM-as-a-judge
- Golden test datasets
- Tool-call accuracy
- Citation correctness
- Retrieval relevance
- Response quality
- Latency measurement
- Failure analysis

**Relevant lesson:** Model intelligence alone is insufficient. Reliable retrieval, well-structured context, tool orchestration, and rigorous evaluation determine real-world agent quality.

#### Scalio - Production AI Workflows

Working on generative AI products across a Next.js/TypeScript backend and Expo/React Native mobile app.

Relevant experience:

- Long-running AI generation jobs
- Provider failures, retries, and fallback strategies
- Background job orchestration
- Recovering stuck jobs
- Reliable state transitions
- Observability and customer issue diagnosis
- Context preservation across asynchronous workflows

Built improvements to a content calendar that prepares a rolling seven-day window of generated content from strategies covering up to 35 days.

**Relevant lesson:** Design explicit state transitions, predictable error handling, and graceful recovery. Avoid fragile workflows where a failed model or tool call leaves the application inconsistent.

#### LLM Trading Arena

Built an agent-based trading simulation using TypeScript, Redis, BullMQ, and Next.js.

Important architectural principles:

- Reproducible execution
- Frozen historical snapshots
- Deterministic evaluation
- Structured model outputs
- Append-only execution/audit logs
- Explicit constraints and measurable outcomes

**Relevant lesson:** Maintain reproducible traces and clear separation between data, decisions, and generated outputs.

### 4. Relevant Historical Conversations

Current reference date: November 10, 2026.

User timezone: Asia/Kolkata.

Some verified historical conversation topics that could serve as realistic memory-retrieval examples:

| Date         | Conversation topic                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Nov 6, 2026  | Asked whether an analysis of an approximately 15% international gold correction, INR effects, and Indian gold prices was correct |
| Nov 8, 2026  | Asked about AQI, PM2.5 exposure, and the accuracy of a cigarette-equivalent pollution comparison                                 |
| Nov 8, 2026  | Compared Whoop One, Whoop Peak, and Fitbit Air, including whether features could be reverse engineered                           |
| Nov 9, 2026  | Asked about the cost of generating 10-second videos with Omni 1.2 and Sedans 2.5                                                 |
| Nov 10, 2026 | Asked which Nano Banana image model currently offers the highest image quality                                                   |
| Nov 10, 2026 | Troubleshot Apple's Universal Clipboard between an iPhone and MacBook; restarting the iPhone appeared to resolve the issue       |

These entries are memory summaries, not authoritative verbatim transcripts. Their dates, wording, and completeness must not be treated as substitutes for actual persisted messages.

**Important:** There is no verified record in this handoff of a five-tool CRM shortlist or a specific Postgres hosting pricing conversation. Those are examples from the assignment, not confirmed user history. Never fabricate them.

### 5. How I Evaluate Engineering Decisions

Prioritize these qualities when helping me build software:

1. **Correctness:** Answers should be backed by actual evidence. Avoid hallucinated historical conversations, source citations, prices, or release announcements.
2. **Architectural clarity:** Every component should have a clear purpose and failure model.
3. **Latency:** Optimize time to first token and time to a useful answer, rather than merely reducing the number of model calls.
4. **Appropriate complexity:** Prefer a well-designed, simple pipeline over unnecessary multi-agent orchestration.
5. **Observability:** Make it possible to understand why the agent searched, what it retrieved, and how it generated an answer.
6. **Evaluation:** Develop meaningful tests, not just attractive demos. Cover retrieval mistakes, temporal errors, grounding, and conversational follow-ups.
7. **Production reliability:** Handle timeouts, retries, malformed tool outputs, duplicate operations, and missing context.
8. **User experience:** The agent should be conversational, remember context, recognize uncertainty, and ask clarifying questions only when necessary.

### 6. Context for This Specific Assignment

I am building a conversational agent with exactly one agent-facing external tool: **web search**.

The agent must excel at questions such as:

- "What did I ask you last Tuesday?"
- "Is your earlier answer still correct today?"
- "Have any of the products we compared changed pricing?"
- "What has changed since we last discussed this?"
- "Which sources support your answer?"
- "You mentioned three options earlier. What about the second one?"

The system must distinguish between:

**Conversation history**
What the user actually said, what the assistant previously answered, when each message was sent, and which sources supported the earlier answer.

**Current external evidence**
What web search currently reveals, including publication dates, effective dates, and uncertainty.

**Temporal reasoning**
Resolving relative dates, finding the relevant historical conversation, and comparing old claims against current evidence.

Historical conversation retrieval should be supported by application-managed persistence and context construction. It does not necessarily need to be exposed as a second LLM tool.

The agent should never claim to remember messages that were never ingested or persisted.

### 7. Desired Collaboration Style

- Challenge weak architectural choices rather than blindly agreeing.
- Explain meaningful trade-offs, especially around accuracy, cost, latency, and complexity.
- Use concrete interfaces, schemas, data flows, and test cases.
- Prefer working implementations over vague pseudocode.
- Keep code modular, readable, and easy to explain in an interview.
- Avoid overengineering for theoretical scale when a simpler solution serves the assignment better.
- Clearly distinguish verified facts, assumptions, and proposals.
- Optimize for the strongest architecture and reasoning, not the largest feature count.

### 8. Assignment Constraints

- JavaScript or TypeScript on Node.js
- Must work with `npm install` followed by `npm run dev`
- Include every required API key in `.env.example`
- Public GitHub repository
- One-page `DESIGN.md` explaining architecture, trade-offs, rejected alternatives, and improvements with another week
- Exactly one agent-facing tool: web search
- Evaluation prioritizes correctness, speed, conversational quality, and architectural judgment

**Final objective:** Build a fast, reliable, evidence-grounded conversational research agent with excellent historical recall and temporal reasoning. Optimize its architecture for real-world questioning, not just a scripted demonstration.
