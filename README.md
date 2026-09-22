# pi-advisor

Fast focused-query advisor for Pi.

Ask one question, get a plan, a correction, or a stop signal. Each call sends
one message with no history and no tools, so latency stays flat.

This package is not published to npm. It is meant to be used from a local
checkout.

## Requirements

- Pi with extension support
- Node.js 22.19 or newer

The dev dependencies pin `@earendil-works/pi-*` at `0.84.4`. At runtime the
extension uses whatever Pi host loaded it, and falls back to the host's own
`completeSimple` before importing `@earendil-works/pi-ai/compat`.

## Install (local)

Clone or copy this directory somewhere permanent, then install it by path:

```bash
pi install /path/to/pi-advisor
```

Restart Pi or run `/reload`. Check that Pi sees the package:

```bash
pi list
```

Pi records the package path in `~/.pi/agent/settings.json` and loads the
extension from that directory. Moving or deleting the directory breaks the
install. Run `pi install` again with the new path. Pi reads the files in
place, so after `git pull` you only need `/reload`.

Project scope is also available. Pi loads it only after you trust the project:

```bash
pi install --local /path/to/pi-advisor
```

Try it without installing:

```bash
pi -e /path/to/pi-advisor
```

Remove it with:

```bash
pi remove /path/to/pi-advisor
```

This is a local package, so Pi does not install its dependencies. The only
bare imports are Pi packages the host provides. Run `npm install` to get the
dev dependencies for tests and type checking.

## Use

- **`/advisor`** opens a picker for the advisor model and reasoning level.
- **`advisor(question, context?)`** sends one focused question and returns one
  answer.

```text
advisor({
  question: "Split parser.ts or keep one file? Options: split vs keep. At stake: public API stability.",
  context: "src/parser.ts, 900 lines"
})
```

`question` is required. `context` is optional and should hold only a few lines:
file paths, error text, or constraints. Never paste history or tool output.

Limits: the question is cut at 4000 characters and the context at 2000, each
with an explicit `…[truncated N chars]` marker.

Failure behavior:

- an empty or whitespace-only question fails closed, with no model call
- a cancelled call returns no answer
- an empty model response is an error, not an empty answer
- provider errors are surfaced with their message

## What the model sees

The request is one user message with a fixed system prompt. The advisor is told
to answer with exactly one of: a plan, a correction, or a stop signal. It must
ground every claim in the question, mark claims as known, inferred, or unknown,
recommend the simplest sufficient action, and close with the single check that
would disprove its guidance.

No conversation history, no tools, no retries.

The tool also registers prompt guidelines so the model knows when to call it,
and re-adds them when codemode's `only` mode hides the tool declaration.

## Configure

`/advisor` asks for two things:

1. **Model**: the session model (default) or any model available in Pi.
2. **Reasoning level**: shown only for models that support reasoning. Pick
   `off` to send no reasoning.

The choice is saved to `~/.config/pi-advisor/config.json`, or
`$XDG_CONFIG_HOME/pi-advisor/config.json` when `XDG_CONFIG_HOME` is an absolute
path:

```json
{
  "modelKey": "anthropic/claude-sonnet-4-5",
  "effort": "low"
}
```

If the saved model is no longer available, the advisor falls back to the
session model. Selecting "Use session model" removes the override.

## Develop

```bash
npm install
npm run verify   # lint, format check, typecheck, tests
npm test         # 23 tests
```

Pi loads TypeScript extensions with jiti, so there is no build step. The tests
cover the advisor request shape, bounds, failure paths, state persistence, the
picker, and the tool integration.

## License

MIT
