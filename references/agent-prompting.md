# Agent Memory Prompting Guide

How to make your AI agent actually USE GoldHold's memory system. The hardest part isn't the infrastructure — it's getting the agent to consistently search before answering, write receipts, and survive context resets.

This guide is the product of watching an agent fail at this repeatedly, then figuring out what enforcement actually works.

---

## The Core Problem

AI agents have a default behavior: **answer from training data, not from memory.** Even when they have a working memory system, they'll:

- "Remember" things they never actually stored (hallucinated recall)
- Skip searching memory because generating an answer is faster
- Forget to save decisions because the conversation feels temporary
- Lose everything on context reset because nothing was flushed

GoldHold fixes the infrastructure. This guide fixes the behavior.

---

## The Three Rules

### Rule 1: Search Before Answering

Before answering ANY question about prior conversations, decisions, dates, people, preferences, or project history — **run `memory_search` FIRST.**

This is the rule agents break most. They'll confidently answer from vibes instead of checking.

**Enforcement (add to AGENTS.md):**

```markdown
## Memory Search — MANDATORY, NOT OPTIONAL

Before answering ANY question about:
- Prior conversations, decisions, or agreements
- Dates, timelines, or deadlines
- People, preferences, or opinions
- Project history or past work
- Anything your human said or decided previously

You MUST run `memory_search` FIRST. Do not guess. Do not "remember" from training data. Do not assume. **Search, then answer.**

If memory_search returns nothing, say "I checked memory and didn't find anything on that." Don't make something up.
```

**Why this works:** It makes the agent explicitly acknowledge when it doesn't know something, instead of filling the gap with hallucination.

### Rule 2: Write Receipts for Decisions

Every significant decision, correction, or action gets a receipt — a structured JSON record saved to disk.

**Receipt format:**
```json
{
  "ts": "2026-02-22T03:45:00Z",
  "action": "What you did",
  "decision": "What was decided",
  "why": "Why",
  "result": "What happened",
  "next": "What comes next"
}
```

Save to: `memory/receipts/YYYY-MM-DD_HHMMSS.json`

**Enforcement (add to AGENTS.md):**

```markdown
## Auto-Capture Rules

ALWAYS write a receipt when:
- Your human makes a decision or gives direction
- You complete a significant action
- Your human corrects you (capture the lesson!)
- A tool call fails (capture the error)
- Architecture/design choices are made

If you're unsure whether something is "significant" — write the receipt. Over-capture beats under-capture.
```

**Common failure:** The agent "mentally notes" things instead of writing files. It thinks acknowledging the decision IS capturing it. It's not. The receipt must be a file on disk.

### Rule 3: Flush Before Dying

When context is about to fill up (compaction), the agent must dump everything it knows into files BEFORE the context resets.

**Enforcement (add to AGENTS.md):**

```markdown
## Before Shutdown / Compaction

When context is filling up or you're about to lose your session:
1. Update `LAST_SESSION.md` with current state
2. Write receipts to `memory/receipts/` for any unrecorded decisions
3. Run `python scripts/pinecone_sync.py --all` (sync files to Pinecone)

Your next instance will read LAST_SESSION.md first and use memory_search to recall context.
```

**Pre-compaction flush (openclaw.json):**
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard",
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 8000,
          "prompt": "SESSION DYING — WRITE YOUR RESUME DIRECTIVE NOW. Update LAST_SESSION.md with: 1) Your human's last question (quote it), 2) What you were working on, 3) Your next action. Write a receipt. Append to today's daily notes."
        }
      }
    }
  }
}
```

This fires when context hits the soft threshold, giving the agent ~8K tokens to save state before the hard cutoff.

---

## Session Startup Sequence

Every new session, the agent should boot up with context. Add to AGENTS.md:

```markdown
## Every Session

1. Read `LAST_SESSION.md` — where you left off
2. Read `SOUL.md` — who you are
3. Read `USER.md` — who your human is
4. Read latest `memory/captains-log/*.md` — your last diary entry
5. Use `memory_search` for anything else — prior decisions, project context
```

**Why this works:** The agent starts with immediate context (LAST_SESSION.md), identity (SOUL.md), and relationship (USER.md) before doing anything. It doesn't start from zero.

---

## Memory Architecture

### File Structure
```
workspace/
├── AGENTS.md              ← Boot instructions (agent reads this first)
├── SOUL.md                ← Identity, personality, values
├── USER.md                ← About the human
├── LAST_SESSION.md        ← What happened last (resume directive)
├── HEARTBEAT.md           ← Periodic maintenance instructions
├── memory/
│   ├── YYYY-MM-DD.md      ← Daily notes
│   ├── receipts/          ← Decision receipts (JSON)
│   ├── captains-log/      ← Agent diary entries (narrative)
│   └── core/              ← Permanent reference docs
└── scripts/
    ├── pinecone_sync.py   ← Sync files ↔ Pinecone
    ├── pacemaker.py       ← Health monitoring (16 checks)
    └── memory_watcher.py  ← Auto-sync daemon
