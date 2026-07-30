# Varied world cup

This run evaluated 160 levels in five generations:

- population: 32 per generation;
- matches: 155;
- bot episodes: 12 per candidate;
- layouts: 63 surface, 56 tunnel, 41 mixed;
- bot-passing candidates: 142;
- champion: `G4-07`, mixed layout, fitness `0.874`;
- initial generation winner: fitness `0.871`.

The champion's own ancestry was:

```text
G0-24 mixed  fit=0.834
`-- G1-13 mixed  fit=0.834
    `-- G2-23 mixed  fit=0.800
        `-- G3-12 mixed  fit=0.818
            `-- G4-07 mixed  fit=0.874  CHAMPION
```

`tree.txt` contains all ancestry branches, parent-relative deltas, generation
summaries, and every tournament bracket. `report.json` is the same experiment
in machine-readable form. `champion.json` is the buildable neutral design and
`champion-preview.txt` is its human-readable greybox.

Reproduce the tournament:

```sh
mm level evolve \
  --seed varied-world-cup \
  --population 32 --generations 5 --mutation 0.22 \
  --width 56 --height 24 --difficulty 0.5 \
  --bots 6 --attempts 2 --max-steps 1800 \
  --tree generated-levels/evolution-tournament/tree.txt \
  --report generated-levels/evolution-tournament/report.json \
  -o generated-levels/evolution-tournament/champion.json
```
