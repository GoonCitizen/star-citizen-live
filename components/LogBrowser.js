'use strict';

/**
 * Feed file browser — import entire folders and/or a hand-picked list of
 * Game.log / logbackup files into cumulative history.
 * GET …/fs · POST …/corpus/import · Electron native pickers when available.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .lb-wrap{padding:10px 14px 14px}
  .lb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .lb-path{flex:1;min-width:180px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:11.5px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px}
  .lb-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px;font-size:12px}
  .lb-crumb{background:transparent;border:none;color:var(--accent);cursor:pointer;padding:2px 4px;
    font-size:12px;font-family:inherit}
  .lb-crumb:hover{text-decoration:underline}
  .lb-crumb.here{color:var(--text);cursor:default;font-weight:600}
  .lb-sep{color:var(--muted)}
  .lb-list{max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .lb-item{display:flex;gap:10px;align-items:center;width:100%;text-align:left;
    background:transparent;border:none;border-bottom:1px solid var(--line);color:var(--text);
    padding:7px 10px;font-size:12px;cursor:pointer;font-family:inherit}
  .lb-item:last-child{border-bottom:none}
  .lb-item:hover{background:var(--panel2)}
  .lb-item.sel{background:rgba(88,166,255,.08)}
  .lb-item .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lb-item input[type=checkbox]{margin:0;accent-color:var(--accent)}
  .lb-empty{color:var(--muted);font-size:12.5px;padding:16px;text-align:center;font-style:italic}
  .lb-err{color:var(--kill);font-size:12px;margin:6px 0}
  .lb-imported{margin-top:10px}
  .lb-imported li{display:flex;gap:8px;align-items:baseline;font-size:12px;padding:3px 0;
    border-bottom:1px solid var(--line);list-style:none}
  .lb-imported ul{margin:0;padding:0}
  .lb-imported .rm{background:transparent;border:1px solid var(--line);color:var(--muted);
    border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}
  .lb-imported .rm:hover{border-color:var(--kill);color:var(--kill)}
  .lb-hint{color:var(--muted);font-size:11.5px;line-height:1.5;margin:0 0 10px}
  .lb-selbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;
    font-size:12px;color:var(--muted)}
`;

function fmtBytes (b) {
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

function shortPath (p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]+/);
  if (parts.length <= 4) return p;
  return '…/' + parts.slice(-4).join('/');
}

function crumbParts (absPath) {
  if (!absPath) return [];
  const norm = String(absPath).replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  const out = [];
  let acc = norm.startsWith('/') ? '/' : '';
  for (let i = 0; i < parts.length; i++) {
    acc = i === 0 && !norm.startsWith('/')
      ? parts[i] + (parts[i].endsWith(':') ? '/' : '')
      : (acc.endsWith('/') ? acc + parts[i] : acc + '/' + parts[i]);
    if (i === 0 && /^[A-Za-z]:$/.test(parts[i])) acc = parts[i] + '/';
    out.push({ label: parts[i], path: acc });
  }
  return out;
}

class LogBrowser extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      open: props.defaultOpen !== false,
      path: '',
      listing: null,
      pathInput: '',
      selected: new Set(),
      loading: false,
      busy: false,
      error: null,
      status: null
    };
  }

  componentDidMount () {
    if (this.state.open) this.browse('');
  }

  hasNativePicker () {
    return !!(window.electronAPI && window.electronAPI.dialog);
  }

  selectedCount () {
    return this.state.selected.size;
  }

  toggleFile (filePath, checked) {
    const next = new Set(this.state.selected);
    if (checked) next.add(filePath);
    else next.delete(filePath);
    this.setState({ selected: next });
  }

  selectAllLogsHere () {
    const entries = (this.state.listing && this.state.listing.entries) || [];
    const next = new Set(this.state.selected);
    for (const e of entries) {
      if (e.isLog) next.add(e.path);
    }
    this.setState({ selected: next });
  }

  clearSelection () {
    this.setState({ selected: new Set() });
  }

  async openBrowser (startPath) {
    this.setState({ open: true, error: null, status: null });
    await this.browse(startPath || this.state.path || '');
  }

  async browse (dirPath) {
    this.setState({ loading: true, error: null });
    try {
      const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
      const res = await fetch(`${BASE}/fs${q}`);
      const j = await res.json();
      if (!res.ok && j.error === 'path not found') {
        this.setState({ listing: j, path: j.path || dirPath, pathInput: j.path || dirPath, loading: false, error: j.error });
        return;
      }
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({
        listing: j,
        path: j.path,
        pathInput: j.path,
        loading: false,
        error: j.error || null
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async importSelection ({ dirs = [], files = [] } = {}) {
    const dirList = (dirs || []).filter(Boolean);
    const fileList = (files || []).filter(Boolean);
    if (!dirList.length && !fileList.length) return;
    this.setState({ busy: true, error: null, status: 'Importing…' });
    try {
      const res = await fetch(`${BASE}/corpus/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirs: dirList, files: fileList, sync: true })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      const n = (j.result && j.result.files) || 0;
      const lines = (j.result && j.result.lines) || 0;
      const parts = [];
      if (dirList.length) parts.push(`${dirList.length} folder(s)`);
      if (fileList.length) parts.push(`${fileList.length} file(s)`);
      this.setState({
        busy: false,
        status: `Imported ${parts.join(' + ')} · ${n} log files in corpus · ${lines} new lines parsed`,
        selected: fileList.length ? new Set() : this.state.selected
      });
      if (typeof this.props.onImported === 'function') this.props.onImported(j);
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e), status: null });
    }
  }

  async removeImport ({ dirs = [], files = [] } = {}) {
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`${BASE}/corpus/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirs, files })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ busy: false, status: 'Removed from import list (history kept)' });
      if (typeof this.props.onImported === 'function') this.props.onImported(j);
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async pickNativeFolders () {
    if (!(window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openDirectory)) return;
    this.setState({ busy: true, error: null });
    try {
      const result = await window.electronAPI.dialog.openDirectory();
      if (!result || result.canceled || !result.paths.length) {
        this.setState({ busy: false });
        return;
      }
      await this.importSelection({ dirs: result.paths });
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async pickNativeFiles () {
    if (!(window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openLogFiles)) return;
    this.setState({ busy: true, error: null });
    try {
      const result = await window.electronAPI.dialog.openLogFiles();
      if (!result || result.canceled || !result.paths.length) {
        this.setState({ busy: false });
        return;
      }
      await this.importSelection({ files: result.paths });
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async importRepoSamples () {
    // Server resolves relative to the relay process cwd (repo root for npm start).
    await this.importSelection({ dirs: ['samples'] });
  }

  renderCrumbs () {
    const crumbs = crumbParts(this.state.path);
    if (!crumbs.length) return null;
    return React.createElement('div', { className: 'lb-crumbs' },
      crumbs.map((c, i) => React.createElement(React.Fragment, { key: c.path },
        i > 0 ? React.createElement('span', { className: 'lb-sep' }, '/') : null,
        i === crumbs.length - 1
          ? React.createElement('span', { className: 'lb-crumb here' }, c.label)
          : React.createElement('button', {
            type: 'button', className: 'lb-crumb',
            onClick: () => this.browse(c.path)
          }, c.label)
      ))
    );
  }

  renderListing () {
    const listing = this.state.listing;
    if (this.state.loading) {
      return React.createElement('div', { className: 'lb-empty' }, 'listing…');
    }
    if (!listing) return null;
    const parent = listing.parent;
    const entries = listing.entries || [];
    const selected = this.state.selected;
    return React.createElement('div', { className: 'lb-list' },
      parent
        ? React.createElement('button', {
          type: 'button', className: 'lb-item',
          onClick: () => this.browse(parent)
        },
        React.createElement('span', { className: 'chip' }, '↑'),
        React.createElement('span', { className: 'nm' }, '..'))
        : null,
      entries.length === 0
        ? React.createElement('div', { className: 'lb-empty' }, 'Empty folder')
        : entries.map((e) => {
          const isDir = e.type === 'dir';
          const isSel = selected.has(e.path);
          if (isDir) {
            return React.createElement('button', {
              key: e.path,
              type: 'button',
              className: 'lb-item',
              title: e.path,
              onClick: () => this.browse(e.path)
            },
            React.createElement('span', { className: 'chip' }, 'dir'),
            React.createElement('span', { className: 'nm' }, e.name),
            e.logCount > 0
              ? React.createElement('span', { className: 'sub' }, `${e.logCount} .log`)
              : null
            );
          }
          if (!e.isLog) {
            return React.createElement('div', {
              key: e.path,
              className: 'lb-item',
              style: { cursor: 'default', opacity: 0.55 },
              title: e.path
            },
            React.createElement('span', { className: 'chip' }, 'file'),
            React.createElement('span', { className: 'nm' }, e.name),
            e.size != null ? React.createElement('span', { className: 'sub' }, fmtBytes(e.size)) : null
            );
          }
          return React.createElement('label', {
            key: e.path,
            className: 'lb-item' + (isSel ? ' sel' : ''),
            title: e.path,
            style: { cursor: 'pointer' }
          },
          React.createElement('input', {
            type: 'checkbox',
            checked: isSel,
            onChange: (ev) => this.toggleFile(e.path, ev.target.checked)
          }),
          React.createElement('span', { className: 'chip on' }, 'log'),
          React.createElement('span', { className: 'nm' }, e.name),
          e.size != null ? React.createElement('span', { className: 'sub' }, fmtBytes(e.size)) : null
          );
        })
    );
  }

  renderImported () {
    const dirs = this.props.importedDirs || [];
    const files = this.props.importedFiles || [];
    if (!dirs.length && !files.length) {
      return React.createElement('div', { className: 'sub', style: { marginTop: 8 } },
        'Nothing imported yet — choose a folder, pick files, or browse below. Auto-discovery still covers install Game.log + logbackups + ./Gamelogs.');
    }
    return React.createElement('div', { className: 'lb-imported' },
      dirs.length
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'sub', style: { marginBottom: 6 } },
            `${dirs.length} imported folder${dirs.length === 1 ? '' : 's'}`),
          React.createElement('ul', null,
            dirs.map((d) => React.createElement('li', { key: 'd:' + d },
              React.createElement('span', { className: 'chip' }, 'folder'),
              React.createElement('span', { className: 'sub', title: d, style: { flex: 1 } }, shortPath(d)),
              React.createElement('button', {
                type: 'button', className: 'rm', disabled: this.state.busy,
                onClick: () => this.removeImport({ dirs: [d] })
              }, 'Remove')
            ))
          )
        )
        : null,
      files.length
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'sub', style: { margin: '10px 0 6px' } },
            `${files.length} imported file${files.length === 1 ? '' : 's'}`),
          React.createElement('ul', null,
            files.map((f) => React.createElement('li', { key: 'f:' + f },
              React.createElement('span', { className: 'chip on' }, 'log'),
              React.createElement('span', { className: 'sub', title: f, style: { flex: 1 } }, shortPath(f)),
              React.createElement('button', {
                type: 'button', className: 'rm', disabled: this.state.busy,
                onClick: () => this.removeImport({ files: [f] })
              }, 'Remove')
            ))
          )
        )
        : null
    );
  }

  render () {
    const listing = this.state.listing;
    const selCount = this.selectedCount();
    const native = this.hasNativePicker();
    const canPickDirs = !!(native && window.electronAPI.dialog.openDirectory);
    const canPickFiles = !!(native && window.electronAPI.dialog.openLogFiles);

    return React.createElement('div', { className: 'lb-wrap' },
      React.createElement('p', { className: 'lb-hint' },
        'Import an entire folder of Star Citizen logs, or tick individual *.log files. Parsed into cumulative history — the game install is never modified.'),
      React.createElement('div', { className: 'lb-row' },
        canPickDirs
          ? React.createElement('button', {
            type: 'button', className: 'btn', disabled: this.state.busy,
            onClick: () => this.pickNativeFolders()
          }, 'Choose folder…')
          : null,
        canPickFiles
          ? React.createElement('button', {
            type: 'button', className: 'btn', disabled: this.state.busy,
            onClick: () => this.pickNativeFiles()
          }, 'Choose files…')
          : null,
        React.createElement('button', {
          type: 'button', className: 'btn', disabled: this.state.busy,
          onClick: () => this.importRepoSamples(),
          title: 'Import ./samples if present (developer / fixture corpus)'
        }, 'Import samples/'),
        React.createElement('button', {
          type: 'button', className: 'btn', disabled: this.state.busy,
          onClick: () => this.state.open ? this.setState({ open: false }) : this.openBrowser()
        }, this.state.open ? 'Hide browser' : 'Browse files'),
        this.state.open && listing
          ? React.createElement('button', {
            type: 'button', className: 'btn', disabled: this.state.busy || !listing.path,
            onClick: () => this.importSelection({ dirs: [listing.path] })
          }, 'Import this folder')
          : null,
        this.state.open && selCount > 0
          ? React.createElement('button', {
            type: 'button', className: 'btn', disabled: this.state.busy,
            onClick: () => this.importSelection({ files: [...this.state.selected] })
          }, `Import ${selCount} selected file${selCount === 1 ? '' : 's'}`)
          : null
      ),
      this.renderImported(),
      this.state.error ? React.createElement('div', { className: 'lb-err' }, this.state.error) : null,
      this.state.status ? React.createElement('div', { className: 'sub', style: { marginTop: 6 } }, this.state.status) : null,
      this.state.open
        ? React.createElement('div', { style: { marginTop: 10 } },
          React.createElement('div', { className: 'lb-row' },
            React.createElement('input', {
              className: 'lb-path',
              value: this.state.pathInput,
              placeholder: 'Absolute path to a folder of logs',
              onChange: (e) => this.setState({ pathInput: e.target.value }),
              onKeyDown: (e) => {
                if (e.key === 'Enter') this.browse(this.state.pathInput.trim());
              }
            }),
            React.createElement('button', {
              type: 'button', className: 'btn', disabled: this.state.loading,
              onClick: () => this.browse(this.state.pathInput.trim())
            }, 'Go')
          ),
          this.renderCrumbs(),
          listing
            ? React.createElement('div', { className: 'lb-selbar' },
              React.createElement('span', null,
                `${listing.dirCount || 0} folders · ${listing.logCount || 0} .log here` +
                (selCount ? ` · ${selCount} selected` : '')),
              listing.logCount > 0
                ? React.createElement('button', {
                  type: 'button', className: 'btn',
                  onClick: () => this.selectAllLogsHere()
                }, 'Select all .log here')
                : null,
              selCount
                ? React.createElement('button', {
                  type: 'button', className: 'btn',
                  onClick: () => this.clearSelection()
                }, 'Clear selection')
                : null
            )
            : null,
          this.renderListing()
        )
        : null
    );
  }
}

LogBrowser.CSS = CSS;
module.exports = LogBrowser;
