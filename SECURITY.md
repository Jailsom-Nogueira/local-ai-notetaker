# Security policy

## Supported versions

This repository currently supports the latest code on the main branch.

## Reporting a vulnerability

Please open a private security advisory on the repository if GitHub Security
Advisories are enabled. Otherwise, contact the current maintainer privately before
publishing details.

## Security model

Notetaker is local-first desktop software built on Next.js. It is not a multi-user
SaaS application and does not include authentication or authorization.

Important properties:

- Audio files stay on the local host.
- The OpenAI review step sends transcript text only.
- API keys stay server-side and must be provided through environment variables or
  macOS Keychain.
- Runtime recordings and model binaries are ignored by Git.

## Deployment warning

If you expose this app beyond localhost, put it behind your own authentication,
TLS, request-size limits, and rate limits. The default app assumes trusted local use.
