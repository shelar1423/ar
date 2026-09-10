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
  Printer,
  Download,
  FileText,
  Target,
  Sparkles,
} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {Progress} from '@/components/ui/progress';
import type {TryOn, ViewState} from '@/lib/try-on';

const initial: ViewState = {
  ready: false,
  progress: 0,
  mode: 'product',
  placed: false,
  busy: false,
  error: '',
  trackingMode: 'card',
  cardTracked: false,
  size: 1,
  rotationY: 0,
};

const defaultDrop = '2026-09-11T18:00';

export default function Page() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<TryOn | null>(null);
  const [state, setState] = useState(initial);
  const [permission, setPermission] = useState(false);
  const [cardModal, setCardModal] = useState(false);
  const [quickLook, setQuickLook] = useState(false);
  const [drop, setDrop] = useState(defaultDrop);
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');

  // Gesture state (pinch-to-scale and drag-to-rotate)
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
    engine.current?.product();
    setNote('');
  };

  const hold = (x: number, z: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      engine.current?.move(x, z);
    },
    onPointerUp: () => engine.current?.stop(),
    onPointerCancel: () => engine.current?.stop(),
    onLostPointerCapture: () => engine.current?.stop(),
  });

  const save = () => {
    setSaved(!saved);
    try {
      localStorage.setItem('drop-demo-saved', !saved ? 'yes' : 'no');
    } catch {}
    setNote(!saved ? 'Saved on this device. This demo does not send notifications.' : 'Removed from your saved drops.');
  };

  // Touch handlers for rotation and pinch zoom on the 3D visual area
  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    if ((e.target as HTMLElement).closest('button, .dpad, .size-buttons, .utility, .tracking-toggle')) return;

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
    if ((e.target as HTMLElement).closest('button, .dpad, .size-buttons, .utility, .tracking-toggle')) return;

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

  // Mouse drag to rotate and wheel to zoom on desktop
  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (state.mode === 'product') return;
    if ((e.target as HTMLElement).closest('button, .dpad, .size-buttons, .utility, .tracking-toggle')) return;
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

  const handlePrintCard = () => {
    const printWin = window.open('/tracking-card.svg', '_blank');
    if (printWin) {
      printWin.focus();
    }
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
          <div className="brand">
            zepto<span>CONCEPT</span>
          </div>
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
          <button aria-label="Back to product" onClick={back}>
            <ArrowLeft />
          </button>
          <div>
            <strong>Ballistik in your space</strong>
            <span>
              {state.mode === 'camera'
                ? state.trackingMode === 'card'
                  ? 'Table-locked AR · Tracking card'
                  : 'Manual overlay mode'
                : 'Interactive 3D demo'}
            </span>
          </div>
          {state.mode === 'camera' && (
            <button
              className="card-shortcut-btn"
              onClick={() => setCardModal(true)}
              title="Show or print tracking card"
            >
              <FileText size={15} />
              <span>Card</span>
            </button>
          )}
          <span className="small-3d">3D</span>
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
                <strong>Try it on your table</strong>
                <small>Table-locked AR with card tracking · Drive & explore.</small>
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
                surroundings with table-locked card tracking, pinch to zoom, drag to spin, and drive across your table.
              </p>
              <div className="feature-row">
                <Target size={20} />
                <span>
                  <b>Table-Locked Card AR</b>
                  <small>Car stays locked to your physical table using a printable card.</small>
                </span>
              </div>
              <div className="feature-row">
                <Sparkles size={20} />
                <span>
                  <b>Touch Gestures Anywhere</b>
                  <small>Pinch to zoom and drag to rotate the car directly on screen.</small>
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
          <div className="placement-copy">
            {state.mode === 'camera' && (
              <div className="tracking-toggle">
                <button
                  className={state.trackingMode === 'card' ? 'active' : ''}
                  onClick={() => engine.current?.setTrackingMode('card')}
                >
                  <Target size={14} /> Card AR (Locked)
                </button>
                <button
                  className={state.trackingMode === 'manual' ? 'active' : ''}
                  onClick={() => engine.current?.setTrackingMode('manual')}
                >
                  <Box size={14} /> Free Overlay
                </button>
              </div>
            )}

            {state.mode === 'camera' && state.trackingMode === 'card' ? (
              <div className={`tracking-hud-pill ${state.cardTracked ? 'tracked' : 'searching'}`}>
                {state.cardTracked ? (
                  <>
                    <Check size={14} />
                    <span>TABLE LOCKED · ON CARD</span>
                  </>
                ) : (
                  <>
                    <Scan size={14} className="spin-slow" />
                    <span>AIM CAMERA AT TRACKING CARD</span>
                    <button
                      className="pill-action-btn"
                      onClick={() => setCardModal(true)}
                    >
                      Show Card
                    </button>
                  </>
                )}
              </div>
            ) : (
              <span className="status-pill">
                <span />
                {state.placed ? 'READY TO ROLL' : 'MAKE ROOM FOR A LITTLE LEGEND'}
              </span>
            )}

            <h2>
              {state.mode === 'camera' && state.trackingMode === 'card'
                ? state.cardTracked
                  ? 'Card locked. Ready to drive!'
                  : 'Point at tracking card'
                : state.placed
                ? 'Your table. Your test drive.'
                : 'Aim at your table.'}
            </h2>
            <p>
              {state.mode === 'camera' && state.trackingMode === 'card'
                ? state.cardTracked
                  ? 'Phone moves freely—the car stays locked to your table! Drag to spin · pinch to resize.'
                  : 'Place the printable card flat on your table. When detected, the car anchors directly to it.'
                : state.mode === 'camera'
                ? 'Manual overlay mode. Pinch to zoom, drag to rotate, or switch to Card AR above.'
                : 'Pinch to zoom, drag to spin, and hold an arrow to drive around.'}
            </p>
          </div>

          {!state.placed ? (
            <div className="place-controls">
              <div className="reticle-text">
                {state.mode === 'camera' && state.trackingMode === 'card'
                  ? state.cardTracked
                    ? 'CARD DETECTED · TAP TO START DRIVING'
                    : 'AIM CAMERA AT THE PRINTED / DISPLAYED CARD'
                  : 'ALIGN CAR WITH YOUR SURFACE'}
              </div>
              <button className="pink-button" onClick={() => engine.current?.place()}>
                Start driving here <Scan size={19} />
              </button>
            </div>
          ) : (
            <section className="drive-controls">
              <div className="utility">
                <button onClick={() => engine.current?.reset()}>
                  <RotateCcw size={18} />
                  <span>Reset</span>
                </button>
                <div className="size-buttons">
                  <button aria-label="Make car smaller" onClick={() => engine.current?.scale(-0.15)}>
                    <Minus size={18} />
                  </button>
                  <span>Size</span>
                  <button aria-label="Make car larger" onClick={() => engine.current?.scale(0.15)}>
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              <div className="dpad">
                <button className="up" aria-label="Move forward" {...hold(0, -1)}>
                  <ArrowUp />
                </button>
                <button className="left" aria-label="Move left" {...hold(-1, 0)}>
                  <ArrowLeft />
                </button>
                <span className="pad-center">z</span>
                <button className="right" aria-label="Move right" {...hold(1, 0)}>
                  <ArrowRight />
                </button>
                <button className="down" aria-label="Move backward" {...hold(0, 1)}>
                  <ArrowDown />
                </button>
              </div>
              <p>HOLD ARROW TO DRIVE · PINCH TO ZOOM · DRAG TO SPIN</p>
            </section>
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
          <DialogTitle className="permission-title">Your table is the showroom.</DialogTitle>
          <DialogDescription className="permission-description">
            Experience real table-locked AR with card tracking, or try free overlay and 3D preview.
          </DialogDescription>

          <div className="camera-explainer">
            <b>🎯 Real Table-Locked AR (Recommended)</b>
            <p>
              Place the tracking card flat on your table. The camera locks the car to the card in 6-DOF, so when you move
              your phone up or tilt it, the car stays solidly on your table!
            </p>
            <button
              className="card-preview-link"
              onClick={() => {
                setPermission(false);
                setCardModal(true);
              }}
            >
              <FileText size={14} /> View or print tracking card ↗
            </button>
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

      {/* Tracking Card Modal */}
      <Dialog open={cardModal} onOpenChange={setCardModal}>
        <DialogContent className="card-modal-dialog">
          <div className="card-modal-header">
            <Target size={24} className="card-icon" />
            <div>
              <DialogTitle className="card-modal-title">AR Surface Tracking Card</DialogTitle>
              <DialogDescription className="card-modal-desc">
                Print this card or display it flat on a tablet, laptop, or another phone screen.
              </DialogDescription>
            </div>
          </div>

          <div className="card-image-wrap">
            <img src="/tracking-card.svg" alt="Zepto x Hot Wheels AR Tracking Card" className="card-svg-preview" />
          </div>

          <div className="card-instructions">
            <div className="instruction-step">
              <span>1</span>
              <p>Place this card flat on your table or desk.</p>
            </div>
            <div className="instruction-step">
              <span>2</span>
              <p>Aim your camera at the card. The car locks directly on top!</p>
            </div>
            <div className="instruction-step">
              <span>3</span>
              <p>Pinch to resize, drag to spin, and hold arrows to drive on the table.</p>
            </div>
          </div>

          <div className="card-modal-actions">
            <button className="outline-button" onClick={handlePrintCard}>
              <Printer size={16} /> Print Card
            </button>
            <a href="/tracking-card.svg" target="_blank" rel="noreferrer" className="outline-button download-link">
              <Download size={16} /> Download SVG
            </a>
          </div>

          <button className="pink-button" onClick={() => setCardModal(false)}>
            Got it, ready to play!
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
