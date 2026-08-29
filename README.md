# Recall Lab

A focused flashcard study tool for importing complete study sets, running distraction-free review sessions, and measuring familiarity over time.

**Live app:** https://study-techniques-lab.kppi.chatgpt.site

## Features

- Bulk import flashcards by pasting tabular or delimited text
- Separate study sets with browser-local persistence
- Free study mode without a timer or interruptions
- Guided Pomodoro sessions with 15/3, 25/5, and 45/10 focus/break splits
- Subtle visual progress rings instead of a distracting numeric countdown
- Speed-aware recall classification
- Rolling 0–100 familiarity scores
- Strong, inconsistent, unfamiliar, and unseen knowledge categories
- Per-card progress and end-of-session summaries

## Import format

The default importer expects a tab between each term and definition and a new line between cards:

```text
interface	contract implemented by a class
abstract class	shared base behavior and state
composition	has-a relationship
```

Comma, semicolon, and custom separators are also supported.

## Familiarity scoring

Each card keeps a rolling score instead of being permanently labeled after one answer:

- **Strong:** 75–100
- **Inconsistent:** 40–74
- **Unfamiliar:** 0–39
- **Unseen:** not reviewed yet

Recall ratings are adjusted by response speed. Confident recall under six seconds receives the strongest signal; answers taking longer than fifteen seconds are treated as unfamiliar.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Tech stack

React 19, TypeScript, Next.js-compatible app routing through Vinext, Vite, Tailwind CSS, Radix UI, and Cloudflare Workers.
