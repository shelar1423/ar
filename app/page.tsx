'use client';
import {useEffect, useRef, useState} from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ChevronRight,
  MapPin,
  Scan,
  Camera,
  Box,
  RotateCcw,
  Plus,
  Minus,
  Bell,
  Clock,
  Check,
  ShieldCheck,
  Target,
  Sparkles,
  Flame,
  Volume2,
} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {Progress} from '@/components/ui/progress';
import type {TryOn, ViewState} from '@/lib/try-on';
import {sounds} from '@/lib/audio';

const initial: ViewState = {
  ready: false,
  progress: 0,
  mode: 'product',
  placed: false,
  busy: false,
  error: '',
  size: 1,
  rotationY: 0,
  drifting: false,
  speed: 0,
};

const defaultDrop = '2026-09-11T18:00';

export default function Page() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<TryOn | null>(null);
  const [state, setState] = useState(initial);
  const [permission, setPermission] = useState(false);
  const [quickLook, setQuickLook] = useState(false);
  const [drop, setDrop] = useState(defaultDrop);
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');

  // Active driving directions state for smooth multi-touch
  const activeDirs = useRef({up: false, down: false, left: false, right: false});

  // Gesture state (pinch-to-scale and drag-to-rotate on 3D canvas)
  const touchData = useRef<{
    x: number;
    y: number;
    distance: number;
    mode: 'none' | 'rotate' | 'pinch';
  }>({x: 0, y: 0, distance: 0, mode: 'none'});
  const isMouseDown = useRef(false);
  const lastMouseX = useRef(0);

  useEffect(() => {
    let dead = false;
    void import('@/lib/try-on').then(({TryOn}) => {
      if (dead || !host.current) return;
      try {
        engine.current = new TryOn(host.current, setState);
      } catch {
        setState(s => ({...s, error: '3D could not start. Open this page in Safari and reload.'}));
      }
    });

    setQuickLook(document.createElement('a').relList.supports('ar'));
    setNow(Date.now());
    try {
      const d = localStorage.getItem('drop-demo-time');
      if (d && !Number.isNaN(Date.parse(d + '+05:30'))) setDrop(d);
      setSaved(localStorage.getItem('drop-demo-saved') === 'yes');
    } catch {}

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      dead = true;
      clearInterval(timer);
      engine.current?.dispose();
    };
  }, []);

  const remaining = Math.max(0, Math.floor((Date.parse(drop + ':00+05:30') - now) / 1000));
  const live = now > 0 && remaining === 0;
  const countdown = [
    Math.floor(remaining / 86400),
    Math.floor(remaining / 3600) % 24,
    Math.floor(remaining / 60) % 60,
    remaining % 60,
  ];

  const back = () => {
    activeDirs.current = {up: false, down: false, left: false, right: false};
    engine.current?.product();
    setNote('');
  };

  const updateDirection = () => {
    let x = 0, z = 0;
    if (activeDirs.current.left) x -= 1;
    if (activeDirs.current.right) x += 1;
    if (activeDirs.current.up) z -= 1;
    if (activeDirs.current.down) z += 1;

    if (x === 0 && z === 0) {
      engine.current?.stop();
    } else {
      engine.current?.move(x, z);
    }
  };

  const dirHold = (dir: 'up' | 'down' | 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      activeDirs.current[dir] = true;
      updateDirection();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      activeDirs.current[dir] = false;
      updateDirection();
    },
    onPointerCancel: () => {
      activeDirs.current[dir] = false;
      updateDirection();
    },
    onLostPointerCapture: () => {
      activeDirs.current[dir] = false;
      updateDirection();
    },
  });

  const holdDrift = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      engine.current?.setDrift(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      engine.current?.setDrift(false);
    },
    onPointerCancel: () => {
      engine.current?.setDrift(false);
    },
    onLostPointerCapture: () => {
      engine.current?.setDrift(false);
    },
  };

  const onHorn = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    sounds.playHorn();
  };

  const save = () => {
    setSaved(!saved);
    try {
      localStorage.setItem('drop-demo-saved', !saved ? 'yes' : 'no');
    } catch {}
    setNote(!saved ? 'Saved on this device. This demo does not send notifications.' : 'Removed from your saved drops.');
  };

  // Touch handlers for rotation and pinch zoom on the 3D visual canvas (skips controls)
  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    if ((e.target as HTMLElement).closest('button, .dpad-cluster, .action-cluster, .top-actions, .gamepad-hud, .place-controls')) return;

    if (e.touches.length === 1) {
      touchData.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        distance: 0,
        mode: 'rotate',
      };
    } else if (e.touches.length >= 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchData.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        distance: Math.hypot(dx, dy),
        mode: 'pinch',
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    if ((e.target as HTMLElement).closest('button, .dpad-cluster, .action-cluster, .top-actions, .gamepad-hud, .place-controls')) return;

    if (touchData.current.mode === 'rotate' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchData.current.x;
      touchData.current.x = e.touches[0].clientX;
      touchData.current.y = e.touches[0].clientY;
      engine.current?.rotateBy(dx * 0.008);
    } else if (touchData.current.mode === 'pinch' && e.touches.length >= 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (touchData.current.distance > 0) {
        const delta = (dist - touchData.current.distance) * 0.003;
        engine.current?.scale(delta);
      }
      touchData.current.distance = dist;
    }
  };

  const onTouchEnd = () => {
    touchData.current = {x: 0, y: 0, distance: 0, mode: 'none'};
  };

  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    if ((e.target as HTMLElement).closest('button, .dpad-cluster, .action-cluster, .top-actions, .gamepad-hud, .place-controls')) return;
    isMouseDown.current = true;
    lastMouseX.current = e.clientX;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!isMouseDown.current || state.mode === 'product') return;
    const dx = e.clientX - lastMouseX.current;
    lastMouseX.current = e.clientX;
    engine.current?.rotateBy(dx * 0.008);
  };

  const onMouseUp = () => {
    isMouseDown.current = false;
  };

  const onWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    engine.current?.scale(-e.deltaY * 0.001);
  };

  return (
    <main
      className={`app ${state.mode !== 'product' ? 'trying' : ''} ${state.mode === 'camera' ? 'camera-mode' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={onWheel}
    >
      {state.mode === 'product' && (
        <header className="brandbar">
          <button
            type="button"
            className="brand brand-btn"
            onClick={onHorn}
            title="Play Zepto Turbo Horn"
          >
            zepto<span>CONCEPT</span>
            <Volume2 size={16} className="sound-badge" />
          </button>
          <div className="delivery">
            <MapPin size={17} />
            <span>
              Delivering to <b>Home</b>
            </span>
          </div>
        </header>
      )}

      {state.mode === 'product' ? (
        <div className="breadcrumb">
          <span>Hot Wheels collection</span>
          <ChevronRight size={14} />
          <b>Ballistik</b>
        </div>
      ) : (
        <header className="try-header">
          <button aria-label="Back to product" onClick={back} className="back-btn">
            <ArrowLeft size={18} />
          </button>

          <div className="try-title-block">
            <strong>Ballistik</strong>
            <span>{state.mode === 'camera' ? 'Real-world AR' : '3D Demo'}</span>
          </div>

          {state.placed ? (
            <div className="top-actions">
              <button
                className="top-btn"
                onClick={() => engine.current?.reset()}
                title="Reset car position"
                aria-label="Reset position"
              >
                <RotateCcw size={14} />
                <span>Reset</span>
              </button>

              <div className="top-size-pill">
                <button
                  aria-label="Make car smaller"
                  onClick={() => engine.current?.scale(-0.35)}
                >
                  <Minus size={14} />
                </button>
                <span>Size</span>
                <button
                  aria-label="Make car larger"
                  onClick={() => engine.current?.scale(0.35)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ) : (
            <span className="small-3d">3D</span>
          )}
        </header>
      )}

      <div className="product-layout">
        <section className="visual">
          <div ref={host} className="model-host" />
          {state.mode === 'product' && (
            <>
              <span className="edition-tag">
                THE COLLECTOR’S DROP <span>01</span>
              </span>
              <span className="model-stamp">BALLISTIK</span>
              <div className="viewer-caption">
                <RotateCcw size={14} /> Drag to rotate · pinch to explore <span>3D MODEL</span>
              </div>
            </>
          )}
          {!state.ready && (
            <div className="loader">
              <Box size={30} />
              <strong>{state.error ? 'Couldn’t load your car' : 'Unboxing Ballistik…'}</strong>
              <p>{state.error || 'Loading the real 3D model'}</p>
              <Progress value={state.progress} aria-label="Loading 3D model" />
              {state.error && <button onClick={() => location.reload()}>Reload</button>}
            </div>
          )}
        </section>

        {state.mode === 'product' && (
          <section className="product-details">
            <div className="product-kicker">
              HOT WHEELS <span>COLLECTOR SERIES</span>
            </div>
            <h1>
              Small car.
              <br />
              Big main-character energy.
            </h1>
            <div className="product-name">
              <h2>Hot Wheels Ballistik</h2>
              <span>1 car · die-cast model</span>
            </div>
            <div className="price">
              <strong>₹179</strong>
              <span>Illustrative price · campaign demo</span>
            </div>
            <button className="try-button" disabled={!state.ready} onClick={() => setPermission(true)}>
              <span className="try-icon">
                <Scan size={27} />
              </span>
              <span>
                <strong>Try it on your table & floor</strong>
                <small>Real-world gyro anchoring · Endless driving & drift.</small>
              </span>
              <ArrowRight size={21} />
            </button>
            <div className="drop-card">
              <div className="drop-heading">
                <span>
                  <Clock size={15} /> {live ? 'DEMO DROP IS OPEN' : 'NEXT COLLECTOR’S DROP'}
                </span>
                <span className="live-dot" />
              </div>
              <h3>
                {new Date(drop + ':00+05:30').toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                IST
              </h3>
              <div className="countdown">
                {countdown.map((v, i) => (
                  <div key={i}>
                    <strong>{now ? String(v).padStart(2, '0') : '--'}</strong>
                    <span>{['DAYS', 'HRS', 'MIN', 'SEC'][i]}</span>
                  </div>
                ))}
              </div>
              <p>A little anticipation. A lot of horsepower.</p>
              <button className={saved ? 'save saved' : 'save'} onClick={save}>
                {saved ? <Check size={18} /> : <Bell size={18} />} {saved ? 'Drop saved on this device' : 'Save this drop'}
              </button>
            </div>
            {note && (
              <p className="inline-note" role="status">
                {note}
              </p>
            )}
            <div className="details">
              <h3>Meet your next shelf favourite.</h3>
              <p>
                Explore the Ballistik’s sculpted body, detailed wheels and bold finish in 3D. Bring it into your
                surroundings with real-world gyro anchoring, pinch to zoom, drag to spin, endless driving, and powerslide drift.
              </p>
              <div className="feature-row">
                <Target size={20} />
                <span>
                  <b>Real-World Gyro Anchoring</b>
                  <small>Car stays locked in 3D space when you tilt and move your camera.</small>
                </span>
              </div>
              <div className="feature-row">
                <Flame size={20} />
                <span>
                  <b>Endless Driving & Drift</b>
                  <small>No boundaries. Hold DRIFT to kick out the tail with tire screech!</small>
                </span>
              </div>
              <div className="feature-row">
                <Sparkles size={20} />
                <span>
                  <b>Interactive Audio & Gestures</b>
                  <small>Pinch to zoom, drag to rotate, and tap HORN for turbocharged sounds.</small>
                </span>
              </div>
              <div className="feature-row">
                <ShieldCheck size={20} />
                <span>
                  <b>Try before the drop</b>
                  <small>No checkout or live inventory in this concept.</small>
                </span>
              </div>
            </div>
            <details className="campaign-settings">
              <summary>Campaign demo settings</summary>
              <label>
                Drop date and time (IST)
                <input
                  type="datetime-local"
                  value={drop}
                  onChange={e => {
                    if (e.target.value) {
                      setDrop(e.target.value);
                      try {
                        localStorage.setItem('drop-demo-time', e.target.value);
                      } catch {}
                    }
                  }}
                />
              </label>
              <p>This is an editable example schedule, not an announced Hot Wheels drop.</p>
            </details>
            <footer>
              Independent Zepto × Hot Wheels campaign concept.
              <br />
              <a
                href="https://sketchfab.com/3d-models/hot-wheels-unleashed-2-ballistik-3e2a310334d649ed8c89b9a60d356d12"
                target="_blank"
                rel="noreferrer"
              >
                Ballistik model by Zorg_Sinister · CC BY 4.0 ↗
              </a>
            </footer>
          </section>
        )}
      </div>

      {state.mode !== 'product' && (
        <>
          {!state.placed ? (
            <div className="place-controls">
              <div className="reticle-text">
                AIM AT TABLE OR FLOOR & TAP TO LOCK CAR
              </div>
              <button className="pink-button" onClick={() => engine.current?.place()}>
                Start driving here <Scan size={19} />
              </button>
            </div>
          ) : (
            <div className="gamepad-hud">
              {/* Left Thumb: Directional D-Pad */}
              <div className="dpad-cluster">
                <button className="dpad-btn up" aria-label="Drive forward" {...dirHold('up')}>
                  <ArrowUp size={22} />
                </button>
                <button className="dpad-btn left" aria-label="Turn left" {...dirHold('left')}>
                  <ArrowLeft size={22} />
                </button>
                <div
                  className="dpad-hub"
                  onPointerDown={onHorn}
                  title="Horn"
                  aria-label="Horn"
                >
                  <Volume2 size={16} />
                </div>
                <button className="dpad-btn right" aria-label="Turn right" {...dirHold('right')}>
                  <ArrowRight size={22} />
                </button>
                <button className="dpad-btn down" aria-label="Reverse" {...dirHold('down')}>
                  <ArrowDown size={22} />
                </button>
              </div>

              {/* Right Thumb: Action Controls (DRIFT & HORN) */}
              <div className="action-cluster">
                <button
                  type="button"
                  className={`drift-action-btn ${state.drifting ? 'active' : ''}`}
                  aria-label="Hold to drift"
                  {...holdDrift}
                >
                  <Flame size={24} />
                  <span>DRIFT</span>
                </button>

                <button
                  type="button"
                  className="horn-action-btn"
                  aria-label="Car horn"
                  onPointerDown={onHorn}
                >
                  <Volume2 size={24} />
                  <span>HORN</span>
                </button>
              </div>
            </div>
          )}

          {state.error && (
            <div className="try-error" role="alert">
              {state.error}
            </div>
          )}
        </>
      )}

      {/* Permission & Entry Dialog */}
      <Dialog open={permission} onOpenChange={setPermission}>
        <DialogContent className="permission-dialog">
          <div className="permission-icon">
            <Camera size={31} />
          </div>
          <DialogTitle className="permission-title">Your room is the racetrack.</DialogTitle>
          <DialogDescription className="permission-description">
            Experience real-world gyro-anchored AR, or try the 3D preview mode.
          </DialogDescription>

          <div className="camera-explainer">
            <b>🎯 Real-World Gyro Anchoring</b>
            <p>
              Locks the car to your floor or table in physical space. When you tilt your phone camera up or move around, the car stays grounded right where you placed it!
            </p>
          </div>

          {state.error && (
            <p className="permission-error" role="alert">
              {state.error}
            </p>
          )}

          <button
            className="pink-button"
            disabled={state.busy || !state.ready}
            onClick={async () => {
              await engine.current?.enableCamera();
              if (engine.current?.state.mode === 'camera') setPermission(false);
            }}
          >
            <Camera size={19} />
            {state.busy ? 'Waiting for camera…' : 'Enable camera & try it'}
          </button>

          <button
            className="outline-button"
            onClick={() => {
              engine.current?.preview();
              setPermission(false);
            }}
          >
            <Box size={18} /> Try 3D preview without camera
          </button>

          {quickLook && (
            <a className="native-ar" rel="ar" href="/models/ballistik.usdz">
              <img src="/favicon.svg" width={21} height={21} alt="" /> Place on a real table · iPhone AR ↗
            </a>
          )}
          <small className="privacy-note">Camera footage is processed locally and stays on your device.</small>
        </DialogContent>
      </Dialog>
    </main>
  );
}
