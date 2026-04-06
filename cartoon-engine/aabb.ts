/**
 * Machinist Mario Engine — AABB (Axis-Aligned Bounding Box)
 *
 * The "Safety Cage" of the No-Inertia OS.  In a machine shop, this is the
 * Work Envelope — the boundary that prevents Mario's CNC drill from
 * crashing into a V-block clamp or stepping outside the printer bed.
 *
 * ── Why AABB and not OBB ─────────────────────────────────────────────────────
 * An Oriented Bounding Box (OBB) can wrap objects more tightly, but the
 * overlap test requires 15 separating-axis tests per pair.  An AABB only
 * needs 3.  For 144,000 sparks this means ~48 million fewer operations per
 * frame — the definition of "No-Inertia."
 *
 * ── Immutability ──────────────────────────────────────────────────────────────
 * Every method returns a NEW AABB.  The receiver is never mutated.
 * This makes the safety cage composable and fully traceable in logs.
 *
 * ── Octree spatial partitioning ──────────────────────────────────────────────
 * For massive particle counts, a single AABB test per particle is O(n²).
 * The Octree breaks space into 8 recursive sub-cells, reducing collision
 * checks to O(n log n) — the same technique used by Hollywood VFX studios
 * for cloth simulation and crowd physics.
 *
 * Usage:
 *   import { AABB, Octree } from './aabb';
 *
 *   // Machine work envelope
 *   const bed = new AABB(new Vector3(0,0,0), new Vector3(220, 220, 250));
 *
 *   // Build guitar bounding box from vertex cloud
 *   let guitar = AABB.empty();
 *   for (const spark of vertices) guitar = guitar.expandByPoint(spark);
 *
 *   // Safety check before cutting
 *   if (!bed.containsAABB(guitar)) throw new Error('Guitar exceeds printer bed!');
 *
 *   // V-block clamp collision
 *   const clamp = new AABB(new Vector3(45,45,-5), new Vector3(55,55,40));
 *   if (guitar.intersects(clamp)) healPath(guitar, clamp);
 */

import { Vector3 } from './vector3';

// ---------------------------------------------------------------------------
// Ray — for ray-box intersection (CNC tool-path simulation)
// ---------------------------------------------------------------------------

/**
 * A ray originating at `origin`, pointing in `direction`.
 * `direction` is normalised internally.
 */
export interface Ray {
  origin:    Vector3;
  direction: Vector3;
}

/** Result of a ray–AABB intersection test. */
export interface RayHit {
  hit:    boolean;
  /** Entry distance along the ray (< 0 means ray starts inside the box). */
  tNear:  number;
  /** Exit distance along the ray. */
  tFar:   number;
  /** World position of the entry point (if hit). */
  point:  Vector3 | null;
  /** Outward-facing normal of the hit face. */
  normal: Vector3 | null;
}

// ---------------------------------------------------------------------------
// AABB
// ---------------------------------------------------------------------------

/**
 * AABB — Axis-Aligned Bounding Box.
 *
 * An immutable box defined by its minimum and maximum corners.
 * All coordinates are in the same unit as Vector3 (metres or millimetres —
 * caller's choice; the math is unit-agnostic).
 */
export class AABB {

  /** Minimum corner (lower-left-back). */
  public readonly min: Vector3;
  /** Maximum corner (upper-right-front). */
  public readonly max: Vector3;

  constructor(
    min: Vector3 = new Vector3( Infinity,  Infinity,  Infinity),
    max: Vector3 = new Vector3(-Infinity, -Infinity, -Infinity)
  ) {
    this.min = min;
    this.max = max;
  }

  // ── Static factories ───────────────────────────────────────────────────────

  /** An empty AABB that will expand correctly on the first expandByPoint call. */
  static empty(): AABB {
    return new AABB();
  }

  /** An AABB that contains every possible point (the entire universe). */
  static infinite(): AABB {
    return new AABB(
      new Vector3(-Infinity, -Infinity, -Infinity),
      new Vector3( Infinity,  Infinity,  Infinity)
    );
  }

  /**
   * Build an AABB from a cloud of points (e.g., all guitar vertices).
   * O(n) — one pass through the array.
   */
  static fromPoints(points: Vector3[]): AABB {
    let box = AABB.empty();
    for (const p of points) box = box.expandByPoint(p);
    return box;
  }

