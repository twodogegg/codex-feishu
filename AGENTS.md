# Repository Guidelines

## Project Structure & Module Organization
The runtime lives in `src/`. Keep startup and orchestration code in `src/app/`, Feishu API adapters in `src/feishu/`, Codex-facing integration in `src/codex/`, and worker lifecycle code in `src/workers/`. Database schema and repositories belong in `src/db/`. Shared types and low-level helpers stay in `src/types/` and `src/shared/`. Tests live in `test/` and should stay close in naming to the module they verify, such as `test/feishu-client.test.ts`. Design, rollout, and handoff material belongs in `docs/`.

## Build, Test, and Development Commands
Use Node.js 20+ and `npm`; this repository is locked with `package-lock.json`.

- `npm run dev` starts the app with `tsx src/index.ts`.
- `npm run build` compiles TypeScript into `dist/`.
- `npm run start` runs the compiled server from `dist/index.js`.
- `npm run check` performs a strict TypeScript check without output.
- `npm test` runs the Node test suite with `node --test --import tsx`.

Copy `.env.example` to `.env` before local runs. Set Feishu credentials and bot identity at minimum: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, and `CODEX_FEISHU_BOT_OPEN_ID`.

## Coding Style & Naming Conventions
Write strict TypeScript using ESM modules and explicit `.js` import suffixes in source files. Follow the existing style: 2-space indentation, double quotes, semicolons, and small focused modules. Prefer `kebab-case` for filenames (`command-service.ts`), `PascalCase` for classes, and `camelCase` for functions, variables, and repository methods. Keep environment parsing centralized in `src/config/environment.ts` and avoid scattering `process.env` reads.

## Testing Guidelines
Tests use the built-in `node:test` runner with `assert/strict`. Name files `*.test.ts` and place them under `test/`. Add or update tests whenever command parsing, message routing, worker state, or persistence behavior changes. Favor deterministic fixtures over live Feishu calls. Run `npm test` and `npm run check` before opening a PR.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits, for example `feat: bootstrap codex feishu mvp` and `fix: stabilize feishu callbacks and thread cards`. Keep that format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. PRs should explain the behavior change, note config or schema impacts, link the relevant issue, and include screenshots or message/card samples when Feishu-facing output changes.

## Security & Configuration Tips
Never commit `.env`, runtime databases, or generated files under `dist/`, `data/`, or `tmp/`. Use `.env.example` as the public template, and prefer local test doubles for secrets, tokens, and Feishu event payloads.
