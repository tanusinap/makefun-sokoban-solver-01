// Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// A push-optimal A* over pushes, room by room. Each level is a hallway plus
// 1-4 rooms; boxes never leave their room, so each room is solved on its own
// and the level's optimum is the sum of its rooms' optima. Inside a room the
// search is A* over pushes: a state is the boxes' squares plus the player's
// reachable region (named by its lowest square), the cost is pushes so far,
// and the estimate is the minimum-cost assignment of boxes to goals under
// precomputed push distances (admissible: every box must reach a distinct
// goal, and the distances ignore the other boxes). Deadlock pruning: a box
// on a dead square (one from which no push reaches any goal) and a frozen
// 2x2 block of walls and boxes with a box off its goal. Both prunings are
// sound, so the first solved state A* pops is push-optimal.
//
// Deterministic: the open list breaks ties by (f, h, insertion order), the
// search budget is a count of states, never the clock, and no randomness or
// wall clock is read anywhere. Two runs write identical bytes.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// The most states one room search keeps before it gives up: work, never the clock.
const MAX_STATES = 400_000;

// [dx, dy, walk letter, push letter]
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Parse an XSB level: # wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever it shows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * Push distances: dist[g][s] is the fewest pushes that move a box from
 * square s to goal g, ignoring the other boxes (a pull-BFS from each goal:
 * a box at y can be pushed to x when y and the player's square behind it,
 * y - d, are both open). Infinity when s cannot reach g.
 */
function pushDistances(level: Level): Int32Array[] {
  const { w, wall, goals } = level;
  const size = wall.length;
  const out: Int32Array[] = [];
  for (const g of goals) {
    const dist = new Int32Array(size).fill(-1);
    dist[g] = 0;
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const x = queue[qi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const y = x - d;
        // To push a box from y to x, the player stands at y - d.
        if (wall[y] || wall[y - d] || dist[y] !== -1) continue;
        dist[y] = dist[x]! + 1;
        queue.push(y);
      }
    }
    out.push(dist);
  }
  return out;
}

/** Whether each square can reach some goal (live) under the push distances. */
function liveSquares(dist: Int32Array[], size: number): Uint8Array {
  const live = new Uint8Array(size);
  for (const d of dist) {
    for (let s = 0; s < size; s++) if (d[s] !== -1) live[s] = 1;
  }
  return live;
}

/**
 * The minimum-cost assignment of boxes to goals under the push distances
 * (brute-force permutations: at most 4 boxes, 24 orders). Admissible: each
 * box must reach a distinct goal. Infinity when no assignment reaches.
 */
function heuristic(boxes: number[], dist: Int32Array[]): number {
  const n = boxes.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  let best = Infinity;
  // Heap's algorithm over the goal permutation, in a fixed order.
  const perm: number[] = order.slice();
  const c = new Array<number>(n).fill(0);
  const cost = (): number => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = dist[perm[i]]![boxes[i]!]!;
      if (d === -1) return Infinity;
      s += d;
    }
    return s;
  };
  best = Math.min(best, cost());
  let i = 0;
  while (i < n) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!;
      const t = perm[j]!;
      perm[j] = perm[i]!;
      perm[i] = t;
      best = Math.min(best, cost());
      c[i]!++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
  return best;
}

/** The squares the player reaches from `from` with `occupied` in the way; marks `seen` with `stamp`, returns the lowest. */
function reach(level: Level, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters. */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The square the player stands on after `moves` (LURD, case aside) from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The push-optimal solution of `level` by A* over pushes, searching at most
 * `maxStates` states: {pushes, moves}, or null when the search gives up.
 */
function solveAStar(level: Level, maxStates: number): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const dist = pushDistances(level);
  const live = liveSquares(dist, size);
  if (level.boxes.some((b) => !live[b])) return null;
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b] === 1);
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // States in creation order: boxes, player square, parent, the push that made them.
  const sBoxes: number[][] = [level.boxes];
  const sPlayer: number[] = [level.player];
  const sG: number[] = [0];
  const parent: number[] = [-1];
  const keyOf = (boxes: number[], low: number): string => `${low}|${boxes.join(',')}`;
  const best = new Map<string, number>();
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = reach(level, occupied, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) occupied[b] = 0;
  best.set(keyOf(level.boxes, startLow), 0);

  // The open list: a binary heap on (f, h, insertion order).
  const heap: [number, number, number, number][] = [];
  let seq = 0;
  const h0 = heuristic(level.boxes, dist);
  if (h0 === Infinity) return null;
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  heapPush([h0, h0, seq++, 0]);

  let found = -1;
  while (heap.length > 0 && found < 0) {
    const [, , , s] = heapPop();
    const boxes = sBoxes[s]!;
    const g = sG[s]!;
    // A stale heap entry: a better path to this state was already recorded.
    for (const b of boxes) occupied[b] = 1;
    const low = reach(level, occupied, sPlayer[s]!, seen, ++stamp, stack);
    const here = stamp;
    if (best.get(keyOf(boxes, low)) !== s) {
      for (const b of boxes) occupied[b] = 0;
      continue;
    }
    if (solved(boxes)) {
      found = s;
      for (const b of boxes) occupied[b] = 0;
      break;
    }
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        // The player must reach the square behind the box; the destination must be open and live.
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let key = '';
        let next: number[] | null = null;
        let h = Infinity;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          const nextLow = reach(level, occupied, b, mark, ++stamp, stack);
          key = keyOf(next, nextLow);
          const prev = best.get(key);
          if (prev === undefined || sG[prev]! > g + 1) h = heuristic(next, dist);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || next === null || h === Infinity) continue;
        const prev = best.get(key);
        if (prev !== undefined && sG[prev]! <= g + 1) continue;
        if (sBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        const t2 = sBoxes.length;
        sBoxes.push(next);
        sPlayer.push(b);
        sG.push(g + 1);
        parent.push(s);
        best.set(key, t2);
        if (solved(next)) {
          found = t2;
          break;
        }
        heapPush([g + 1 + h, h, seq++, t2]);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = sBoxes[s]!;
    const from = boxes.find((b) => !nextBoxes.includes(b))!;
    const to = nextBoxes.find((b) => !boxes.includes(b))!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done: boolean;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each part left that
 * holds a box is a room. Null when some part holds more or fewer boxes than
 * goals, or a box starts in the hallway.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const dist = pushDistances(level);
  const live = liveSquares(dist, wall.length);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * Solve a level room by room: each room's push-optimal solution in turn, the
 * other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. Falls back
 * to a whole-level search when the level is no set of rooms.
 */
function solve(text: string): string {
  const level = parseLevel(text);
  const rooms = roomsOf(level);
  if (rooms === null) {
    const whole = solveAStar(level, MAX_STATES);
    return whole === null ? '' : whole.moves;
  }
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other !== room) for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solveAStar(sub, MAX_STATES);
    if (solved === null) return '';
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
