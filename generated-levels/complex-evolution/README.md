# Complex evolution tournaments

Two wide expert-level searches are preserved here.

## Large search

- 448 generated 96×32 levels across seven generations;
- 441 tournament matches;
- 5,376 bot/persona episodes;
- dash, double jump, wall jump, ladders, gems, gaps, and tunnels enabled;
- 446 candidates passed bot validation;
- 241 mixed, 139 tunnel, and 68 surface candidates;
- mean complexity `0.876`, maximum complexity `1.000`;
- champion `G1-35`: mixed, fitness `0.881`, complexity `0.930`.

`tree.txt` and `report.json` contain the complete experiment. `levels/`
contains the top 32 overall survivors from this run.

## Diversity-preserving search

The second tournament generated another 96 levels and retained 30 strong,
distinct survivors with a layout quota:

```text
10 surface + 10 tunnel + 10 mixed
```

They are stored under `diverse-levels/` as paired neutral JSON designs and
ASCII previews. Its `manifest.json` contains fitness, complexity, bot success,
and observed movement-ability usage for every retained level.

Representative previews:

- `diverse-levels/001-G0-30.txt` — mixed expedition;
- `diverse-levels/002-G1-04.txt` — enclosed tunnel gauntlet;
- `diverse-levels/014-G0-17.txt` — complex surface traversal.

Reproduce the large search:

```sh
mm level evolve \
  --seed complex-world-cup \
  --population 64 --generations 7 --mutation 0.28 \
  --objective complex --profile exploration \
  --width 96 --height 32 --difficulty 0.72 \
  --bots 6 --attempts 2 --max-steps 3200 \
  --dash --double-jump --wall-jump \
  --tree generated-levels/complex-evolution/tree.txt \
  --report generated-levels/complex-evolution/report.json \
  --archive generated-levels/complex-evolution/levels --keep 32 \
  -o generated-levels/complex-evolution/champion.json
```
