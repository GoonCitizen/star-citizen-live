'use strict';

/**
 * Local tags — operator-only lists of Discord / Fabric identities, with notes.
 * Distinct from Federation Groups (k-of-n contracts on the mesh).
 */

const React = require('react');
const IdentityNotePanel = require('./IdentityNotePanel');

const BASE = '/services/star-citizen';

const CSS = `
  .lg-mode{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--line)}
  .lg-mode button{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer}
  .lg-mode button.on{background:rgba(59,130,246,.16);border-color:var(--accent);color:var(--accent)}
  .lg-add{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap}
  .lg-add input{flex:1;min-width:120px;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12px}
`;

class LocalGroups extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      groups: [],
      selectedId: null,
      name: '',
      addActor: '',
      addHandle: '',
      selectedMember: null,
      loading: true,
      creating: false,
      error: null,
      notice: null
    };
  }

  headers () {
    const token = this.props.authToken;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  componentDidMount () {
    this.refresh();
  }

  async refresh () {
    try {
      const res = await fetch(`${BASE}/local-groups`, { headers: this.headers() });
      const json = await res.json();
      const groups = json.data || [];
      const selectedId = this.state.selectedId && groups.some((g) => g.id === this.state.selectedId)
        ? this.state.selectedId
        : (groups[0] ? groups[0].id : null);
      this.setState({ groups, selectedId, loading: false, error: null });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  selected () {
    return (this.state.groups || []).find((g) => g.id === this.state.selectedId) || null;
  }

  async create () {
    const name = String(this.state.name || '').trim();
    if (!name) return;
    this.setState({ creating: true, error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/local-groups`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify({ name })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create tag');
      this.setState({ name: '', creating: false, notice: 'Tag created', selectedId: json.data && json.data.id });
      await this.refresh();
    } catch (e) {
      this.setState({ creating: false, error: e.message || String(e) });
    }
  }

  async addMember () {
    const group = this.selected();
    const actor = String(this.state.addActor || '').trim();
    if (!group || !actor) return;
    this.setState({ error: null, notice: null });
    try {
      const res = await fetch(`${BASE}/local-groups/${encodeURIComponent(group.id)}/members`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify({ actor, handle: this.state.addHandle || null })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not add member');
      this.setState({ addActor: '', addHandle: '', notice: 'Member added' });
      await this.refresh();
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  async removeMember (actor) {
    const group = this.selected();
    if (!group || !actor) return;
    try {
      const res = await fetch(
        `${BASE}/local-groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(actor)}`,
        { method: 'DELETE', headers: this.headers() }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not remove member');
      if (this.state.selectedMember && this.state.selectedMember.actor === actor) {
        this.setState({ selectedMember: null });
      }
      await this.refresh();
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  async deleteTag () {
    const group = this.selected();
    if (!group) return;
    try {
      const res = await fetch(`${BASE}/local-groups/${encodeURIComponent(group.id)}`, {
        method: 'DELETE',
        headers: this.headers()
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not delete tag');
      this.setState({ selectedId: null, selectedMember: null, notice: 'Tag deleted' });
      await this.refresh();
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  renderList () {
    const groups = this.state.groups || [];
    return React.createElement(React.Fragment, null,
      this.props.rosterToggle || null,
      React.createElement('div', { className: 'gp-form' },
        React.createElement('label', null, 'New local tag'),
        React.createElement('input', {
          value: this.state.name,
          placeholder: 'e.g. Officers, Hangar crew',
          onChange: (e) => this.setState({ name: e.target.value })
        }),
        React.createElement('button', {
          type: 'button',
          className: 'gp-btn',
          disabled: this.state.creating || !String(this.state.name || '').trim(),
          onClick: () => this.create()
        }, this.state.creating ? 'Creating…' : 'Create tag')
      ),
      this.state.loading
        ? React.createElement('div', { className: 'empty' }, 'loading…')
        : (groups.length
          ? groups.map((g) => React.createElement('div', {
            className: 'gp-row' + (g.id === this.state.selectedId ? ' on' : ''),
            key: g.id,
            onClick: () => this.setState({ selectedId: g.id, selectedMember: null, error: null, notice: null })
          },
          React.createElement('span', { className: 'n' }, g.name),
          React.createElement('span', { className: 'd' },
            `${(g.members || []).length} member${(g.members || []).length === 1 ? '' : 's'}`)
          ))
          : React.createElement('div', { className: 'empty' }, 'no local tags yet'))
    );
  }

  renderDetail () {
    const group = this.selected();
    if (!group) {
      return React.createElement('div', { className: 'gp-hint' },
        'Create a local tag to group Discord members or Fabric identities. Tags stay on this node — share notes separately to a Federation group or a peer.');
    }
    const members = group.members || [];
    const selected = this.state.selectedMember;
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'gp-meta' },
        React.createElement('span', null, React.createElement('b', null, group.name)),
        React.createElement('span', null, `${members.length} member${members.length === 1 ? '' : 's'}`)
      ),
      members.map((m) => React.createElement('div', {
        className: 'gp-member',
        key: m.actor,
        style: selected && selected.actor === m.actor ? { background: 'var(--panel2)' } : null
      },
      React.createElement('code', {
        title: m.actor,
        style: { cursor: 'pointer' },
        onClick: () => this.setState({ selectedMember: m })
      }, m.handle || m.actor),
      React.createElement('span', { className: 'gp-tag ' + (m.kind === 'discord' ? 'public' : 'creator') }, m.kind),
      React.createElement('button', {
        type: 'button',
        className: 'gp-btn danger',
        onClick: () => this.removeMember(m.actor)
      }, 'Remove')
      )),
      React.createElement('div', { className: 'lg-add' },
        React.createElement('input', {
          value: this.state.addActor,
          placeholder: 'discord:<id> or Fabric pubkey',
          onChange: (e) => this.setState({ addActor: e.target.value })
        }),
        React.createElement('input', {
          value: this.state.addHandle,
          placeholder: 'handle (optional)',
          onChange: (e) => this.setState({ addHandle: e.target.value })
        }),
        React.createElement('button', {
          type: 'button',
          className: 'gp-btn',
          disabled: !String(this.state.addActor || '').trim(),
          onClick: () => this.addMember()
        }, 'Add')
      ),
      selected
        ? React.createElement('div', { style: { padding: '10px 14px' } },
          React.createElement(IdentityNotePanel, {
            actor: selected.actor,
            handle: selected.handle,
            authToken: this.props.authToken,
            shareGroups: this.props.shareGroups || [],
            compact: false
          })
        )
        : React.createElement('div', { className: 'gp-hint' },
          'Select a member to add or share a note.'),
      React.createElement('div', { className: 'gp-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'gp-btn danger',
          onClick: () => this.deleteTag()
        }, 'Delete tag')
      )
    );
  }

  render () {
    const collapsed = this.props.sidebarCollapsed;
    return React.createElement('div', { className: 'gp-wrap' + (collapsed ? ' collapsed' : '') },
      React.createElement('aside', { className: 'panel gp-side' },
        collapsed
          ? React.createElement('div', { className: 'gp-rail' },
            React.createElement('button', {
              type: 'button',
              className: 'gp-rail-btn',
              title: 'Expand local tags',
              onClick: () => this.props.setSidebarCollapsed && this.props.setSidebarCollapsed(false)
            }, 'Local tags')
          )
          : null,
        React.createElement('div', { className: 'gp-side-body' },
          React.createElement('div', { className: 'gp-side-head' },
            React.createElement('h2', null, '🏷️ Local tags ',
              React.createElement('span', { className: 'sub' }, '— Discord / Fabric identity lists on this node')
            ),
            React.createElement('button', {
              type: 'button',
              className: 'gp-collapse',
              title: 'Collapse',
              onClick: () => this.props.setSidebarCollapsed && this.props.setSidebarCollapsed(true)
            }, '⟨')
          ),
          this.renderList()
        )
      ),
      React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '🛠️ Tag ',
          React.createElement('span', { className: 'sub' }, '— members & notes')
        ),
        this.state.error ? React.createElement('div', { className: 'gp-err' }, this.state.error) : null,
        this.state.notice ? React.createElement('div', { className: 'gp-ok' }, this.state.notice) : null,
        this.renderDetail()
      )
    );
  }
}

LocalGroups.CSS = CSS + '\n' + (IdentityNotePanel.CSS || '');

module.exports = LocalGroups;
