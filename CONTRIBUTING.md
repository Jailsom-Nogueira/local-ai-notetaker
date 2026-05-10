# Contributing

Thanks for considering a contribution.

## Development workflow

```bash
npm ci
cp .env.example .env.local
npm run setup:model
npm run dev
```

Before opening a pull request, run:

```bash
npm run check
```

## Language policy

Documentation, code comments, commit messages, and developer-facing strings must be
written in English. User-interface copy may be localized; Portuguese UI text is allowed
when it is intentionally part of the product experience.

## Code style

- Keep server-only code under route handlers or `src/lib/server.ts`.
- Do not import server-only modules into Client Components.
- Prefer explicit runtime validation for request inputs.
- Do not log transcripts, API keys, request bodies, or environment dumps.
- Keep comments focused on why the code behaves a certain way.

## Privacy policy for contributions

Do not commit:

- `.env*` files, except `.env.example`.
- Local recordings or transcripts.
- Whisper model binaries.
- Build output or dependency folders.

Run `npm run check:publication` if you are unsure.