  /**
   * Build an AABB centred at `centre` with half-extents `halfSize`.
   * Useful for quickly placing a V-block clamp at a known position.
   */
  static fromCentreHalfSize(centre: Vector3, halfSize: Vector3): AABB {
    return new AABB(centre.subtract(halfSize), centre.add(halfSize));
  }

  /** Build an AABB from a centre point and a uniform radius (a bounding sphere approximation). */
  static fromSphere(centre: Vector3, radius: number): AABB {
    const r = new Vector3(radius, radius, radius);
    return new AABB(centre.subtract(r), centre.add(r));
  }

  // ── Expansion ─────────────────────────────────────────────────────────────

  /**
   * expandByPoint
   *
   * Hand-over-hand growth: returns a new AABB that is the smallest box
   * containing both this box and the new point (spark).
   *
   * @param p  The new point to include.
   */
  public expandByPoint(p: Vector3): AABB {
    return new AABB(
      new Vector3(
        Math.min(this.min.x, p.x),
        Math.min(this.min.y, p.y),
        Math.min(this.min.z, p.z)
      ),
      new Vector3(
        Math.max(this.max.x, p.x),
        Math.max(this.max.y, p.y),
        Math.max(this.max.z, p.z)
      )
    );
  }

  /**
   * expandByAABB
   *
   * Returns the union of this box and another — the smallest box containing both.
   * Used to merge a gear AABB with a neck AABB to get the full guitar AABB.
   */
  public expandByAABB(other: AABB): AABB {
    return new AABB(
      new Vector3(
        Math.min(this.min.x, other.min.x),
        Math.min(this.min.y, other.min.y),
        Math.min(this.min.z, other.min.z)
      ),
      new Vector3(
        Math.max(this.max.x, other.max.x),
        Math.max(this.max.y, other.max.y),
        Math.max(this.max.z, other.max.z)
      )
    );
  }

  /**
   * expandByScalar
   *
   * Uniformly inflate the box by `delta` on all six faces.
   * Negative delta shrinks the box.  Used to add clearance around a clamp.
   */
  public expandByScalar(delta: number): AABB {
    const d = new Vector3(delta, delta, delta);
    return new AABB(this.min.subtract(d), this.max.add(d));
  }

  // ── Geometric properties ──────────────────────────────────────────────────

  /** Centre of the box. */
  get centre(): Vector3 { return this.min.midpoint(this.max); }

  /** Size vector (max − min) in each dimension. */
  get size(): Vector3 { return this.max.subtract(this.min); }

  /** Half-extents (size / 2). */
  get halfExtents(): Vector3 { return this.size.scale(0.5); }

  /** Volume of the box. */
  get volume(): number {
    const s = this.size;
    if (s.x < 0 || s.y < 0 || s.z < 0) return 0;
    return s.x * s.y * s.z;
  }

  /** Surface area (used by BVH cost heuristic). */
  get surfaceArea(): number {
    const s = this.size;
    if (s.x < 0 || s.y < 0 || s.z < 0) return 0;
    return 2 * (s.x*s.y + s.y*s.z + s.z*s.x);
  }

  /** True if the box has been initialised (contains at least one point). */
  get isEmpty(): boolean {
    return this.min.x > this.max.x ||
           this.min.y > this.max.y ||
           this.min.z > this.max.z;
  }

  // ── Containment & intersection ────────────────────────────────────────────

  /**
   * contains
   *
   * Dimension-Jump safety check: returns true if point p is strictly inside
   * (or on the boundary of) this bounding box.
   *
   * Used for:
   *   • Printer-bed bounds check: printerBed.contains(toolPosition)
   *   • Machine envelope:         envelope.contains(nextToolMove)
   *   • Guitar-in-box test:       workArea.contains(guitarVertex)
   */
  public contains(p: Vector3): boolean {
    return (
      p.x >= this.min.x && p.x <= this.max.x &&
      p.y >= this.min.y && p.y <= this.max.y &&
      p.z >= this.min.z && p.z <= this.max.z
    );
  }

  /**
   * containsAABB
   *
   * Returns true if `other` is entirely inside this box.
   * Used to verify that the full guitar AABB fits inside the printer bed.
   */
  public containsAABB(other: AABB): boolean {
    return (
      other.min.x >= this.min.x && other.max.x <= this.max.x &&
      other.min.y >= this.min.y && other.max.y <= this.max.y &&
      other.min.z >= this.min.z && other.max.z <= this.max.z
    );
  }

