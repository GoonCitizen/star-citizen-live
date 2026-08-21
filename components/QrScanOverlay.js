'use strict';

/**
 * In-page camera overlay when the native Play code scanner is unavailable
 * (desktop Electron / WebView without GMS). Uses BarcodeDetector when the
 * Chromium build exposes it.
 */

const React = require('react');

const CSS = `
  .qs-overlay{position:fixed;inset:0;z-index:70;background:rgba(8,10,14,.88);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:24px 16px;gap:12px}
  .qs-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(420px,94vw);padding:16px 18px}
  .qs-card h2{margin:0 0 8px;font-size:16px}
  .qs-card p{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--muted)}
  .qs-video{width:100%;border-radius:8px;background:#000;max-height:min(52vh,360px);object-fit:cover}
  .qs-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin:8px 0}
  .qs-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .qs-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 14px;
    font-size:13px;font-weight:600;cursor:pointer}
  .qs-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .qs-input{flex:1;min-width:160px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px}
`;

class QrScanOverlay extends React.Component {
  constructor (props) {
    super(props);
    this.state = { error: null, paste: '', detector: true };
    this._video = null;
    this._stream = null;
    this._timer = null;
    this._dead = false;
  }

  componentDidMount () {
    void this.startCamera();
  }

  componentWillUnmount () {
    this._dead = true;
    this.stopCamera();
  }

  stopCamera () {
    if (this._timer) {
      cancelAnimationFrame(this._timer);
      this._timer = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => {
        try { t.stop(); } catch (_) { /* ignore */ }
      });
      this._stream = null;
    }
  }

  async startCamera () {
    const Detector = typeof window !== 'undefined' ? window.BarcodeDetector : null;
    if (typeof Detector !== 'function') {
      this.setState({ detector: false, error: 'This shell has no QR detector — paste the fabric://link from the other device.' });
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.setState({ detector: false, error: 'Camera is not available. Paste the fabric://link instead.' });
      return;
    }
    try {
      const detector = new Detector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      if (this._dead) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this._stream = stream;
      if (this._video) {
        this._video.srcObject = stream;
        try { await this._video.play(); } catch (_) { /* autoplay */ }
      }
      const tick = async () => {
        if (this._dead || !this._video) return;
        try {
          if (this._video.readyState >= 2) {
            const codes = await detector.detect(this._video);
            const raw = codes && codes[0] && codes[0].rawValue;
            if (raw) {
              this.stopCamera();
              if (typeof this.props.onScan === 'function') this.props.onScan(String(raw));
              return;
            }
          }
        } catch (_) { /* keep scanning */ }
        this._timer = requestAnimationFrame(tick);
      };
      this._timer = requestAnimationFrame(tick);
    } catch (e) {
      this.setState({
        detector: false,
        error: (e && e.message) ? e.message : 'Could not open the camera.'
      });
    }
  }

  submitPaste () {
    const text = String(this.state.paste || '').trim();
    if (!text) return;
    this.stopCamera();
    if (typeof this.props.onScan === 'function') this.props.onScan(text);
  }

  render () {
    return React.createElement(React.Fragment, null,
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'qs-overlay', role: 'dialog', 'aria-modal': 'true' },
        React.createElement('div', { className: 'qs-card' },
          React.createElement('h2', null, 'Scan to link a device'),
          React.createElement('p', null,
            'Point the camera at the QR on the other GoonCitizen (Identity / Security → Add a device). A confirm modal then shows that key as emoji — match it with the other screen, then approve.'),
          this.state.detector
            ? React.createElement('video', {
              className: 'qs-video',
              ref: (el) => { this._video = el; },
              playsInline: true,
              muted: true,
              autoPlay: true
            })
            : null,
          this.state.error || this.props.error
            ? React.createElement('div', { className: 'qs-err' }, this.state.error || this.props.error)
            : null,
          React.createElement('div', { className: 'qs-row' },
            React.createElement('input', {
              className: 'qs-input',
              type: 'text',
              placeholder: 'or paste fabric://link?sessionId=…',
              value: this.state.paste,
              onChange: (e) => this.setState({ paste: e.target.value }),
              onKeyDown: (e) => { if (e.key === 'Enter') this.submitPaste(); }
            }),
            React.createElement('button', {
              type: 'button',
              className: 'qs-btn ghost',
              onClick: () => this.submitPaste()
            }, 'Open'),
            React.createElement('button', {
              type: 'button',
              className: 'qs-btn ghost',
              onClick: () => {
                this.stopCamera();
                if (typeof this.props.onClose === 'function') this.props.onClose();
              }
            }, 'Cancel')
          )
        )
      )
    );
  }
}

module.exports = QrScanOverlay;
