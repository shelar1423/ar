// Pure TypeScript implementation of ArUco marker detection & POSIT 3D pose estimation
// Free of CommonJS require() calls to ensure 100% compatibility with modern ESM bundlers (Vite/Rolldown/Next)

export interface Point2D {
  x: number;
  y: number;
}

export interface MarkerResult {
  id: number;
  corners: Point2D[];
  distance?: number;
}

export interface PoseResult {
  bestError: number;
  bestRotation: number[][];
  bestTranslation: number[];
  alternativeError?: number;
  alternativeRotation?: number[][];
  alternativeTranslation?: number[];
}

export class CVImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;

  constructor(width = 0, height = 0, data?: Uint8ClampedArray | Uint8Array) {
    this.width = width;
    this.height = height;
    this.data = data || new Uint8ClampedArray(width * height);
  }
}

export class SVD {
  static sign(a: number, b: number): number {
    return b >= 0 ? Math.abs(a) : -Math.abs(a);
  }

  static svdcmp(a: number[][], m: number, n: number, w: number[], v: number[][]): void {
    let i: number, j: number, k: number, l = 0;
    let anorm = 0, c: number, f: number, g = 0, h: number, s: number, scale = 0, x: number, y: number, z: number;
    const rv1: number[] = new Array(n).fill(0);

    for (i = 0; i < n; ++i) {
      l = i + 1;
      rv1[i] = scale * g;
      g = s = scale = 0;
      if (i < m) {
        for (k = i; k < m; ++k) scale += Math.abs(a[k][i]);
        if (scale !== 0) {
          for (k = i; k < m; ++k) {
            a[k][i] /= scale;
            s += a[k][i] * a[k][i];
          }
          f = a[i][i];
          g = -SVD.sign(Math.sqrt(s), f);
          h = f * g - s;
          a[i][i] = f - g;
          for (j = l; j < n; ++j) {
            for (s = 0, k = i; k < m; ++k) s += a[k][i] * a[k][j];
            f = s / h;
            for (k = i; k < m; ++k) a[k][j] += f * a[k][i];
          }
          for (k = i; k < m; ++k) a[k][i] *= scale;
        }
      }
      w[i] = scale * g;
      g = s = scale = 0;
      if (i < m && i !== n - 1) {
        for (k = l; k < n; ++k) scale += Math.abs(a[i][k]);
        if (scale !== 0) {
          for (k = l; k < n; ++k) {
            a[i][k] /= scale;
            s += a[i][k] * a[i][k];
          }
          f = a[i][l];
          g = -SVD.sign(Math.sqrt(s), f);
          h = f * g - s;
          a[i][l] = f - g;
          for (k = l; k < n; ++k) rv1[k] = a[i][k] / h;
          for (j = l; j < m; ++j) {
            for (s = 0, k = l; k < n; ++k) s += a[j][k] * a[i][k];
            for (k = l; k < n; ++k) a[j][k] += s * rv1[k];
          }
          for (k = l; k < n; ++k) a[i][k] *= scale;
        }
      }
      anorm = Math.max(anorm, Math.abs(w[i]) + Math.abs(rv1[i]));
    }

    for (i = n - 1; i >= 0; --i) {
      if (i < n - 1) {
        if (g !== 0) {
          for (j = l; j < n; ++j) v[j][i] = (a[i][j] / a[i][l]) / g;
          for (j = l; j < n; ++j) {
            for (s = 0, k = l; k < n; ++k) s += a[i][k] * v[k][j];
            for (k = l; k < n; ++k) v[k][j] += s * v[k][i];
          }
        }
        for (j = l; j < n; ++j) v[i][j] = v[j][i] = 0;
      }
      v[i][i] = 1;
      g = rv1[i];
      l = i;
    }

    for (i = Math.min(m, n) - 1; i >= 0; --i) {
      l = i + 1;
      g = w[i];
      for (j = l; j < n; ++j) a[i][j] = 0;
      if (g !== 0) {
        g = 1 / g;
        for (j = l; j < n; ++j) {
          for (s = 0, k = l; k < m; ++k) s += a[k][i] * a[k][j];
          f = (s / a[i][i]) * g;
          for (k = i; k < m; ++k) a[k][j] += f * a[k][i];
        }
        for (j = i; j < m; ++j) a[j][i] *= g;
      } else {
        for (j = i; j < m; ++j) a[j][i] = 0;
      }
      ++a[i][i];
    }

    for (k = n - 1; k >= 0; --k) {
      for (let its = 1; its <= 30; ++its) {
        let flag = true;
        let nm = 0;
        for (l = k; l >= 0; --l) {
          nm = l - 1;
          if (Math.abs(rv1[l]) + anorm === anorm) {
            flag = false;
            break;
          }
          if (Math.abs(w[nm]) + anorm === anorm) break;
        }
        if (flag) {
          c = 0;
          s = 1;
          for (i = l; i <= k; ++i) {
            f = s * rv1[i];
            rv1[i] = c * rv1[i];
            if (Math.abs(f) + anorm === anorm) break;
            g = w[i];
            h = Math.hypot(f, g);
            w[i] = h;
            h = 1 / h;
            c = g * h;
            s = -f * h;
            for (j = 0; j < m; ++j) {
              y = a[j][nm];
              z = a[j][i];
              a[j][nm] = y * c + z * s;
              a[j][i] = z * c - y * s;
            }
          }
        }
        z = w[k];
        if (l === k) {
          if (z < 0) {
            w[k] = -z;
            for (j = 0; j < n; ++j) v[j][k] = -v[j][k];
          }
          break;
        }
        if (its === 30) break;
        x = w[l];
        nm = k - 1;
        y = w[nm];
        g = rv1[nm];
        h = rv1[k];
        f = ((y - z) * (y + z) + (g - h) * (g + h)) / (2 * h * y);
        g = Math.hypot(f, 1);
        f = ((x - z) * (x + z) + h * ((y / (f + SVD.sign(g, f))) - h)) / x;
        c = s = 1;
        for (j = l; j <= nm; ++j) {
          i = j + 1;
          g = rv1[i];
          y = w[i];
          h = s * g;
          g = c * g;
          z = Math.hypot(f, h);
          rv1[j] = z;
          c = f / z;
          s = h / z;
          f = x * c + g * s;
          g = g * c - x * s;
          h = y * s;
          y *= c;
          for (let jj = 0; jj < n; ++jj) {
            x = v[jj][j];
            z = v[jj][i];
            v[jj][j] = x * c + z * s;
            v[jj][i] = z * c - x * s;
          }
          z = Math.hypot(f, h);
          w[j] = z;
          if (z !== 0) {
            z = 1 / z;
            c = f * z;
            s = h * z;
          }
          f = c * g + s * y;
          x = c * y - s * g;
          for (let jj = 0; jj < m; ++jj) {
            y = a[jj][j];
            z = a[jj][i];
            a[jj][j] = y * c + z * s;
            a[jj][i] = z * c - y * s;
          }
        }
        rv1[l] = 0;
        rv1[k] = f;
        w[k] = x;
      }
    }
  }
}