  /**
   * intersects
   *
   * Crash detection: returns true if this box and `other` share any volume.
   *
   * Uses the Separating Axis Theorem (SAT) with 3 axes — the minimum
   * possible test for AABBs.  Two AABBs do NOT intersect if and only if
   * they are separated along at least one axis.
   *
   * Used for:
   *   • Tool vs. V-block clamp collision
   *   • Gear mesh interference check
   *   • Character vs. obstacle detection
   */
  public intersects(other: AABB): boolean {
    return (
      this.min.x <= other.max.x && this.max.x >= other.min.x &&
      this.min.y <= other.max.y && this.max.y >= other.min.y &&
      this.min.z <= other.max.z && this.max.z >= other.min.z
    );
  }

  /**
   * intersection
   *
   * Returns the AABB representing the overlapping volume of this and `other`.
   * Returns an empty AABB if they do not intersect.
   */
  public intersection(other: AABB): AABB {
    const minX = Math.max(this.min.x, other.min.x);
    const minY = Math.max(this.min.y, other.min.y);
    const minZ = Math.max(this.min.z, other.min.z);
    const maxX = Math.min(this.max.x, other.max.x);
    const maxY = Math.min(this.max.y, other.max.y);
    const maxZ = Math.min(this.max.z, other.max.z);

    if (minX > maxX || minY > maxY || minZ > maxZ) return AABB.empty();
    return new AABB(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
  }

  // ── Distance & closest point ───────────────────────────────────────────────

  /**
   * closestPoint
   *
   * Returns the closest point on (or inside) this box to the given point p.
   * If p is inside the box, returns p itself.
   *
   * Used for:
   *   • Finding the nearest safe tool position to a collided target
   *   • "Self-healing" path recalculation: snap the tool back to the boundary
   */
  public closestPoint(p: Vector3): Vector3 {
    return new Vector3(
      Math.max(this.min.x, Math.min(this.max.x, p.x)),
      Math.max(this.min.y, Math.min(this.max.y, p.y)),
      Math.max(this.min.z, Math.min(this.max.z, p.z))
    );
  }

  /**
   * distanceTo
   *
   * Minimum Euclidean distance from the box surface to point p.
   * Returns 0 if p is inside the box.
   */
  public distanceTo(p: Vector3): number {
    return this.closestPoint(p).distanceTo(p);
  }

  /**
   * distanceToAABB
   *
   * Minimum distance between the surfaces of two AABBs.
   * Returns 0 if they intersect.
   */
  public distanceToAABB(other: AABB): number {
    const dx = Math.max(0, Math.max(this.min.x - other.max.x, other.min.x - this.max.x));
    const dy = Math.max(0, Math.max(this.min.y - other.max.y, other.min.y - this.max.y));
    const dz = Math.max(0, Math.max(this.min.z - other.max.z, other.min.z - this.max.z));
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  // ── Ray intersection ───────────────────────────────────────────────────────

  /**
   * raycast
   *
   * Ray–AABB intersection using the slab method (Amy Williams et al., 2005).
   *
   * For each pair of parallel planes (slabs), compute the ray's entry (t_near)
   * and exit (t_far) distances.  The ray hits the box if and only if:
   *   max(t_near_x, t_near_y, t_near_z) ≤ min(t_far_x, t_far_y, t_far_z)
   *
   * Applications:
   *   • CNC tool-path ray simulation: does this rapid move cut through the workpiece?
   *   • Aero ray-tracing: does the wing leading edge intersect the airflow domain?
   *   • Android touch ray: does the user's finger tap intersect the 3D gear?
   *
   * @param ray        The ray to test.
   * @param maxDist    Maximum search distance.  Default: Infinity.
   */
  public raycast(ray: Ray, maxDist = Infinity): RayHit {
    const dir  = ray.direction.normalize();
    const orig = ray.origin;

    // Avoid division by zero with a tiny epsilon
    const invDx = dir.x === 0 ? Infinity : 1 / dir.x;
    const invDy = dir.y === 0 ? Infinity : 1 / dir.y;
    const invDz = dir.z === 0 ? Infinity : 1 / dir.z;

    const tx1 = (this.min.x - orig.x) * invDx;
    const tx2 = (this.max.x - orig.x) * invDx;
    const ty1 = (this.min.y - orig.y) * invDy;
    const ty2 = (this.max.y - orig.y) * invDy;
    const tz1 = (this.min.z - orig.z) * invDz;
    const tz2 = (this.max.z - orig.z) * invDz;

    let tNear = Math.max(
      Math.min(tx1, tx2),
      Math.min(ty1, ty2),
      Math.min(tz1, tz2)
    );
    let tFar = Math.min(
      Math.max(tx1, tx2),
      Math.max(ty1, ty2),
      Math.max(tz1, tz2)
    );

    if (tNear > tFar || tFar < 0 || tNear > maxDist) {
      return { hit: false, tNear, tFar, point: null, normal: null };
    }

    // Entry normal: which slab did we enter last?
    const tEntry = tNear;
    let normal: Vector3;
    const txN = Math.min(tx1, tx2);
    const tyN = Math.min(ty1, ty2);
    const tzN = Math.min(tz1, tz2);

    if (txN >= tyN && txN >= tzN) {
      normal = new Vector3(dir.x < 0 ? 1 : -1, 0, 0);
    } else if (tyN >= txN && tyN >= tzN) {
      normal = new Vector3(0, dir.y < 0 ? 1 : -1, 0);
    } else {
      normal = new Vector3(0, 0, dir.z < 0 ? 1 : -1);
    }

    const point = orig.add(dir.scale(Math.max(0, tEntry)));
    return { hit: true, tNear, tFar, point, normal };
  }

  // ── Self-healing path correction ──────────────────────────────────────────

  /**
   * clampPoint
   *
   * "Self-Healing Repo" (Cart 06): if a tool position exceeds the safety cage,
   * clamp it back to the nearest valid point on the boundary.
   *
   * Returns the original point if it is already inside the box.
   */
  public clampPoint(p: Vector3): Vector3 {
    return this.closestPoint(p);
  }

  /**
   * clampSegment
   *
   * Clips a line segment to the box using the Liang–Barsky algorithm.
   * Returns the clipped start and end points, or null if the segment
   * is entirely outside the box.
   *
   * Used by GCodeInterpreter to trim a G1 move that exits the work envelope,
   * automatically healing the path to stop at the boundary.
   *
   * @param a  Segment start.
   * @param b  Segment end.
   */
  public clampSegment(a: Vector3, b: Vector3): [Vector3, Vector3] | null {
    const d   = b.subtract(a);
    let t0    = 0;
    let t1    = 1;

    const dims: [number, number, number][] = [
      [d.x, this.min.x - a.x, this.max.x - a.x],
      [d.y, this.min.y - a.y, this.max.y - a.y],
      [d.z, this.min.z - a.z, this.max.z - a.z],
    ];

    for (const [p, q1, q2] of dims) {
      if (Math.abs(p) < 1e-12) {
        if (q1 > 0 || q2 < 0) return null;
        continue;
      }
      const r1 = q1 / p;
      const r2 = q2 / p;
      const lo = Math.min(r1, r2);
      const hi = Math.max(r1, r2);
      t0 = Math.max(t0, lo);
      t1 = Math.min(t1, hi);
      if (t0 > t1) return null;
    }

    return [a.add(d.scale(t0)), a.add(d.scale(t1))];
  }

  // ── Split & partition ─────────────────────────────────────────────────────

  /**
   * split
   *
   * Divides this AABB into 8 equal octants — the first level of an Octree.
   * Each octant is a new AABB covering exactly 1/8 of the original volume.
   */
  public split(): AABB[] {
    const c = this.centre;
    return [
      new AABB(this.min,                          c                          ),
      new AABB(new Vector3(c.x, this.min.y, this.min.z), new Vector3(this.max.x, c.y, c.z)),
      new AABB(new Vector3(this.min.x, c.y, this.min.z), new Vector3(c.x, this.max.y, c.z)),
      new AABB(new Vector3(c.x, c.y, this.min.z),        new Vector3(this.max.x, this.max.y, c.z)),
      new AABB(new Vector3(this.min.x, this.min.y, c.z), new Vector3(c.x, c.y, this.max.z)),
      new AABB(new Vector3(c.x, this.min.y, c.z),        new Vector3(this.max.x, c.y, this.max.z)),
      new AABB(new Vector3(this.min.x, c.y, c.z),        new Vector3(c.x, this.max.y, this.max.z)),
      new AABB(c,                                         this.max                        ),
    ];
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  public toString(): string {
    const s = this.size;
    return (
      `AABB(min=${this.min.toString()}, max=${this.max.toString()}, ` +
      `size=${s.toString()}, vol=${this.volume.toFixed(3)})`
    );
  }

  public toJSON(): object {
    return { min: this.min.toJSON(), max: this.max.toJSON() };
  }
}

// ---------------------------------------------------------------------------
// Octree — spatial partitioning for 144,000 sparks
// ---------------------------------------------------------------------------

/** A single node in the Octree. */
interface OctreeNode<T> {
  bounds:   AABB;
  items:    Array<{ point: Vector3; data: T }>;
  children: Array<OctreeNode<T>> | null;
}

/**
 * Octree
 *
 * Hierarchical spatial partitioning using recursive 8-way subdivision.
 *
 * Reduces collision checks from O(n²) to O(n log n) by only testing
 * points that share a leaf cell.  Used for:
 *   • Gear-tooth contact detection (144,000 tooth profile points)
 *   • Particle system bounding (aero vortex sparks)
 *   • Android touch picking (which gear did Mario tap?)
 *
 * @template T  User data stored per point (e.g., vertex index, joint ID).
 */
export class Octree<T = unknown> {
  private root: OctreeNode<T>;

  /**
   * @param bounds    The root bounding box (machine work envelope).
   * @param maxDepth  Maximum subdivision depth.  8 → 8^8 = 16M max cells.
   * @param maxItems  Maximum items per leaf before splitting.
   */
  constructor(
    bounds:             AABB,
    private maxDepth:   number = 8,
    private maxItems:   number = 8
  ) {
    this.root = { bounds, items: [], children: null };
  }

  /** Insert a point with associated data. */
  insert(point: Vector3, data: T): void {
    this._insert(this.root, point, data, 0);
  }

  private _insert(node: OctreeNode<T>, point: Vector3, data: T, depth: number): void {
    if (!node.bounds.contains(point)) return;

    if (node.children !== null) {
      for (const child of node.children) {
        if (child.bounds.contains(point)) {
          this._insert(child, point, data, depth + 1);
          return;
        }
      }
      return;
    }

    node.items.push({ point, data });

    if (node.items.length > this.maxItems && depth < this.maxDepth) {
      const octants = node.bounds.split();
      node.children = octants.map((b) => ({ bounds: b, items: [], children: null }));

      for (const item of node.items) {
        for (const child of node.children) {
          if (child.bounds.contains(item.point)) {
            child.items.push(item);
            break;
          }
        }
      }
      node.items = [];
    }
  }

  /**
   * query
   *
   * Returns all items within the given AABB.
   * Only traverses branches that overlap the query region — O(log n + k).
   */
  query(region: AABB): Array<{ point: Vector3; data: T }> {
    const results: Array<{ point: Vector3; data: T }> = [];
    this._query(this.root, region, results);
    return results;
  }

  private _query(
    node: OctreeNode<T>,
    region: AABB,
    out: Array<{ point: Vector3; data: T }>
  ): void {
    if (!node.bounds.intersects(region)) return;

    for (const item of node.items) {
      if (region.contains(item.point)) out.push(item);
    }

    if (node.children) {
      for (const child of node.children) this._query(child, region, out);
    }
  }

  /**
   * nearestNeighbour
   *
   * Returns the item closest to `point` within `maxDist`.
   * Used for "snap to nearest tooth" in the gear meshing simulation.
   */
  nearestNeighbour(
    point:   Vector3,
    maxDist: number = Infinity
  ): { point: Vector3; data: T; distance: number } | null {
    const region  = AABB.fromSphere(point, maxDist);
    const candidates = this.query(region);
    let best: { point: Vector3; data: T; distance: number } | null = null;

    for (const c of candidates) {
      const d = point.distanceTo(c.point);
      if (d <= maxDist && (best === null || d < best.distance)) {
        best = { ...c, distance: d };
      }
    }
    return best;
  }

  /** Total number of items stored in the tree. */
  get count(): number {
    return this._count(this.root);
  }

  private _count(node: OctreeNode<T>): number {
    let n = node.items.length;
    if (node.children) for (const c of node.children) n += this._count(c);
    return n;
  }
}
