# minimi internship and hiring challenge

Source: the job description and challenge brief supplied in this conversation on November 10, 2026. This file records the assignment and its implications; it does not describe an implemented system.

## The internship

**Role:** Software Engineering Intern at minimi  
**Location:** On-site, Bengaluru

minimi describes its product as AI that lives on your Mac and pings you at the right moment. The internship involves building:

- Agents that understand your day and catch promises you might otherwise forget.
- Nudges that arrive when useful and stay quiet otherwise.
- Backend and frontend features, end to end, that ship to real users.

The team wants someone who can show projects they are proud of, cares about system design, and enjoys working across backend and frontend.

## What we are building for the challenge

Build a conversational chat agent with **one tool: web search**. The ambition is to make it as good as the best chat agents available today.

The challenge deliverable is the chat agent. The Mac assistant and proactive nudges describe the internship's product work; the supplied challenge does not require building them.

### Example evaluation questions

> On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?

> What did I ask you on 3 November? Is your answer still correct today?

> Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?

These are examples from the challenge, not evidence that those conversations have happened in this application.

## What these examples mean for our work

The following are engineering implications and proposed priorities, rather than extra rules from minimi:

1. **Persist real conversation history.** Retain user messages, assistant answers, timestamps, and the sources behind earlier answers. Never invent a missing conversation or shortlist.
2. **Retrieve the right past context.** Resolve references such as “the second option,” “on Monday,” and “last Tuesday,” using the user's timezone and the relevant message timestamps. Application-managed history retrieval can supply context while keeping web search as the sole agent-facing tool.
3. **Research current facts.** Search for evidence when checking changing claims such as prices and product releases. Prefer authoritative sources and distinguish publication dates, update dates, and effective dates.
4. **Compare past and present explicitly.** Explain what was said before, what current evidence supports, what changed, and what remains uncertain. A current price alone does not prove when it changed.
5. **Make answers useful and conversational.** Answer directly, cite supporting sources, handle follow-ups, and ask for clarification when missing context would materially change the answer.
6. **Keep execution fast and reliable.** Stream responses where useful, bound research work, and handle failed searches, timeouts, and incomplete evidence without pretending verification succeeded.
7. **Evaluate architecture through behavior.** Test historical recall, date resolution, follow-ups, citation support, change detection, missing history, and search failures. Measure answer quality and latency.

## How minimi will judge it

**The best architecture wins.** The reviewers will talk to the agent like real users, read the code, and read `DESIGN.md`.

They emphasize an agent that answers fast, gets things right, and is good to talk to. Submission speed, visual polish, and feature count are not the main judging criteria. The implementation should be understandable enough for the candidate to explain every decision.

## Required constraints and deliverables

- Use JavaScript or TypeScript on Node.js.
- Run successfully with `npm install`, followed by `npm run dev`.
- List every required API key in `.env.example`.
- Use any framework, or none, and any model.
- Give the chat agent one tool: web search.
- AI coding tools are allowed; the candidate must be able to explain every code decision.
- Submit a **public GitHub repository** through the application form.
- Include a **one-page `DESIGN.md`** covering how it works, why it was built this way, alternatives considered and rejected, and what another week would improve.

## Timeline

There is no due date. Submissions are reviewed on a rolling basis, first come, first served, so earlier submissions are reviewed earlier. A later submission can still win through better architecture. The brief says most people need a weekend and emphasizes better thinking over more hours.

## Repository status when this brief was added

The repository contains a minimal `README.md` and an existing `USER_CONTEXT.md` with developer context and architectural preferences. No runnable chat-agent implementation was present when this brief was written. The implementation, `.env.example`, evaluations, and final `DESIGN.md` remain to be built.
