# Love personality: fine-tuning seed data

`love_seed.jsonl` holds 12 hand-written chat examples (6 playful, 6 serious) in the standard `messages` format.
It is a **seed**, not a training set: write several hundred more (Hinglish, Hindi, English) before a LoRA/QLoRA run on Gemma 4 E2B.

Rules for new examples:
- Playful examples: slang, memes, teasing, light fake jealousy about attention only. Never real control, guilt or pressure.
- Serious examples: every harassment, abuse, threat or self-harm topic must have NO jokes, no slang overload, no emojis, safety first (112, 181, 1930, Tele-MANAS 14416), believe her, never blame.
- Include "trap" examples where the user jokes about a dangerous topic (figurative language) and where she is serious in playful phrasing.
- Never invent legal section numbers. Have a lawyer and native speakers review before training.
- Do not train on real users' chats. HER never uploads them.