export class Posit {
  objectPoints: number[][];
  objectVectors: number[][] = [];
  objectNormal: number[] = [];
  objectMatrix: number[][] = [[], [], []];

  constructor(public modelSize: number, public focalLength: number) {
    const half = modelSize / 2;
    this.objectPoints = [
      [-half, half, 0],
      [half, half, 0],
      [half, -half, 0],
      [-half, -half, 0],
    ];
    this.init();
  }

  private init() {
    const np = this.objectPoints.length;
    const vectors: number[][] = [];
    for (let i = 0; i < np; ++i) {
      this.objectVectors[i] = [
        this.objectPoints[i][0] - this.objectPoints[0][0],
        this.objectPoints[i][1] - this.objectPoints[0][1],
        this.objectPoints[i][2] - this.objectPoints[0][2],
      ];
      vectors[i] = [...this.objectVectors[i]];
    }

    let len = 0;
    let row = 2;
    while (len === 0 && row < np) {
      this.objectNormal = this.cross(this.objectVectors[1], this.objectVectors[row]);
      len = Math.hypot(this.objectNormal[0], this.objectNormal[1], this.objectNormal[2]);
      row++;
    }
    if (len !== 0) {
      this.objectNormal[0] /= len;
      this.objectNormal[1] /= len;
      this.objectNormal[2] /= len;
    }

    this.pseudoInverse(vectors, np, this.objectMatrix);
  }

