'use strict';

/**
 * Compact note + local-tag controls for a Discord or Fabric identity.
 * Used on Chat member hover cards, the Local tags pane, and the operator's
 * profile ("My notes"). Per-row 📌 pins a note to the subject's public
 * profile; 👥 shares it to a Federation group.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .inote{display:grid;gap:6px;padding-top:6px;border-top:1px solid var(--line)}
  .inote h4{margin:0;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .inote .row{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.4;color:var(--text);
    padding:4px 0;border-bottom:1px solid #20262f}
  .inote .row:last-of-type{border-bottom:none}
  .inote .row .txt{flex:1;min-width:0}
  .inote .row .acts{display:flex;gap:4px;flex-shrink:0}
  .inote .ico{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer;line-height:1.3}
  .inote .ico.on{border-color:var(--accent);color:var(--accent)}
  .inote .ico:disabled{opacity:.45;cursor:default}
  .inote .row-share{padding:0 0 8px}
  .inote textarea,.inote input,.inote select{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:6px 8px;font-size:12px;box-sizing:border-box}
  .inote textarea{min-height:52px;resize:vertical}
  .inote .actions{display:flex;flex-wrap:wrap;gap:6px}
  .inote .btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:5px 10px;
    font-size:11.5px;font-weight:600;cursor:pointer}
  .inote .btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .inote .btn:disabled{opacity:.45;cursor:default}
  .inote .ok{font-size:11.5px;color:var(--good)}
  .inote .err{font-size:11.5px;color:var(--kill)}
  .inote .hint{font-size:11px;color:var(--muted);line-height:1.4}
`;

class IdentityNotePanel extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      notes: [],
      groups: [],
      fedGroups: [],
      draft: '',
      tagId: '',
      shareNoteId: '',
      shareScope: 'group',
      shareGroupId: '',
      sharePeer: props.sharePeer || '',
      shareOpen: false,
      busy: false,
      error: null,
      ok: null
    };
  }

  headers () {
    const token = this.props.authToken;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  componentDidMount () {
    this.load();
  }

  componentDidUpdate (prev) {
    if (prev.actor !== this.props.actor || prev.mine !== this.props.mine) this.load();
    if (prev.sharePeer !== this.props.sharePeer && this.props.sharePeer && !this.state.sharePeer) {
      this.setState({ sharePeer: this.props.sharePeer });
    }
  }

  async load () {
    const actor = this.props.actor;
    if (!actor && !this.props.mine) return;
    try {
      const notesUrl = this.props.mine
        ? `${BASE}/notes?mine=1`
        : `${BASE}/notes?subject=${encodeURIComponent(actor)}`;
      const [notesRes, groupsRes, fedRes] = await Promise.all([
        fetch(notesUrl, { headers: this.headers() }),
        fetch(`${BASE}/local-groups`, { headers: this.headers() }),
        fetch(`${BASE}/groups`, { headers: this.headers() })
      ]);
      const notesJson = notesRes.ok ? await notesRes.json() : { data: [] };
      const groupsJson = groupsRes.ok ? await groupsRes.json() : { data: [] };
      const fedJson = fedRes.ok ? await fedRes.json() : { data: [] };
      const notes = notesJson.data || [];
      this.setState({
        notes,
        groups: groupsJson.data || [],
        fedGroups: fedJson.data || [],
        shareNoteId: notes[0] ? notes[0].id : '',
        error: null
      });
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  async save () {
    const body = String(this.state.draft || '').trim();
    if (!body || !this.props.actor) return;
    this.setState({ busy: true, error: null, ok: null });
    try {
      const res = await fetch(`${BASE}/notes`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify({
          subject: this.props.actor,
          handle: this.props.handle || null,
          body
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save note');
      this.setState({ draft: '', ok: 'Note saved', busy: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async addToTag () {
    const tagId = this.state.tagId;
    if (!tagId || !this.props.actor) return;
    this.setState({ busy: true, error: null, ok: null });
    try {
      const res = await fetch(`${BASE}/local-groups/${encodeURIComponent(tagId)}/members`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify({
          actor: this.props.actor,
          handle: this.props.handle || null
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not add to tag');
      this.setState({ ok: 'Added to tag', busy: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  async shareWithPeer () {
    const peer = this.props.sharePeer || this.state.sharePeer;
    if (!peer) return;
    this.setState({ shareScope: 'peer', sharePeer: peer, shareOpen: true }, () => this.share());
  }

  async pinNote (note, pinned) {
    if (!note || !note.id) return;
    this.setState({ busy: true, error: null, ok: null });
    try {
      const res = await fetch(`${BASE}/notes/${encodeURIComponent(note.id)}/pin`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify({ pinned: pinned === true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not pin note');
      this.setState({
        busy: false,
        ok: pinned ? 'Pinned to profile' : 'Unpinned from profile'
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  openGroupShare (note) {
    if (!note || !note.id) return;
    const shareGroups = this.shareGroups();
    if (shareGroups.length === 1) {
      this.setState({
        shareNoteId: note.id,
        shareScope: 'group',
        shareGroupId: shareGroups[0].id,
        shareOpen: false
      }, () => this.share());
      return;
    }
    this.setState({
      shareNoteId: note.id,
      shareScope: 'group',
      shareOpen: this.state.shareOpen && this.state.shareNoteId === note.id
        ? false
        : true,
      ok: null,
      error: null
    });
  }

  async share () {
    const noteId = this.state.shareNoteId || (this.state.notes[0] && this.state.notes[0].id);
    if (!noteId) return;
    this.setState({ busy: true, error: null, ok: null });
    try {
      const payload = { scope: this.state.shareScope };
      if (this.state.shareScope === 'group') payload.groupId = this.state.shareGroupId;
      else payload.peerPubkey = this.state.sharePeer;
      const res = await fetch(`${BASE}/notes/${encodeURIComponent(noteId)}/share`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not share note');
      this.setState({ ok: 'Note shared', busy: false, shareOpen: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message || String(e) });
    }
  }

  shareGroups () {
    if (this.props.shareGroups && this.props.shareGroups.length) return this.props.shareGroups;
    return this.state.fedGroups || [];
  }

  canPin (note) {
    if (!note || note.inbound === true) return false;
    const me = this.props.identityPubkey;
    if (me && note.author && note.author !== 'local' && note.author !== me) return false;
    return true;
  }

  renderNoteRow (n) {
    const pinned = n.profilePinned === true;
    const sharing = this.state.shareOpen && this.state.shareNoteId === n.id &&
      this.state.shareScope === 'group';
    const shareGroups = this.shareGroups();
    return React.createElement(React.Fragment, { key: n.id },
      React.createElement('div', { className: 'row' },
        React.createElement('div', { className: 'txt' },
          n.body,
          n.visibility && n.visibility !== 'private'
            ? React.createElement('span', { className: 'hint' }, ' · ' + n.visibility)
            : null,
          pinned
            ? React.createElement('span', { className: 'hint' }, ' · pinned')
            : null
        ),
        React.createElement('div', { className: 'acts' },
          React.createElement('button', {
            type: 'button',
            className: 'ico' + (pinned ? ' on' : ''),
            title: pinned
              ? 'Unpin from profile'
              : 'Pin this note to profile for public warnings, notes, and comments',
            disabled: this.state.busy || !this.canPin(n),
            onClick: (e) => {
              e.stopPropagation();
              this.pinNote(n, !pinned);
            }
          }, '📌'),
          React.createElement('button', {
            type: 'button',
            className: 'ico' + (sharing ? ' on' : ''),
            title: 'Share this note to a Federation group',
            disabled: this.state.busy || !this.canPin(n),
            onClick: (e) => {
              e.stopPropagation();
              this.openGroupShare(n);
            }
          }, '👥')
        )
      ),
      sharing
        ? React.createElement('div', { className: 'row-share' },
          shareGroups.length
            ? React.createElement(React.Fragment, null,
              React.createElement('select', {
                value: this.state.shareGroupId,
                onChange: (e) => this.setState({ shareGroupId: e.target.value }),
                onClick: (e) => e.stopPropagation()
              },
              React.createElement('option', { value: '' }, 'Choose a group…'),
              shareGroups.map((g) => React.createElement('option', { key: g.id, value: g.id }, g.name))),
              React.createElement('div', { className: 'actions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'btn',
                  disabled: this.state.busy || !this.state.shareGroupId,
                  onClick: (e) => { e.stopPropagation(); this.share(); }
                }, 'Share to group')
              )
            )
            : React.createElement('div', { className: 'hint' },
              'No groups yet — create one on the Groups tab.')
        )
        : null
    );
  }

  render () {
    const notes = this.state.notes || [];
    const groups = this.state.groups || [];
    const compact = this.props.compact !== false;
    const shown = compact ? notes.slice(0, 2) : notes;
    const hideTags = this.props.hideTags === true || this.props.mine === true;
    return React.createElement('div', { className: 'inote', onClick: (e) => e.stopPropagation() },
      React.createElement('h4', null, this.props.mine ? 'My notes' : 'Notes'),
      shown.length
        ? shown.map((n) => this.renderNoteRow(n))
        : React.createElement('div', { className: 'hint' },
          this.props.mine ? 'No notes yet — add one below.' : 'No notes yet'),
      compact && notes.length > shown.length
        ? React.createElement('div', { className: 'hint' },
          (notes.length - shown.length) + ' more notes')
        : null,
      React.createElement('textarea', {
        value: this.state.draft,
        placeholder: this.props.mine ? 'Add a note…' : 'Add a note…',
        onChange: (e) => this.setState({ draft: e.target.value, ok: null }),
        onClick: (e) => e.stopPropagation()
      }),
      React.createElement('div', { className: 'actions' },
        React.createElement('button', {
          type: 'button',
          className: 'btn',
          disabled: this.state.busy || !String(this.state.draft || '').trim(),
          onClick: (e) => { e.stopPropagation(); this.save(); }
        }, this.state.busy ? 'Saving…' : 'Save note')
      ),
      hideTags
        ? null
        : React.createElement(React.Fragment, null,
          React.createElement('h4', null, 'Local tag'),
          groups.length
            ? React.createElement(React.Fragment, null,
              React.createElement('select', {
                value: this.state.tagId,
                onChange: (e) => this.setState({ tagId: e.target.value }),
                onClick: (e) => e.stopPropagation()
              },
              React.createElement('option', { value: '' }, 'Add to tag…'),
              groups.map((g) => React.createElement('option', { key: g.id, value: g.id },
                g.name + (g.members && g.members.some((m) => m.actor === this.props.actor) ? ' ✓' : '')
              ))),
              React.createElement('div', { className: 'actions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'btn ghost',
                  disabled: this.state.busy || !this.state.tagId,
                  onClick: (e) => { e.stopPropagation(); this.addToTag(); }
                }, 'Add to tag')
              )
            )
            : React.createElement('div', { className: 'hint' }, 'Create a local tag on the Groups tab')
        ),
      notes.length && this.props.sharePeer
        ? React.createElement('div', { className: 'actions' },
          React.createElement('button', {
            type: 'button',
            className: 'btn ghost',
            disabled: this.state.busy,
            onClick: (e) => { e.stopPropagation(); this.shareWithPeer(); }
          }, 'Share with this person')
        )
        : null,
      this.state.ok ? React.createElement('div', { className: 'ok' }, this.state.ok) : null,
      this.state.error ? React.createElement('div', { className: 'err' }, this.state.error) : null
    );
  }
}

IdentityNotePanel.CSS = CSS;

module.exports = IdentityNotePanel;
