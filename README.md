# makefun-sokoban-solver-01

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/tanusinap/makefun-sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/tanusinap/makefun-sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver: one program answers a set of 5 levels in
one run, writing each level's moves to `solution.txt`. It scores 1,000,000
(all 5 practice instances in exactly P* pushes) in under half a second.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<input> MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads `<input>/<id>/level.txt` (XSB) for each instance, writes
`out/<id>/solution.txt` (LURD moves, upper case marking a push).

## How it works

Each level is a hallway plus 1-4 rooms, and a box never leaves its room,
so the level splits into independent rooms and the optimum is the sum of
the rooms' optima. Inside a room the search is A* over pushes:

- **State**: the boxes' squares plus the player's reachable region (named
  by its lowest square), so two states with the same boxes and the same
  reachable region are one state.
- **Cost**: pushes so far. **Estimate**: the minimum-cost assignment of
  boxes to goals under precomputed push distances (a pull-BFS from each
  goal). Admissible, so the first solved state popped is push-optimal.
- **Deadlock pruning**: a box on a dead square (one from which no push
  reaches any goal) and a frozen 2x2 block of walls and boxes with a box
  off its goal. Both are sound, so optimality stands.
- **Deterministic**: ties break by (f, h, insertion order), the budget is
  a count of states (400,000 per room), never the clock. Two runs write
  identical bytes.

## Results

| Set | Score | Time |
| --- | --- | --- |
| Practice (kit) | 1,000,000 (13/16/29/47/60 pushes, all P*) | 0.37 s |
| 6 fresh drawn sets | 1,000,000 each | 0.29-0.79 s |
