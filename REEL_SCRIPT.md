# OOO-Pilot Reel Script

**Format:** Portrait (9:16), ~75–90 seconds. Cut fast — no shot longer than ~4s except the call-answer clip.
**Music:** Light, slightly comic synth/lofi under the cold open; cut to a cleaner, more "product" bed once the demo starts (drop the music almost to silence during the actual call audio so it's audible).
**Captions:** Burn in captions on every line — most people watch reels muted first.

---

## SHOT LIST & VOICEOVER

### 0:00–0:10 — Cold open (the funny bit, employee POV)

**Visual:** You, straight to camera, mildly exasperated. Maybe sitting somewhere clearly "off work" — a couch, a beach chair, a hammock, anywhere that reads "I am not at my desk." Phone in hand, buzzing.

**VO (deadpan, comic timing):**
> "You ever go on leave... and your phone just doesn't get the memo?"

*(beat — phone buzzes again, you glance at it, unimpressed)*

> "'Quick question.' 'Just a 2-min call.' 'Sorry to bother you on your day off—'"

**On-screen text overlay:** `Day 1 of OOO: 14 calls`

**Visual cue:** Quick cut — 3-4 rapid flashes of a phone screen with fake missed-call notifications stacking up (mock this in an editor — simple call-notification mockups, or genuinely screen-record a phone with staged notifications).

---

### 0:10–0:18 — The turn / problem statement

**VO:**
> "So I built something that answers those calls for me. Literally."

**On-screen text:** `Meet OOO-Pilot 🎙️`

**Visual:** Cut to your laptop screen — reveal the OOO-Pilot logo/animation (use `public/logo.html` or `docs/index.html` hero — screen-record the signal-loop animation for ~2 seconds, it's genuinely a nice visual beat here).

**VO continues (now a bit more "explainer" energy, still light):**
> "It's an AI that goes out of office *with* me — and when a coworker needs an update, it doesn't text them back. It picks up the phone. As if I'm already there."

---

### 0:18–0:26 — One-line mechanism (fast, confident)

**VO:**
> "It pulls the real status from Jira, calls them, has an actual conversation, and reports back when I'm home. No guessing, no ghosting."

**On-screen text (appears word by word or as a quick flow graphic):**
`Jira → Real call → Structured summary`

**Visual:** Quick screen-recorded pan across the `docs/index.html` "how it works" flow diagram, or a simple 3-icon motion graphic (Jira logo → phone icon → Slack icon) if you want to keep it out of screen-recording territory.

---

### 0:26–0:34 — Demo Part 1: Slack trigger

**Visual:** Screen recording, Slack open in a clean browser window (hide bookmarks bar, other tabs).

**On-screen caption (top third, persists through the whole demo section):** `LIVE DEMO — real CALL-E call`

**Action on screen:**
1. Type/show the mention: `@OOO-Pilot I need an update on the Phoenix launch, can we get on a call?`
2. The offer card appears with **Start Call**.
3. Click **Start Call**.

**VO (quick, almost narrating a screen-capture, energetic):**
> "Watch — I ask for an update in Slack..."

*(pause half a beat as the card appears)*

> "...and it offers to just call me."

**Pacing note:** Keep this under 8 seconds of screen time — don't let viewers read every line, just register "Slack → offer card → button click."

---

### 0:34–0:46 — Demo Part 2: The actual call (your friend's clip)

**Visual:** Cut to your friend's video — them answering their phone, reacting (the funnier/more genuine their reaction, the better this performs). If the clip has them saying something like "wait, is this a robot?" or visibly surprised, that IS the moment — use it.

**VO (let the friend's clip mostly speak for itself — minimal narration over it):**
> "That's my friend picking up — a real outbound call, placed through CALL-E."

**On-screen caption over this clip:** `📞 Incoming: OOO-Pilot`

**Audio note:** If the clip has usable audio of the AI voice talking, let a few seconds of it play raw (no VO on top) — that's your proof-of-real-call moment, don't talk over it.

---

### 0:46–0:58 — Demo Part 3: CALL-E dashboard transcript

**Visual:** Screen recording (or your `heycalle_convo.png` screenshot, animated with a slow pan/zoom — "Ken Burns" style — if you don't have live screen capture of this moment) showing the CALL-E dashboard conversation log:
- "Is the security review done?"
- "No, it's still in progress, blocked on the updated API threat model."
- "Told me the API migration testing is actually complete... tell Arun the client expects the Android release by Wednesday."

**VO:**
> "Every word gets logged by CALL-E itself — questions, answers, and anything new my coworker tells it."

**On-screen text (highlight this specific line, it's the payoff):**
> `"API migration is actually complete" — noted as a CLAIM, not fact`

---

### 0:58–1:08 — Demo Part 4: Slack OOO summary

**Visual:** Screen recording of the Slack return-from-OOO summary posting (`/ooo off` output) — scroll through it quickly: conversations handled, new information, follow-ups, and land on the **discrepancy line**.

**VO:**
> "When I'm back, it hands me the whole thing — what was said, what's new, and where Jira and reality don't agree."

**On-screen text, held for a beat (this is the "wow" line — let it breathe):**
> `⚠️ Jira says In Progress. My coworker says it's done. Verify before you trust either.`

---

### 1:08–1:18 — Quick feedback beat (fast, listy, self-aware)

**Visual:** Cut back to you, to camera, slightly more "wrap-up" energy — or a quick 3-card text montage if you'd rather stay off-camera here.

**VO:**
> "Building this on CALL-E for a day, three things I'd tell their team:"

**On-screen text, three quick beats (~2s each, punchy, not full sentences):**
1. `Give us a free "can you hear me?" test call`
2. `Dashboard bot needs a faster mode`
3. `+91 numbers need love 🇮🇳`

*(Keep VO minimal here or silent — let the text carry it so it reads fast.)*

---

### 1:18–1:25 — Close / CTA

**Visual:** Back to the OOO-Pilot logo/animation, or you to camera with a knowing smile.

**VO:**
> "OOO-Pilot — so your next vacation doesn't come with a call log."

**On-screen text (final card, hold 2–3s):**
```
OOO-Pilot
Built for CALL-E: Your Code Is Calling
github.com/balajianbalagan/ooopilot
```

---

## PRODUCTION NOTES

**Recording order (do this, not the script order):**
1. Record the Slack → call → CALL-E dashboard → summary demo sequence *first*, in one clean pass, using `CALLE_DRY_RUN=false` so it's a real call. This is the part that can go wrong (concurrency limit, a missed ring) and needs redos — get it locked before anything else.
2. Get your friend's answer/reaction clip synced to *that specific* call recording if you want the timing to line up (or treat it as a generic reaction clip if the exact call doesn't matter).
3. Record your cold-open and to-camera bits last, once you know the exact runtime of the demo section — makes it much easier to hit a tight total length.

**Safety check before you publish this:**
- Blur or don't show your friend's actual phone number on screen anywhere in the video (same issue as the README screenshot — already fixed there, but check your recording too).
- Don't show the CALL-E API key, Slack tokens, or `.env` contents in any screen recording. If your terminal is visible during the demo, keep it scrolled to output only, not `cat .env`.

**Suggested caption/hashtags for the post:**
> Built an AI that takes my out-of-office phone calls — literally. #CALLE #AIAgents #BuildInPublic #Hackathon #VoiceAI

**Length check:** As scripted this lands ~85s. If your platform caps lower (e.g. a strict 60s Reel slot), cut the "feedback beat" (1:08–1:18) down to one line instead of three, and trim the cold open to 6s instead of 10s — the demo section (0:26–1:08) is the part that actually proves the product and should not be cut.
