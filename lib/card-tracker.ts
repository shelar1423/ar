import * as T from 'three';
import { ArUcoDetector, Posit, Point2D } from './aruco';

export interface CardPose {
  detected: boolean;
  position: T.Vector3;
  quaternion: T.Quaternion;
  corners: Point2D[];
  confidence: number;
}

export class CardTracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private detector: ArUcoDetector;
  private posit: Posit;
  private lastSeen = 0;
  private smoothedPosition = new T.Vector3(0, 0, 0);
  private smoothedQuaternion = new T.Quaternion();
  private tracking = false;
  private markerWorldSize = 1.0;

  constructor(public modelSize = 1.0) {
    this.markerWorldSize = modelSize;
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 480;
      this.canvas.height = 360;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    } else {
      this.canvas = null as any;
      this.ctx = null as any;
    }

    this.detector = new ArUcoDetector();
    this.posit = new Posit(this.markerWorldSize * 100, 480);
  }

  detectMarker(
    width: number,
    height: number,
    rgba: Uint8ClampedArray
  ): Array<{ id: number; corners: Point2D[] }> {
    return this.detector.detect({ width, height, data: rgba });
  }

  processVideo(video: HTMLVideoElement): CardPose {
    if (!this.ctx || video.videoWidth === 0 || video.videoHeight === 0) {
      return this.lossState();
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.drawImage(video, 0, 0, w, h);
    const imgData = this.ctx.getImageData(0, 0, w, h);
    const markers = this.detectMarker(w, h, imgData.data);

    if (markers.length > 0) {
      const marker = markers[0];
      const centered = marker.corners.map(pt => ({
        x: pt.x - w / 2,
        y: h / 2 - pt.y,
      }));

      const pose = this.posit.pose(centered);
      if (pose && pose.bestTranslation && pose.bestRotation) {
        const [tx, ty, tz] = pose.bestTranslation;
        const R = pose.bestRotation;

        // In Three.js: -Z is forward, +Y is up, +X is right
        const scaleFactor = 0.01;
        const targetPos = new T.Vector3(tx * scaleFactor, ty * scaleFactor, -tz * scaleFactor);

        const rotMatrix = new T.Matrix4().set(
          R[0][0], R[0][1], R[0][2], 0,
          R[1][0], R[1][1], R[1][2], 0,
          R[2][0], R[2][1], R[2][2], 0,
          0, 0, 0, 1
        );
        const targetQuat = new T.Quaternion().setFromRotationMatrix(rotMatrix);

        // Exponential smoothing to suppress CV jitter
        const alpha = this.tracking ? 0.35 : 1.0;
        this.smoothedPosition.lerp(targetPos, alpha);
        this.smoothedQuaternion.slerp(targetQuat, alpha);
        this.tracking = true;
        this.lastSeen = Date.now();

        return {
          detected: true,
          position: this.smoothedPosition.clone(),
          quaternion: this.smoothedQuaternion.clone(),
          corners: marker.corners,
          confidence: 1.0,
        };
      }
    }

    // Tracking loss timeout (250ms buffer to avoid flicker)
    if (Date.now() - this.lastSeen > 250) {
      this.tracking = false;
    }

    return this.lossState();
  }

  private lossState(): CardPose {
    return {
      detected: this.tracking,
      position: this.smoothedPosition.clone(),
      quaternion: this.smoothedQuaternion.clone(),
      corners: [],
      confidence: this.tracking ? 0.5 : 0,
    };
  }

  static generateTrackingCardSVG(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">
  <defs>
    <style>
      .bg { fill: #ffffff; }
      .border-line { stroke: #e02424; stroke-width: 4; fill: none; }
      .card-header { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-weight: 800; font-size: 20px; fill: #111827; letter-spacing: 2px; }
      .card-sub { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-weight: 600; font-size: 11px; fill: #6b7280; letter-spacing: 1.5px; }
      .marker-black { fill: #000000; }
      .marker-white { fill: #ffffff; }
      .corner-mark { stroke: #e02424; stroke-width: 3; fill: none; }
    </style>
  </defs>
  <!-- Card Background -->
  <rect class="bg" width="600" height="600" rx="20"/>
  <rect class="border-line" x="24" y="24" width="552" height="552" rx="14"/>

  <!-- Corner alignment targets -->
  <path class="corner-mark" d="M 40 60 L 40 40 L 60 40"/>
  <path class="corner-mark" d="M 540 40 L 560 40 L 560 60"/>
  <path class="corner-mark" d="M 40 540 L 40 560 L 60 560"/>
  <path class="corner-mark" d="M 540 560 L 560 560 L 560 540"/>

  <!-- Brand Headers -->
  <text x="300" y="70" text-anchor="middle" class="card-header">HOT WHEELS <tspan fill="#e02424">✕</tspan> ZEPTO</text>
  <text x="300" y="92" text-anchor="middle" class="card-sub">AR SURFACE TRACKING CARD · 01</text>

  <!-- ArUco Marker ID 0 Container (7x7 grid) centered -->
  <!-- Marker size: 350x350 at x=125, y=125. 7x7 cells = 50x50 per cell -->
  <rect class="marker-black" x="125" y="125" width="350" height="350"/>
  <!-- Inner 5x5 bits at x=175, y=175. White cells for ID 0: (2,2), (2,3), (2,4), (2,5), (2,6) -->
  <rect class="marker-white" x="175" y="175" width="50" height="50"/>
  <rect class="marker-white" x="175" y="225" width="50" height="50"/>
  <rect class="marker-white" x="175" y="275" width="50" height="50"/>
  <rect class="marker-white" x="175" y="325" width="50" height="50"/>
  <rect class="marker-white" x="175" y="375" width="50" height="50"/>

  <!-- Center Target Crosshair -->
  <circle cx="300" cy="300" r="8" fill="#e02424"/>
  <circle cx="300" cy="300" r="3" fill="#ffffff"/>

  <!-- Footer Instructions -->
  <text x="300" y="515" text-anchor="middle" class="card-sub" font-size="12px" fill="#374151">PLACE FLAT ON A TABLE · AIM CAMERA HERE</text>
  <text x="300" y="535" text-anchor="middle" class="card-sub" font-size="10px" fill="#9ca3af">KEEP CARD VISIBLE WHILE DRIVING · DO NOT FOLD</text>
</svg>`;
  }
}
