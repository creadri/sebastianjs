---
name: update-mermaid
description: Upgrade SebastianJS to the latest published @mermaid-js/mermaid-cli and the exact mermaid version that release pins, refresh the sample corpus and vendored KaTeX, then run the suite and the deviation gate and fix what the upgrade broke. Use this whenever the user wants to update, upgrade, bump, or sync mermaid or mermaid-cli, asks whether a newer mermaid is available, says the pin is stale or `npm run check:mermaid` is failing, or reports renders breaking after a dependency bump — even if they just say "update mermaid" or "get us on the latest mermaid" without naming the procedure.
---

# Updating mermaid in SebastianJS

## The invariant everything else serves

This package renders mermaid without a browser, and it proves it is correct by
comparing its output against real Chrome driven by `mermaid-cli`. That
comparison is only meaningful if **both sides run the same mermaid build**. So
`mermaid` is pinned to an exact version — the one `mermaid-cli`'s own lockfile
pins — and the sample corpus is cloned from that same `mermaid@<version>` tag.

Keep that in mind, because it explains why the steps are ordered the way they
are and why "just bump mermaid to latest" is the one thing not to do. The
latest published `mermaid` is usually *ahead* of what the current `mermaid-cli`
pins; following `mermaid` directly would leave the two renderers comparing
different pictures, which is exactly how mermaid 11.17's `new CSSStyleSheet()`
reached users past a green suite (`53f77ce`).

`mermaid-cli` is the thing to follow. `mermaid` comes along for the ride.

## Run the upgrade in this order

The order is load-bearing: `sync:mermaid` reads the *installed* `mermaid-cli`
to decide the pin, and `fetch:samples` reads the *pinned* `mermaid` to decide
which tag to clone. Doing these out of order silently produces a corpus that
does not match the renderer.

```bash
npm install -D @mermaid-js/mermaid-cli@latest   # 1. move the reference renderer
npm run sync:mermaid                            # 2. pin mermaid to what it locks
npm install                                     # 3. install that mermaid
npm run vendor:katex                            # 4. only if KaTeX moved (see below)
npm run fetch:samples                           # 5. refresh corpus at the matching tag
npm test                                        # 6. cheap, blind
npm run deviation                               # 7. the actual gate
```

Report the versions before and after, so the user can see the size of the jump.
A major bump (11 → 12) deserves a heads-up before you start fixing: mermaid
majors change renderer internals, and the work is likely to be more than
forwarding a global.

### Step 4 is easy to miss

`npm run vendor:katex` is absent from the README's procedure, but
`scripts/vendor-katex-css.mjs` asks to be re-run after bumping mermaid, and it
is right. KaTeX is **not** a declared dependency — it arrives transitively
through mermaid — and this repo vendors the two things mermaid cannot bundle:
the TTF faces in `fonts/KaTeX/` and the font-selecting subset of `katex.css`
baked into `src/geometry/katex-css.js`. Without them every formula glyph gets
measured in the diagram's body font at the wrong size.

So compare `node_modules/katex/package.json` before and after step 3. If the
version moved, run it and commit the regenerated CSS and fonts. If it did not,
skip it and say so.

### If `sync:mermaid` cannot reach the pin

It reads `mermaid-cli`'s `package-lock.json` from its GitHub tag, because npm
strips lockfiles from published tarballs. That can fail on a tag-naming change
or a lockfile layout change. The invariant matters more than the tool: find the
mermaid version that release actually resolves, write the exact version into
`package.json` yourself, and note that the script needs attention.

## Where upgrade breakage lands

Work the symptom, not the file. Most of what an upgrade breaks is one of these
five things, and none of them are geometry bugs.

**`X is not defined`, thrown before any diagram appears.**
`withGlobalDOM` in `src/sebdom.js` forwards an explicit list of browser globals
onto `globalThis`, because mermaid and d3 read them directly instead of taking
an injected document. A mermaid release that starts using a new global fails
every render. Add it to the `keys` list with a one-line comment saying which
mermaid version needed it and what broke — that list is a history of exactly
this, from `screen` (broke C4) to `Option` (broke sequence) to `CSSStyleSheet`
(broke everything).

**A `ReferenceError` *after* a correct SVG was returned, possibly killing the
process.** mermaid sometimes starts async work and never awaits it; when the
continuation resumes, `withGlobalDOM` has already torn the globals down. The
existing cure is the `settle()` tick at the bottom of `src/sebdom.js`
(`b43026b`). If a new release leaks work that one tick does not cover, widen
what `settle` waits for rather than reintroducing the globals — the stray work
is drawing into a container that is about to be removed, so it only has to not
fail.

**A test that parses mermaid's output finds nothing.** Mermaid changes its DOM
id and class schemes between releases. `__tests__/comparison.test.js` strips a
per-render id prefix to line nodes up across renderers, and `53f77ce` had to
fix that same normalizer when the `flowchart-A-0` scheme changed. These tests
guard against a vacuous pass (`expect(shared.length).toBeGreaterThanOrEqual(5)`)
— respect that guard, and if you update a normalizer, confirm it still matches
real node counts instead of relaxing the assertion.

**The two renderers disagree wildly on math-bearing samples (tens of percent).**
Suspect config drift before geometry. The mermaid config that `render()` defaults
to is mirrored in three other places, and they have to agree or the suite
measures the gap between two different pictures rather than a rendering error:

| File | Role |
|---|---|
| `src/index.js:~278` | source of truth (`forceLegacyMathML`, `htmlLabels`, …) |
| `scripts/deviation-suite.mjs:~145` | what mmdc is told for the parity sweep |
| `scripts/compare-chrome.mjs:~38` | what mmdc is told for ad-hoc comparison |
| `__tests__/comparison.test.js:~57` | the single fast parity check |

A missing `forceLegacyMathML` in the deviation suite once reported 53% height
deviation purely because Chrome typeset native MathML while we typeset KaTeX
HTML. If an upgrade adds or renames a default in `src/index.js`, propagate it.

**`versions.test.js` fails on a nested mermaid.** It asserts there is no
`node_modules/@mermaid-js/mermaid-cli/node_modules/mermaid`, because a nested
copy means mmdc and we render with two different builds and the whole
comparison is meaningless. The fix is to make the pin exactly what the CLI
pins — not to delete the assertion. If npm still nests after a correct pin,
remove `node_modules` and reinstall so the tree can hoist.

## The corpus refresh has a trap worth knowing

`fetch:samples` numbers samples by their order inside each demo HTML file
(`flowchart__39.mmd`). A mermaid upgrade that adds, removes or reorders demo
blocks **renumbers the corpus**, and `KNOWN_DEVIATIONS` in
`scripts/deviation-suite.mjs` is keyed by those filenames.

So after refreshing, the entries can point at entirely different diagrams. Open
the samples the listed keys now resolve to and check they still match their
stated reason — the math-label entries should still be math labels, the
line-breaking entries should still carry `fa:` labels. Re-key or remove entries
that no longer describe what they point at, and say so in the summary. The
suite helps here: it reports any listed sample that has started passing.

New diagram types are the other corpus change to surface. `ALLOWED_DIAGRAMS`
gates what gets compared, so a diagram type new in this mermaid is simply not
measured until someone adds it. Mention it as a follow-up rather than adding it
mid-upgrade — it is new coverage, not an upgrade fix, and it will likely bring
its own deviations.

## What to fix, and where to stop

Fix what the upgrade mechanically broke: forwarded globals, in-flight work,
changed id and class schemes, mirrored config defaults, renamed mermaid APIs,
re-keyed known-deviation entries. These have a clear right answer and you can
tell you are done because the failure goes away for a reason you can state.

Pixel-level parity work is a different activity — measurement and font-metric
research, the kind in `b43026b` — and it does not belong in an upgrade run. If
deviations remain once the mechanical fixes are in, **measure them and report
them**. Give the sample, the number, and what you learned about where the
pixels go. The user will decide whether to chase it.

Two things to avoid, because they convert a visible problem into an invisible
one:

- Do not raise `POSITION_DEVIATION_THRESHOLD` or
  `VIEWBOX_WIDTH_REL_THRESHOLD`. They are set far above measured noise
  (~0.03px) and far below anything a real regression produces; moving them
  blinds the gate permanently to buy a green run once.
- Do not add new entries to `KNOWN_DEVIATIONS` to silence a new failure. That
  list means "understood and accepted", and every entry carries a measured
  reason. An unexplained new deviation is a finding, not an entry.

Run `npm test` and `npm run deviation` both, every time, even when the jest
suite is green. The jest suite cannot see a parity regression — that is the
entire reason the deviation gate exists, and the two bugs `b43026b` fixed were
only found by chasing its numbers. Read the summary it prints:
`unexpectedFailures` should be empty and `avgRaw` should stay in the hundredths
of a pixel. If `avgRaw` has jumped by an order of magnitude, that is a
regression even if nothing crossed a threshold.

The deviation suite needs Chrome and the Open Sans font resolvable through
fontconfig. `comparison.test.js` *skips* rather than compares mismatched fonts,
so a skip there is not a pass — if it skipped, say so, because the fast parity
check did not actually run.

## Then update the docs

- **CHANGELOG.md** — add an entry in the existing style: what moved, and for
  each fix what broke and why, not just that something was fixed.
- **README.md** — update prose that names specific versions where the upgrade
  made it stale. The pinning rationale in *Mermaid is pinned, deliberately*
  cites mermaid 11.17 as its example; keep the example that best illustrates the
  point rather than mechanically swapping in the new version.
- **Benchmark block** — re-run `npm run benchmark` and refresh the region
  between the `BENCHMARK_END` markers in README.

## Leave the work in the tree

Do not commit, branch, or push. The user reviews and commits.

Close with a summary covering:

1. **Versions** — `mermaid-cli` and `mermaid` before → after, plus KaTeX if it moved.
2. **Fixes** — each one as the symptom, the cause, and the file.
3. **Test results** — `npm test` (and anything that *skipped*, with why) and the
   deviation summary: `unexpectedFailures`, `avgRaw`, sample count.
4. **Remaining deviations** — measured, with what you learned; explicitly
   flagged as not fixed.
5. **Follow-ups** — new diagram types not yet in `ALLOWED_DIAGRAMS`, re-keyed
   known deviations, anything that needs a human decision.

If the upgrade cannot be completed — a mermaid major changes an API this package
depends on more deeply than an upgrade run can absorb — stop and report with the
same structure. A clear account of what broke and how far you got is worth more
than a half-applied upgrade, and leaving it in the tree means nothing is lost.