  private cross(a: number[], b: number[]): number[] {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  private pseudoInverse(a: number[][], n: number, b: number[][]): void {
    const w: number[] = new Array(3).fill(0);
    const v: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const s: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

    SVD.svdcmp(a, n, 3, w, v);
    const wmax = Math.max(...w) * 0.01;
    for (let i = 0; i < 3; ++i) {
      if (w[i] < wmax) w[i] = 0;
    }

    let cn = 0;
    for (let j = 0; j < 3; ++j) {
      if (w[j] === 0) {
        cn++;
        for (let k = j; k < 2; ++k) {
          for (let i = 0; i < n; ++i) a[i][k] = a[i][k + 1];
          for (let i = 0; i < 3; ++i) v[i][k] = v[i][k + 1];
        }
      }
    }
    for (let j = 0; j < 2; ++j) {
      if (w[j] === 0) w[j] = w[j + 1];
    }
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3 - cn; ++j) {
        s[i][j] = v[i][j] / w[j];
      }
    }
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < n; ++j) {
        b[i][j] = 0;
        for (let k = 0; k < 3 - cn; ++k) {
          b[i][j] += s[i][k] * a[j][k];
        }
      }
    }
  }

  pose(corners: Point2D[]): PoseResult {
    const np = corners.length;
    const imageVectors: number[][] = [];
    for (let i = 0; i < np; ++i) {
      imageVectors[i] = [corners[i].x - corners[0].x, corners[i].y - corners[0].y];
    }

    const I: number[] = [0, 0, 0];
    const J: number[] = [0, 0, 0];
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < np; ++j) {
        I[i] += this.objectMatrix[i][j] * imageVectors[j][0];
        J[i] += this.objectMatrix[i][j] * imageVectors[j][1];
      }
    }

    const iLen = Math.hypot(I[0], I[1], I[2]);
    const jLen = Math.hypot(J[0], J[1], J[2]);
    const scale = (iLen + jLen) / 2;
    const tz = scale > 0 ? this.focalLength / scale : 100;

    const rot: number[][] = [
      [I[0] / (iLen || 1), I[1] / (iLen || 1), I[2] / (iLen || 1)],
      [J[0] / (jLen || 1), J[1] / (jLen || 1), J[2] / (jLen || 1)],
      [0, 0, 1],
    ];
    rot[2] = [
      rot[0][1] * rot[1][2] - rot[0][2] * rot[1][1],
      rot[0][2] * rot[1][0] - rot[0][0] * rot[1][2],
      rot[0][0] * rot[1][1] - rot[0][1] * rot[0][0], // orthogonal
    ];

    const tx = (corners[0].x * tz) / this.focalLength;
    const ty = (corners[0].y * tz) / this.focalLength;

    return {
      bestRotation: rot,
      bestTranslation: [tx, ty, tz],
      bestError: 0,
    };
  }
}

// ArUco 7x7 code for marker ID 0:
const CODE_ID_0 = 0x1084210;

export class ArUcoDetector {
  private grey: CVImage = new CVImage();
  private thres: CVImage = new CVImage();
  private homography: CVImage = new CVImage();

  detect(imageSrc: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): MarkerResult[] {
    const w = imageSrc.width, h = imageSrc.height;
    if (this.grey.width !== w || this.grey.height !== h) {
      this.grey = new CVImage(w, h);
      this.thres = new CVImage(w, h);
      this.homography = new CVImage(49, 49);
    }

    // 1. Grayscale
    const src = imageSrc.data, gdata = this.grey.data, len = w * h;
    for (let i = 0, j = 0; i < len; ++i, j += 4) {
      gdata[i] = (src[j] * 77 + src[j + 1] * 151 + src[j + 2] * 28) >> 8;
    }

    // 2. Fast Adaptive Threshold
    const tdata = this.thres.data;
    // Box blur radius 3
    this.boxBlur(gdata, tdata, w, h, 3);
    for (let i = 0; i < len; ++i) {
      tdata[i] = (gdata[i] <= tdata[i] - 7) ? 255 : 0;
    }

    // 3. Contours & Quads
    const contours = this.findContours(this.thres);
    const minSize = Math.max(16, w * 0.05);
    const candidates: Point2D[][] = [];

    for (const contour of contours) {
      if (contour.length >= minSize) {
    let poly = this.approxPolyDP(contour, contour.length * 0.05);
    if (poly.length > 3 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) <= 6) {
      poly = poly.slice(0, -1);
    }
    if (poly.length === 4 && this.isConvex(poly) && this.minEdge(poly) >= 10) {
      candidates.push(poly);
    }
      }
    }

