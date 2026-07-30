# Bot-validated generated levels

These greyboxes were selected by `mm level simulate`. Each directory contains:

- `level.json` — the selected neutral level design;
- `preview.txt` — the exact generated ASCII grid;
- `replay.json` — the planner's reproducible completion proof;
- `report.json` — the full ranked search report;
- `candidates.jsonl` — metrics for every candidate considered.

| Preset             |  Size | Layout  | Abilities/content                  | Beginner | Intermediate | Expert |     Proof |
| ------------------ | ----: | ------- | ---------------------------------- | -------: | -----------: | -----: | --------: |
| `small-easy`       | 32×18 | surface | jump, platforms, no gems/ladders   |      33% |          89% |   100% | 282 steps |
| `medium-adventure` | 48×22 | mixed   | descent, chambers, ladders, gems   |      67% |          44% |   100% | 458 steps |
| `large-hard`       | 72×28 | tunnel  | dash, double jump, wall jump, gems |       0% |          11% |   100% | 307 steps |
| `wide-expert`      | 96×30 | mixed   | long cave expedition, full moves   |      44% |           0% |   100% | 335 steps |

Difficulty here is behavioral rather than just the generator's numeric input:
the hard presets are levels that the exact planner and expert personas finish
but noisy lower-skill personas usually do not.

Regenerate the complete search, for example:

```sh
mm level simulate \
  --seed long-expedition-v3 \
  --layout mixed \
  --width 96 --height 30 --difficulty 0.86 \
  --levels 10 --rounds 2 --bots 12 --attempts 3 --max-steps 2400 \
  --without ladders --dash --double-jump --wall-jump \
  --json \
  -o generated-levels/wide-expert/level.json \
  --report generated-levels/wide-expert/report.json \
  --replay generated-levels/wide-expert/replay.json \
  --dataset generated-levels/wide-expert/candidates.jsonl
```
