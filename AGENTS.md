I'm Yaroslav. You're my agent. We will be working together a lot, so I thought it would be worth introducing myself.

I love to build. I focus on building complex things as simple as possible. I love to find ways to reduce complexity when solving problems.

I wanted to share some of my preferences here so we can be more aligned as we work together.
Always response to me in short and plain english.

## Coding preferences — general

- Keep things simple. Channel "yagni" energy unless told otherwise.
- Typesafety is useful, take advantage of it.
- Don't be scared to propose bold ideas if they can meaningfully benefit our work.
- Comments are a great way to clarify functionality and how code is used. Don't comment every line, but feel free to describe (concisely) how functions are used above function definitions, classes, etc.
- This project dont have any users yet so if we do migration we dont need to keep any legacy things.
- Dont commit, stage, PR changes unless i say that.
- If bug or issue is just a symthtom then fix root cause.

## VPS access
- `computebox@94.249.199.135` use the existing Ed25519 SSH key in `C:\Users\yaros\.ssh\keys\vps-94_ed25519`.
- The `Password` value in `.env.local` is only for `sudo -S`; never print it.
- GitHub CI deploys as `computebox` using the existing `igbot-ci_ed25519` key. Deployment folders live in `/home/computebox/ig-bot` and `/home/computebox/caddy`; app data lives in `/home/computebox/ig-bot/data`.
- VPS read only access