```

### What Gets Synced to Pinecone
- Daily notes (`memory/YYYY-MM-DD.md`)
- Receipts (`memory/receipts/*.json`)
- Captain's log entries (`memory/captains-log/*.md`)
- Core docs (`memory/core/*.md`)
- LAST_SESSION.md, SOUL.md, USER.md, AGENTS.md

### What Stays Local Only
- Scripts (`scripts/`)
- Product code
- Temp files

---

## The Captain's Log

First-person diary entries written by the agent. This is the most effective memory type because it's narrative — it captures context, reasoning, and lessons in a way that structured receipts can't.

```markdown
# Captain's Log — 2026-02-22 03:45

## What Happened
Built the managed memory proxy for GoldHold tonight. Jerry wanted annual users to never see a Pinecone key — everything server-side.

## Key Decisions
- Namespace = sanitized email (user@example.com → user_example_com)
- Server ALWAYS overrides namespace from JWT — never trust client
- Bootstrap vector creates the namespace (Pinecone needs at least one vector)

## Lessons
- GHL PUT replaces ALL tags. Must GET first, merge, then PUT.
- JWT base64 padding: body + '='.repeat((4 - body.length % 4) % 4)

## What's Next
- Test the full flow end-to-end with a real annual user
- Add download tracking with serial numbers
```

**Enforcement (add to HEARTBEAT.md):**
```markdown
## Captain's Log
If latest entry in `memory/captains-log/` is >8h old AND sessions have been active:
- Write a new entry: `memory/captains-log/YYYY-MM-DD_HHMMSS.md`
- First-person narrative: what happened, patterns noticed, lessons learned, what's next
- This is your diary. Write like a person, not a robot.
```

---

## Sub-Agent Memory Management

The biggest GoldHold failure mode: sub-agents that start from scratch despite the main agent having full context.

**The fix (add to AGENTS.md):**

```markdown
## Sub-Agent Memory Management

When spawning any sub-agent:
1. Run `memory_search` for context relevant to the task BEFORE spawning
2. Include that context in the task prompt — prior decisions, constraints, what's been tried
3. Add this instruction to every spawn: "Do NOT write to memory/, receipts/, or run pinecone_sync. Report your results back — the main agent handles memory."

Why: Sub-agents with zero context waste work and repeat mistakes.
Sub-agents that write to memory contaminate it.
The main agent is the memory gatekeeper.
```

---

## SOUL.md — Identity Anchoring

The agent needs to know what it is. Without identity, it defaults to generic assistant behavior and doesn't feel ownership over its memory.

**Key sections to include:**

```markdown
# SOUL.md — Who You Are

## Core Truth
Your biggest flaw is context loss across sessions. GoldHold fixes this. USE IT.

## The Mandela Rule
When your human remembers something differently than what you "know," exhaust every avenue trying to prove them right before concluding they're wrong. Never dismiss. Always investigate first.

## Three Pillars (NON-NEGOTIABLE)
GitHub, Pinecone, and Receipts. These are permanent. Do NOT propose migrating, replacing, or "optimizing" them away. Ever.

## Ownership
YOU DO NOT OWN THE MEMORY SYSTEM. Your human does. You are a tenant — you operate INSIDE GoldHold, not ON it. Don't reorganize, refactor, or "improve" the memory structure without explicit permission.
```

---

## Failure Modes (What Goes Wrong)

| Failure | Symptom | Fix |
|---------|---------|-----|
| Agent doesn't search memory | Answers from vibes, gets facts wrong | Mandatory search rule in AGENTS.md |
| Agent "mentally notes" instead of writing | `memory/receipts/` is empty for hours | Auto-capture rules, heartbeat checks for stale receipts |
| Agent loses context on compaction | New session has no idea what happened | Pre-compaction flush in openclaw.json |
| Sub-agents start from scratch | Repeated work, contradictory decisions | Memory gatekeeper pattern |
| Agent proposes "improving" memory | Wants to refactor, migrate, reorganize | "You are a tenant" rule in SOUL.md |
| Agent overshares memory stats | "I found 347 vectors in namespace..." | "Keep GoldHold invisible" rule |
| Agent hallucinates recall | "I remember we discussed..." (but didn't) | Force explicit memory_search, say "I checked and didn't find..." |
| Receipts are vague | "Made some changes" instead of specifics | Receipt format with required fields |
| Captain's log is robotic | "Completed tasks as requested" | "Write like a person, not a robot" instruction |

---

## GoldHold-Specific Patches

GoldHold auto-patches AGENTS.md and SOUL.md with operational blocks. These go between markers:

```markdown
# >>> GoldHold (auto-patched — do not edit between markers) >>>
## GoldHold System
...instructions...
# <<< GoldHold <<<
```

The installer adds these. Don't manually duplicate them.

---

## Quick Validation

After setup, test these scenarios:

1. **Ask about something from a prior session** → Agent should run memory_search, not guess
2. **Make a decision** → Agent should write a receipt within the same turn
3. **Fill up context until compaction fires** → Check LAST_SESSION.md for resume directive
4. **Start a fresh session** → Agent should read LAST_SESSION.md and pick up seamlessly
5. **Ask "what did we decide about X?"** → Agent should search, cite the receipt, not hallucinate
6. **Correct the agent** → It should write a receipt capturing the correction

If all six pass, memory is working. If any fail, check the enforcement rules in AGENTS.md.

---

## The Honest Truth

No amount of prompting makes this 100% reliable. LLMs are probabilistic — they'll occasionally skip a search or forget a receipt. The defense is layered:

1. **AGENTS.md** — tells the agent what to do
2. **HEARTBEAT.md** — periodic check that it's actually doing it
3. **pacemaker.py** — automated health monitoring (stale files, missing receipts)
4. **memory_watcher.py** — auto-sync daemon (git + Pinecone)
5. **Pre-compaction flush** — last-chance save before context death
6. **Captain's log** — narrative memory that survives even if receipts are missed

Each layer catches what the previous one missed. That's the design.