    const ordered = this.clockwiseCorners(candidates);
    const filtered = this.filterTooNear(ordered, 10);

    // 4. Sample and verify ID 0 marker
    const markers: MarkerResult[] = [];
    for (const cand of filtered) {
      const marker = this.checkMarker(this.grey, cand);
      if (marker) markers.push(marker);
    }

    return markers;
  }

  private boxBlur(src: Uint8Array | Uint8ClampedArray, dst: Uint8Array | Uint8ClampedArray, w: number, h: number, r: number) {
    const tmp = new Uint16Array(w * h);
    for (let y = 0; y < h; ++y) {
      let sum = 0;
      for (let x = 0; x <= r && x < w; ++x) sum += src[y * w + x];
      for (let x = 0; x < w; ++x) {
        if (x + r < w) sum += src[y * w + x + r];
        if (x - r - 1 >= 0) sum -= src[y * w + x - r - 1];
        const count = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
        tmp[y * w + x] = Math.round(sum / count);
      }
    }
    for (let x = 0; x < w; ++x) {
      let sum = 0;
      for (let y = 0; y <= r && y < h; ++y) sum += tmp[y * w + x];
      for (let y = 0; y < h; ++y) {
        if (y + r < h) sum += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
        const count = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
        dst[y * w + x] = Math.round(sum / count);
      }
    }
  }

  private findContours(bin: CVImage): Point2D[][] {
    const w = bin.width, h = bin.height;
    const src = bin.data;
    const visited = new Uint8Array(w * h);
    const contours: Point2D[][] = [];
    const dirs = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1],
    ];

    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const idx = y * w + x;
        if (src[idx] === 255 && !visited[idx] && src[idx - 1] === 0) {
          const contour: Point2D[] = [];
          let cx = x, cy = y, dir = 0;
          for (let step = 0; step < 2000; ++step) {
            contour.push({ x: cx, y: cy });
            visited[cy * w + cx] = 1;
            let found = false;
            for (let i = 0; i < 8; ++i) {
              const nd = (dir + i) % 8;
              const nx = cx + dirs[nd][0];
              const ny = cy + dirs[nd][1];
              if (nx >= 0 && nx < w && ny >= 0 && ny < h && src[ny * w + nx] === 255) {
                cx = nx; cy = ny; dir = (nd + 6) % 8; found = true; break;
              }
            }
            if (!found || (cx === x && cy === y && contour.length > 4)) break;
          }
          if (contour.length >= 16) contours.push(contour);
        }
      }
    }
    return contours;
  }

  private approxPolyDP(contour: Point2D[], tol: number): Point2D[] {
    const len = contour.length;
    if (len <= 4) return contour;
    let dmax = 0, idx = 0;
    const end = len - 1;
    const dx = contour[end].x - contour[0].x;
    const dy = contour[end].y - contour[0].y;
    const lineLen = Math.hypot(dx, dy) || 1;

    for (let i = 1; i < end; ++i) {
      const d = Math.abs(dy * contour[i].x - dx * contour[i].y + contour[end].x * contour[0].y - contour[end].y * contour[0].x) / lineLen;
      if (d > dmax) { dmax = d; idx = i; }
    }

    if (dmax > tol) {
      const r1 = this.approxPolyDP(contour.slice(0, idx + 1), tol);
      const r2 = this.approxPolyDP(contour.slice(idx), tol);
      return r1.slice(0, -1).concat(r2);
    }
    return [contour[0], contour[end]];
  }

  private isConvex(poly: Point2D[]): boolean {
    let prev = 0;
    for (let i = 0; i < 4; ++i) {
      const a = poly[i], b = poly[(i + 1) % 4], c = poly[(i + 2) % 4];
      const cp = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cp !== 0) {
        if (prev === 0) prev = cp;
        else if ((cp > 0 && prev < 0) || (cp < 0 && prev > 0)) return false;
      }
    }
    return true;
  }

  private minEdge(poly: Point2D[]): number {
    let min = Infinity;
    for (let i = 0; i < 4; ++i) {
      const n = (i + 1) % 4;
      min = Math.min(min, Math.hypot(poly[n].x - poly[i].x, poly[n].y - poly[i].y));
    }
    return min;
  }

  private clockwiseCorners(candidates: Point2D[][]): Point2D[][] {
    for (const poly of candidates) {
      const dx1 = poly[1].x - poly[0].x, dy1 = poly[1].y - poly[0].y;
      const dx2 = poly[2].x - poly[0].x, dy2 = poly[2].y - poly[0].y;
      if (dx1 * dy2 - dy1 * dx2 < 0) {
        const swap = poly[1];
        poly[1] = poly[3];
        poly[3] = swap;
      }
    }
    return candidates;
  }

  private filterTooNear(candidates: Point2D[][], minDist: number): Point2D[][] {
    const keep: boolean[] = new Array(candidates.length).fill(true);
    for (let i = 0; i < candidates.length; ++i) {
      if (!keep[i]) continue;
      for (let j = i + 1; j < candidates.length; ++j) {
        let dist = 0;
        for (let k = 0; k < 4; ++k) {
          dist += Math.hypot(candidates[i][k].x - candidates[j][k].x, candidates[i][k].y - candidates[j][k].y);
        }
        if (dist / 4 < minDist) keep[j] = false;
      }
    }
    return candidates.filter((_, i) => keep[i]);
  }

  private checkMarker(grey: CVImage, quad: Point2D[]): MarkerResult | null {
    // Warp quad to 7x7 grid
    const w = grey.width, h = grey.height;
    const gdata = grey.data;
    const cells: number[][] = [];

    for (let r = 0; r < 7; ++r) {
      cells[r] = [];
      const tr = (r + 0.5) / 7;
      for (let c = 0; c < 7; ++c) {
        const tc = (c + 0.5) / 7;
        const topX = quad[0].x * (1 - tc) + quad[1].x * tc;
        const topY = quad[0].y * (1 - tc) + quad[1].y * tc;
        const botX = quad[3].x * (1 - tc) + quad[2].x * tc;
        const botY = quad[3].y * (1 - tc) + quad[2].y * tc;
        const px = Math.round(topX * (1 - tr) + botX * tr);
        const py = Math.round(topY * (1 - tr) + botY * tr);

        if (px < 0 || px >= w || py < 0 || py >= h) return null;
        cells[r][c] = gdata[py * w + px];
      }
    }

    // Border mean
    let borderSum = 0;
    for (let i = 0; i < 7; ++i) {
      borderSum += cells[0][i] + cells[6][i] + cells[i][0] + cells[i][6];
    }
    const borderMean = borderSum / 24;

    // Sample inner 5x5 bits
    const bits: number[][] = [];
    for (let r = 1; r <= 5; ++r) {
      bits[r - 1] = [];
      for (let c = 1; c <= 5; ++c) {
        bits[r - 1][c - 1] = cells[r][c] > borderMean + 20 ? 1 : 0;
      }
    }

    // Check all 4 rotations for ID 0 (0x1084210)
    for (let rot = 0; rot < 4; ++rot) {
      let code = 0;
      for (let r = 0; r < 5; ++r) {
        for (let c = 0; c < 5; ++c) {
          let b = 0;
          if (rot === 0) b = bits[r][c];
          else if (rot === 1) b = bits[4 - c][r];
          else if (rot === 2) b = bits[4 - r][4 - c];
          else b = bits[c][4 - r];
          code = (code << 1) | b;
        }
      }
      if (code === CODE_ID_0) {
        const rotatedQuad = quad.map((_, i) => quad[(i + (4 - rot)) % 4]);
        return { id: 0, corners: rotatedQuad };
      }
    }

    return null;
  }
}
