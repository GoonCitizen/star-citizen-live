## Classes

<dl>
<dt><a href="#Group">Group</a></dt>
<dd></dd>
<dt><a href="#Mission">Mission</a> ⇐ <code>Entity</code></dt>
<dd><p>Represents a Mission in the Star Citizen universe.
Missions can be accepted by signing with secp256k1 or Musig2 multisig.</p>
</dd>
<dt><a href="#MissionApplication">MissionApplication</a> ⇐ <code>Entity</code></dt>
<dd><p>Represents an application to accept a Mission.</p>
</dd>
<dt><a href="#Store">Store</a></dt>
<dd></dd>
<dt><a href="#ChatManager">ChatManager</a></dt>
<dd></dd>
<dt><a href="#FabricNetwork">FabricNetwork</a></dt>
<dd></dd>
<dt><a href="#MissionManager">MissionManager</a></dt>
<dd><p>Mission Manager service.
Handles mission lifecycle, applications, and cryptographic verification.
Supports both single secp256k1 signatures and Musig2 multisig.</p>
</dd>
<dt><a href="#SnapshotManager">SnapshotManager</a></dt>
<dd></dd>
<dt><a href="#StarCitizen">StarCitizen</a> ⇐ <code>Hub</code></dt>
<dd><p>Core service for Star Citizen.
Provides a Fabric-compatible declarative API with Discord integration.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>Group — a member-created unit backed by a k-of-n Schnorr multisig of <strong>signers</strong>.</p>
<p><code>members</code> = all participants (readers + signers).
<code>validators</code> = signing federation (proposedPolicy.validators); tip / wallet / threshold.
Read-only members are in <code>members</code> but not <code>validators</code>.</p>
</dd>
<dt><a href="#fs">fs</a></dt>
<dd><p>Store — keyed-collection persistence for the mission register + groups.</p>
<p>Composes <code>@fabric/core</code> <a href="#Store">Store</a> (<code>this.fabric</code>). Named collections are
stored at Fabric paths <code>/collections/&lt;name&gt;</code> via <code>fabric.set</code> / <code>fabric.get</code>
(not raw Level key blobs). The sync façade (<code>get</code> / <code>put</code> / <code>all</code> / <code>count</code> /
<code>del</code>) keeps MissionManager / GroupManager simple.</p>
<p>Data lives under the named store root <code>stores/gooncitizen/</code> (Hub-style);
the register LevelDB is <code>stores/gooncitizen/register</code>.</p>
<p>Call <code>await store.start()</code> before reads that must see prior sessions, and
<code>await store.stop()</code> on shutdown so pending writes flush.</p>
<p>Memory-only when <code>path</code> is null (tests) — no Fabric Store is constructed.</p>
</dd>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>ChatManager — org chat brought forward from the Hub, on the Fabric Store.</p>
<p>Message types follow hub.fabric.pub conventions:</p>
<ul>
<li>stored records are <code>@type: &#39;ChatMessage&#39;</code></li>
<li><code>global</code> rides Fabric <code>P2P_CHAT_MESSAGE</code> (D-010)</li>
<li><code>group:&lt;groupId&gt;</code> rides <code>GroupChat</code> under that Group&#39;s Federation
<code>CONTRACT_MESSAGE</code> namespace (Groups-as-Federations)</li>
</ul>
<p>Channels:</p>
<ul>
<li><code>global</code>            — network chat on this node (all local viewers)</li>
<li><code>group:&lt;groupId&gt;</code>   — dedicated channel per group / subgroup, members
                  only in hosted mode (the local relay shows your groups)</li>
</ul>
<p>Ids are content-derived (channel + author + body + ts), so merging the
same message from multiple paths (local post, peer push, peer pull) is
idempotent — the same convergence rule as the event uplink.</p>
</dd>
<dt><a href="#DIRECT_CHAT_TYPE">DIRECT_CHAT_TYPE</a></dt>
<dd><p>GoonCitizen CONTRACT_MESSAGE body type for 1:1 chat (mesh).</p>
</dd>
<dt><a href="#EventEmitter">EventEmitter</a></dt>
<dd><p>FabricNetwork — local <code>@fabric/core</code> Peer for GoonCitizen peering.</p>
<p>Wire Messages:</p>
<ul>
<li>P2P_CHAT_MESSAGE     — network-wide <code>global</code> chat (Peer auto-relays)</li>
<li>CONTRACT_MESSAGE     — GoonCitizen app types + per-Group Federation types</li>
<li>CONTRACT_PUBLISH     — GoonCitizen genesis + per-Group Federation genesis</li>
</ul>
<p>Lazy-requires Peer/Message so memory-only unit tests stay light.</p>
</dd>
<dt><del><a href="#DEFAULT_SEED">DEFAULT_SEED</a></del></dt>
<dd></dd>
<dt><a href="#DEFAULT_MAX_PEERS">DEFAULT_MAX_PEERS</a></dt>
<dd><p>Default TCP peer cap (matches @fabric/core MAX_PEERS soft default for slot fill).</p>
</dd>
<dt><a href="#APP_RELAY_TYPES">APP_RELAY_TYPES</a></dt>
<dd><p>App <code>type</code> values under the GoonCitizen CONTRACT_MESSAGE namespace (core catalog + local).</p>
</dd>
<dt><a href="#_dnsOwnHostCache">_dnsOwnHostCache</a> : <code>Map.&lt;string, boolean&gt;</code></dt>
<dd></dd>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>GroupManager — member-created groups with k-of-n Schnorr multisig,
optional nested subgroups (<code>parentId</code>), public/private visibility,
custom page slugs, and join applications.</p>
<p>Groups are the sharing boundary across many GoonCitizen installations
on the Fabric mesh (not a single global &quot;org&quot;).</p>
<p>Group pages live at <code>/groups/:id</code> (or <code>/groups/:slug</code> when a custom slug
is set). Public groups can be shared; visitors apply to join; the creator
accepts or rejects. Private groups are members-only.</p>
<p>Persistence: uses <code>types/Store.js</code> (composes <code>@fabric/core</code> Store;
<code>/collections/*</code> paths) under
<code>stores/gooncitizen/register</code> (Hub-style named store root).</p>
</dd>
<dt><a href="#http">http</a></dt>
<dd><p>Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).</p>
<p>Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
events, fs, readline) plus global fetch (identity/group crypto loads lazily).
This file is the SERVICE DEFINITION only — the server entry that boots it
from the environment is <code>scripts/node.js</code> (<code>npm start</code>).</p>
<p>Features: in-memory collections, REST endpoints, live log tailing (read-only,
optional) AND offline replay, real Game.log event parsing (functions/parser.js),
optional Discord webhook posting, and the mission/contract seam.</p>
<p>It edits NOTHING in the Star Citizen installation - the log is only ever read.</p>
</dd>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>MissionManager — the org mission register (M5.1).</p>
<p>Implements D-005: a centralized, OFFICER-VALIDATED register. Lifecycle:
  open --apply--&gt; (applications) --officer accept / joinMission--&gt; assigned
       (many accepted participants; mission stays open for more joins)
       --claim(any participant)--&gt; pending claims
       --authorities approve ONE claim--&gt; completed (+ other pending → superseded)
       --authorities reject claim--&gt; mission stays assigned (re-claim allowed)
  open|assigned --officer cancel--&gt; cancelled</p>
<p>Claims may be individual or name a completionGroupId (group wallet payee).</p>
<p>Every mutation appends a hash-chained AuditEntry (tamper-evident; M6 adds
officer signatures over each entry). Backed by types/Store.js (in-memory
or <code>@fabric/core</code> Store / LevelDB under <code>stores/</code> when a path is configured).
Keeps the method names/events the rest of the code already uses
(createMission/getMission/missions, start/stop) so nothing else breaks.</p>
<p>Officer model: settings.officers is an allowlist of actor ids. If EMPTY, the
register runs in permissive &quot;bootstrap&quot; mode (everyone is an officer) so it is
usable before roles are wired (REST/Discord auth lands in M5.2/M5.3).</p>
<p>Optional <code>settings.isGroupMember(groupId, pubkey)</code> gates completionGroupId.</p>
</dd>
<dt><a href="#EventEmitter">EventEmitter</a></dt>
<dd><p>PayoutManager — Bitcoin-unlocked mission rewards.</p>
<p>A mission&#39;s reward can be escrowed on-chain in a k-of-n multisig address
built from the mission&#39;s AUTHORITY pubkeys (the same keys whose Schnorr
signatures accept the completion claim). Flow:</p>
<ol>
<li>createEscrow(mission)   -&gt; k-of-n P2WSH address (bitcoind createmultisig)</li>
<li>(creator funds address) -&gt; checkFunding() confirms via scantxoutset</li>
<li>claim accepted (k-of-n Schnorr on the acceptance message, MissionManager)
-&gt; &#39;payout:unlocked&#39; -&gt; escrow status &#39;payable&#39;</li>
<li>buildPayout()           -&gt; PSBT paying the claimant (authorities sign
                       with their own wallets — keys never touch
                       the server)</li>
<li>broadcastPayout(hex)    -&gt; sendrawtransaction</li>
</ol>
<p>Modes:</p>
<ul>
<li>LEDGER (no rpc): the obligation + authorization are recorded and
auditable; settlement happens out-of-band.</li>
<li>BITCOIN (rpc provided): full on-chain flow. Mainnet is refused unless
<code>allowMainnet: true</code> — regtest/signet first, by decision.</li>
</ul>
<p><code>rpc</code> is any <code>(method, params) =&gt; Promise&lt;result&gt;</code> — on goon.vc it wraps
the Hub&#39;s managed bitcoind (<code>@fabric/core</code> Bitcoin <code>_makeRPCRequest</code>).</p>
</dd>
<dt><a href="#fs">fs</a></dt>
<dd><p>SnapshotManager — periodic screen snapshots of player activity.</p>
<p>Captures a reduced-size JPEG on a configurable interval (default 10 s,
opt-in) so a future image analyzer can parse gameplay the log does not
cover. Image files live under the named Fabric store root
(<code>stores/gooncitizen/snapshots/</code>); metadata records live in the shared
Fabric Store <code>snapshots</code> collection ({ id, ts, file, bytes, width,
height }). Auto-purge deletes the oldest snapshots once the library
exceeds a disk cap, keeping requirements low.</p>
<p>The capture function is injected by the host (Electron main uses
<code>screenshot-desktop</code> + <code>nativeImage</code> downscaling); without one — pure
browser/server sessions — the manager stays idle.</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#dmChannelKey">dmChannelKey()</a></dt>
<dd><p>Deterministic DM channel key for two Fabric pubkeys.</p>
</dd>
<dt><a href="#parseDmChannel">parseDmChannel()</a></dt>
<dd><p>Parse <code>dm:&lt;pkA&gt;:&lt;pkB&gt;</code> → <code>{ a, b }</code> or null.</p>
</dd>
<dt><a href="#isNetworkHubAddress">isNetworkHubAddress()</a></dt>
<dd><p>True when address is a known network hub seed (selective Fabric relays).</p>
</dd>
<dt><a href="#isLoopbackFabricAddress">isLoopbackFabricAddress(address)</a> ⇒ <code>boolean</code></dt>
<dd><p>True when address uses a loopback host (localhost / 127.0.0.1 / ::1).
Local star-topology tests dial <code>127.0.0.1:otherPort</code> on purpose; only
<a href="#isSelfFabricAddress">isSelfFabricAddress</a> must be excluded from the dial list.</p>
</dd>
<dt><a href="#collectOwnFabricHosts">collectOwnFabricHosts([opts])</a> ⇒ <code>Set.&lt;string&gt;</code></dt>
<dd><p>Hostnames / IPs that identify this node for dial filtering.
Includes advertiseHost, optional ownHosts, FABRIC_* env public host, and
(by default) addresses from os.networkInterfaces().</p>
</dd>
<dt><a href="#hostnameResolvesToOwn">hostnameResolvesToOwn(host, ownHosts)</a> ⇒ <code>boolean</code></dt>
<dd><p>True when <code>host</code> is not an IP literal and DNS resolves it to a local interface.
Cached; failures cache as false for this process.</p>
</dd>
<dt><a href="#isSelfFabricAddress">isSelfFabricAddress(address, [listenPortOrOpts], [opts])</a> ⇒ <code>boolean</code></dt>
<dd><p>True when dialing this address would connect to this process (self-loop).
Covers loopback+listenPort, public advertise/env hostnames, local interface
IPs, and (when interfaces are available) hub hostnames that DNS to self.</p>
</dd>
<dt><a href="#isFabricAddress">isFabricAddress(value)</a> ⇒ <code>boolean</code></dt>
<dd><p>True when <code>value</code> looks like a Fabric peer address (<code>host:port</code>).</p>
</dd>
<dt><a href="#normalizeFabricAddress">normalizeFabricAddress(value, [opts])</a> ⇒ <code>string</code> | <code>null</code></dt>
<dd><p>Normalize operator input to <code>host:port</code>. Rejects bare http(s) URLs for new
peers; migrates legacy <code>https://host[/…]</code> → <code>host:7777</code> when <code>migrate</code> is set.</p>
</dd>
<dt><a href="#attachAppHandlers">attachAppHandlers(peer, handlers, [opts])</a></dt>
<dd><p>Subscribe app handlers to a Fabric Peer using its native message events.</p>
<p>Namespaces:</p>
<ul>
<li>GoonCitizen contract id → MissionCreated / MissionBroadcast / SCEventBatch</li>
<li>Group Federation contracts → GroupChat / GroupChange / GroupShare / invites
(by typed app message, and/or <code>handlers.isKnownGroupContract(id)</code>)</li>
</ul>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#StarCitizenActivity">StarCitizenActivity</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenPlayer">StarCitizenPlayer</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenVehicle">StarCitizenVehicle</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenKill">StarCitizenKill</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenLogEntry">StarCitizenLogEntry</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#DiscordConfig">DiscordConfig</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenSettings">StarCitizenSettings</a> : <code>Object</code></dt>
<dd></dd>
</dl>

## Interfaces

<dl>
<dt><a href="#StarCitizenAPI">StarCitizenAPI</a></dt>
<dd><p>Declarative API interface for Star Citizen Live service.</p>
<p>This interface defines the properties and methods exposed by the
StarCitizen service for programmatic access to game data.</p>
</dd>
</dl>

<a name="StarCitizenAPI"></a>

## StarCitizenAPI
Declarative API interface for Star Citizen Live service.

This interface defines the properties and methods exposed by the
StarCitizen service for programmatic access to game data.

**Kind**: global interface  

* [StarCitizenAPI](#StarCitizenAPI)
    * [.activities](#StarCitizenAPI+activities) ⇒ [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity)
    * [.players](#StarCitizenAPI+players) ⇒ [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer)
    * [.vehicles](#StarCitizenAPI+vehicles) ⇒ [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle)
    * [.kills](#StarCitizenAPI+kills) ⇒ [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill)
    * [.logs](#StarCitizenAPI+logs) ⇒ [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry)
    * [.status](#StarCitizenAPI+status) ⇒ <code>String</code>
    * [.postToDiscord(payload)](#StarCitizenAPI+postToDiscord) ⇒ <code>Promise.&lt;Response&gt;</code>
    * [.announceActivity(activity)](#StarCitizenAPI+announceActivity) ⇒ <code>Promise.&lt;Response&gt;</code>
    * [.screenshot()](#StarCitizenAPI+screenshot) ⇒ <code>Promise.&lt;Buffer&gt;</code>
    * [.start()](#StarCitizenAPI+start) ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
    * [.stop()](#StarCitizenAPI+stop) ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)

<a name="StarCitizenAPI+activities"></a>

### starCitizenAPI.activities ⇒ [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity)
Get all activities.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity) - Array of activities  
<a name="StarCitizenAPI+players"></a>

### starCitizenAPI.players ⇒ [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer)
Get all players.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer) - Array of players  
<a name="StarCitizenAPI+vehicles"></a>

### starCitizenAPI.vehicles ⇒ [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle)
Get all vehicles.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle) - Array of vehicles  
<a name="StarCitizenAPI+kills"></a>

### starCitizenAPI.kills ⇒ [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill)
Get all kills.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill) - Array of kill events  
<a name="StarCitizenAPI+logs"></a>

### starCitizenAPI.logs ⇒ [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry)
Get all log entries.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry) - Array of log entries  
<a name="StarCitizenAPI+status"></a>

### starCitizenAPI.status ⇒ <code>String</code>
Get service status.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>String</code> - Current status ('STOPPED', 'STARTING', 'STARTED', 'STOPPING')  
<a name="StarCitizenAPI+postToDiscord"></a>

### starCitizenAPI.postToDiscord(payload) ⇒ <code>Promise.&lt;Response&gt;</code>
Post a message to Discord via webhook.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - Fetch response  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>Object</code> | Discord webhook payload |
| [payload.embeds] | <code>Array.&lt;Object&gt;</code> | Array of Discord embeds |

<a name="StarCitizenAPI+announceActivity"></a>

### starCitizenAPI.announceActivity(activity) ⇒ <code>Promise.&lt;Response&gt;</code>
Announce an activity to the configured authority.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - Fetch response  

| Param | Type | Description |
| --- | --- | --- |
| activity | [<code>StarCitizenActivity</code>](#StarCitizenActivity) | Activity to announce |

<a name="StarCitizenAPI+screenshot"></a>

### starCitizenAPI.screenshot() ⇒ <code>Promise.&lt;Buffer&gt;</code>
Take a screenshot of the current display.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - Screenshot image buffer  
<a name="StarCitizenAPI+start"></a>

### starCitizenAPI.start() ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
Start the service.
Begins monitoring the game log and starts HTTP server if configured.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI) - Returns this for chaining  
**Emits**: <code>event:ready When service is fully started</code>, <code>event:error If an error occurs during startup</code>  
<a name="StarCitizenAPI+stop"></a>

### starCitizenAPI.stop() ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
Stop the service.
Stops monitoring the game log and stops HTTP server if running.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI) - Returns this for chaining  
**Emits**: <code>event:stopped When service is fully stopped</code>  
<a name="Group"></a>

## Group
**Kind**: global class  

* [Group](#Group)
    * [new Group(data)](#new_Group_new)
    * [.includes()](#Group+includes) ⇒ <code>Boolean</code>
    * [.isSigner()](#Group+isSigner) ⇒ <code>Boolean</code>
    * [.isReader()](#Group+isReader)
    * [.federation()](#Group+federation)
    * [.verifyMultiSignature()](#Group+verifyMultiSignature)

<a name="new_Group_new"></a>

### new Group(data)

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Group data. |

<a name="Group+includes"></a>

### group.includes() ⇒ <code>Boolean</code>
**Kind**: instance method of [<code>Group</code>](#Group)  
**Returns**: <code>Boolean</code> - True when `pubkey` is a member (reader or signer).  
<a name="Group+isSigner"></a>

### group.isSigner() ⇒ <code>Boolean</code>
**Kind**: instance method of [<code>Group</code>](#Group)  
**Returns**: <code>Boolean</code> - True when pubkey is a signing validator.  
<a name="Group+isReader"></a>

### group.isReader()
Member but not a signer.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Group+federation"></a>

### group.federation()
Lazily build the Fabric Federation for the **signer** set.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Group+verifyMultiSignature"></a>

### group.verifyMultiSignature()
Verify a k-of-n multisignature against **signers** + threshold.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Mission"></a>

## Mission ⇐ <code>Entity</code>
Represents a Mission in the Star Citizen universe.
Missions can be accepted by signing with secp256k1 or Musig2 multisig.

**Kind**: global class  
**Extends**: <code>Entity</code>  

* [Mission](#Mission) ⇐ <code>Entity</code>
    * [new Mission(data)](#new_Mission_new)
    * [.meetsRequirements(player)](#Mission+meetsRequirements) ⇒ <code>Boolean</code>
    * [.isExpired()](#Mission+isExpired) ⇒ <code>Boolean</code>
    * [.isOpen()](#Mission+isOpen) ⇒ <code>Boolean</code>
    * [.isMultisig()](#Mission+isMultisig) ⇒ <code>Boolean</code>
    * [.getRequiredSignatures()](#Mission+getRequiredSignatures) ⇒ <code>Number</code>
    * [.hasEnoughSignatures()](#Mission+hasEnoughSignatures) ⇒ <code>Boolean</code>
    * [.generateContractCommitment()](#Mission+generateContractCommitment) ⇒ <code>String</code>
    * [.toJSON()](#Mission+toJSON) ⇒ <code>Object</code>

<a name="new_Mission_new"></a>

### new Mission(data)
Create a Mission instance.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Mission data. |
| data.id | <code>String</code> | Unique mission identifier. |
| data.title | <code>String</code> | Mission title. |
| data.description | <code>String</code> | Mission description. |
| data.type | <code>String</code> | Mission type (e.g., 'bounty', 'cargo', 'exploration'). |
| data.reward | <code>Number</code> | Reward amount in UEC. |
| data.status | <code>String</code> | Mission status ('open', 'assigned', 'completed', 'failed'). |
| data.requirements | <code>Object</code> | Mission requirements. |
| [data.requirements.minReputation] | <code>Number</code> | Minimum reputation required. |
| [data.requirements.skills] | <code>Array.&lt;String&gt;</code> | Required skills. |
| [data.requirements.vehicleType] | <code>String</code> | Required vehicle type. |
| data.location | <code>Object</code> | Mission location. |
| data.location.system | <code>String</code> | Star system. |
| data.location.planet | <code>String</code> | Planet or station. |
| data.contract | <code>Object</code> | Contract configuration. |
| data.contract.type | <code>String</code> | 'single' or 'multisig'. |
| [data.contract.requiredSignatures] | <code>Number</code> | Required signatures for multisig. |
| [data.contract.authorizedSigners] | <code>Array.&lt;String&gt;</code> | Authorized signer public keys. |
| data.issuer | <code>String</code> | Mission issuer ID. |
| [data.assignee] | <code>String</code> | Current assignee ID. |
| data.expiresAt | <code>Number</code> | Expiration timestamp. |
| data.createdAt | <code>Number</code> | Creation timestamp. |

<a name="Mission+meetsRequirements"></a>

### mission.meetsRequirements(player) ⇒ <code>Boolean</code>
Check if a player meets the mission requirements.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether player meets requirements.  

| Param | Type | Description |
| --- | --- | --- |
| player | <code>Object</code> | Player data. |

<a name="Mission+isExpired"></a>

### mission.isExpired() ⇒ <code>Boolean</code>
Check if the mission is expired.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission is expired.  
<a name="Mission+isOpen"></a>

### mission.isOpen() ⇒ <code>Boolean</code>
Check if mission can accept more applications.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission is open for applications.  
<a name="Mission+isMultisig"></a>

### mission.isMultisig() ⇒ <code>Boolean</code>
Check if mission requires multisig.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission requires multiple signatures.  
<a name="Mission+getRequiredSignatures"></a>

### mission.getRequiredSignatures() ⇒ <code>Number</code>
Get required number of signatures.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Number</code> - Required signature count.  
<a name="Mission+hasEnoughSignatures"></a>

### mission.hasEnoughSignatures() ⇒ <code>Boolean</code>
Check if signature threshold is met.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether enough signatures have been collected.  
<a name="Mission+generateContractCommitment"></a>

### mission.generateContractCommitment() ⇒ <code>String</code>
Generate a contract commitment for signing.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>String</code> - Hex-encoded contract hash.  
<a name="Mission+toJSON"></a>

### mission.toJSON() ⇒ <code>Object</code>
Convert mission to JSON.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Object</code> - Mission data.  
<a name="MissionApplication"></a>

## MissionApplication ⇐ <code>Entity</code>
Represents an application to accept a Mission.

**Kind**: global class  
**Extends**: <code>Entity</code>  

* [MissionApplication](#MissionApplication) ⇐ <code>Entity</code>
    * [new MissionApplication(data)](#new_MissionApplication_new)
    * [.isMultisig()](#MissionApplication+isMultisig) ⇒ <code>Boolean</code>
    * [.isApproved()](#MissionApplication+isApproved) ⇒ <code>Boolean</code>
    * [.isPending()](#MissionApplication+isPending) ⇒ <code>Boolean</code>
    * [.approve()](#MissionApplication+approve)
    * [.reject(reason)](#MissionApplication+reject)
    * [.toJSON()](#MissionApplication+toJSON) ⇒ <code>Object</code>

<a name="new_MissionApplication_new"></a>

### new MissionApplication(data)
Create a MissionApplication instance.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Application data. |
| data.missionId | <code>String</code> | Mission ID being applied to. |
| data.applicantId | <code>String</code> | Combined public key (hex). Single secp256k1   or Musig2-aggregated key — same opaque format as any other public key in the   system; not a separate player/handle identity. |
| data.signature | <code>String</code> | Application signature. |
| [data.message] | <code>String</code> | Optional message from applicant. |
| data.status | <code>String</code> | Application status ('pending', 'approved', 'rejected'). |
| [data.multisigData] | <code>Object</code> | Musig2 multisig data if applicable. |
| [data.multisigData.participantKeys] | <code>Array.&lt;String&gt;</code> | Participant public keys. |
| [data.multisigData.aggregatedKey] | <code>String</code> | Aggregated public key. |
| [data.multisigData.nonces] | <code>Array.&lt;Object&gt;</code> | Musig2 nonces. |
| data.createdAt | <code>Number</code> | Application timestamp. |

<a name="MissionApplication+isMultisig"></a>

### missionApplication.isMultisig() ⇒ <code>Boolean</code>
Check if application is for multisig.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether this is a multisig application.  
<a name="MissionApplication+isApproved"></a>

### missionApplication.isApproved() ⇒ <code>Boolean</code>
Check if application is approved.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether application is approved.  
<a name="MissionApplication+isPending"></a>

### missionApplication.isPending() ⇒ <code>Boolean</code>
Check if application is pending.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether application is pending.  
<a name="MissionApplication+approve"></a>

### missionApplication.approve()
Approve the application.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
<a name="MissionApplication+reject"></a>

### missionApplication.reject(reason)
Reject the application.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  

| Param | Type | Description |
| --- | --- | --- |
| reason | <code>String</code> | Rejection reason. |

<a name="MissionApplication+toJSON"></a>

### missionApplication.toJSON() ⇒ <code>Object</code>
Convert application to JSON.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Object</code> - Application data.  
<a name="Store"></a>

## Store
**Kind**: global class  

* [Store](#Store)
    * [new Store([opts])](#new_Store_new)
    * [._fabric](#Store+_fabric) : <code>Object</code> \| <code>null</code>
    * [.fabric](#Store+fabric)
    * [.start()](#Store+start)
    * [.flush()](#Store+flush)
    * [._migrateLegacyJson()](#Store+_migrateLegacyJson)
    * [._takeLegacySettingsJson()](#Store+_takeLegacySettingsJson) ⇒ <code>Object</code> \| <code>null</code>
    * [._loadCollection()](#Store+_loadCollection)
    * [.del()](#Store+del)

<a name="new_Store_new"></a>

### new Store([opts])

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>Object</code> |  |
| [opts.path] | <code>String</code> \| <code>null</code> | LevelDB path for `@fabric/core` Store. |
| [opts.dir] | <code>String</code> \| <code>null</code> | Alias for `path` (legacy register API). |

<a name="Store+_fabric"></a>

### store.\_fabric : <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>Store</code>](#Store)  
<a name="Store+fabric"></a>

### store.fabric
Underlying `@fabric/core` Store (null in memory-only mode or before start).

**Kind**: instance property of [<code>Store</code>](#Store)  
<a name="Store+start"></a>

### store.start()
Open the Fabric Store (if configured) and load collections into memory.
Idempotent — safe when MissionManager and GroupManager share one instance.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+flush"></a>

### store.flush()
Flush pending Fabric writes (also called from stop).

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+_migrateLegacyJson"></a>

### store.\_migrateLegacyJson()
Transitional: import legacy per-collection JSON beside the register dir once.
Not used for steady-state persistence.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+_takeLegacySettingsJson"></a>

### store.\_takeLegacySettingsJson() ⇒ <code>Object</code> \| <code>null</code>
One-time pickup of the pre-Fabric-Store operator `settings.json`.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+_loadCollection"></a>

### store.\_loadCollection()
Load one collection map from Fabric path `/collections/<name>`.
Migrates legacy bare Level keys (`missions`, …) once onto that path.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+del"></a>

### store.del()
Remove one record from a collection. Returns true when it existed.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="ChatManager"></a>

## ChatManager
**Kind**: global class  

* [ChatManager](#ChatManager)
    * [new ChatManager(opts)](#new_ChatManager_new)
    * _instance_
        * [.canAccess()](#ChatManager+canAccess)
        * [.dmPeerOf()](#ChatManager+dmPeerOf)
        * [.channelsFor()](#ChatManager+channelsFor)
        * [.openDm()](#ChatManager+openDm) ⇒ <code>Object</code>
        * [.post(data)](#ChatManager+post)
        * [.ingest()](#ChatManager+ingest) ⇒ <code>Object</code>
        * [.list(channel, [opts])](#ChatManager+list)
    * _static_
        * [.groupIdOf()](#ChatManager.groupIdOf)
        * [.idOf()](#ChatManager.idOf)

<a name="new_ChatManager_new"></a>

### new ChatManager(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>Object</code> |  |
| opts.store | <code>Object</code> | Shared Fabric Store. |
| [opts.groupManager] | <code>Object</code> | For channel membership. |

<a name="ChatManager+canAccess"></a>

### chatManager.canAccess()
May `viewer` read/post this channel? Global: anyone. Group channels:
members only when enforcing (hosted mode); locally the relay is the
player's own node, so their groups are already the visible set.
DM channels: only the two participant pubkeys.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager+dmPeerOf"></a>

### chatManager.dmPeerOf()
Other participant in a DM channel for `viewer`, or null.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager+channelsFor"></a>

### chatManager.channelsFor()
Channels visible to a viewer: global, group channels, plus DM threads
that already have messages involving the viewer.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager+openDm"></a>

### chatManager.openDm() ⇒ <code>Object</code>
Ensure a DM channel descriptor exists in the channel list (even with 0 msgs).

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager+post"></a>

### chatManager.post(data)
Post a message. The id is content-derived so the same message merged
from any path converges. Returns the stored record.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Message fields (`channel`, `body`, `author`, optional `handle` / `ts`). |

<a name="ChatManager+ingest"></a>

### chatManager.ingest() ⇒ <code>Object</code>
Ingest a ChatMessage pushed by a remote relay (signed batch). The signer
must be the author — nobody relays words into someone else's mouth.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager+list"></a>

### chatManager.list(channel, [opts])
Messages in a channel, ascending by ts.

**Kind**: instance method of [<code>ChatManager</code>](#ChatManager)  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel key. |
| [opts] | <code>Object</code> | { since (ISO ts, exclusive), limit } |

<a name="ChatManager.groupIdOf"></a>

### ChatManager.groupIdOf()
`group:<id>` → groupId, or null for non-group channels.

**Kind**: static method of [<code>ChatManager</code>](#ChatManager)  
<a name="ChatManager.idOf"></a>

### ChatManager.idOf()
Deterministic id for a message payload (mirror of post()).

**Kind**: static method of [<code>ChatManager</code>](#ChatManager)  
<a name="FabricNetwork"></a>

## FabricNetwork
**Kind**: global class  

* [FabricNetwork](#FabricNetwork)
    * [new FabricNetwork([settings])](#new_FabricNetwork_new)
    * _instance_
        * [._groupContractIds](#FabricNetwork+_groupContractIds) : <code>Set</code>
        * [.ready](#FabricNetwork+ready)
        * [.messageLog](#FabricNetwork+messageLog)
        * [.setGroupContractKnown(contractId, [known])](#FabricNetwork+setGroupContractKnown)
        * [.setKnownGroupContracts()](#FabricNetwork+setKnownGroupContracts)
        * [.recordMessage(direction, messageOrBuffer, [meta])](#FabricNetwork+recordMessage)
        * [.connectedAddresses()](#FabricNetwork+connectedAddresses)
        * [._signAndRelay(vectorType, body, [opts])](#FabricNetwork+_signAndRelay)
        * [.signContractMessage(contractId, type, object, [opts])](#FabricNetwork+signContractMessage)
        * [.encodeOpaqueMessage(message)](#FabricNetwork+encodeOpaqueMessage) ⇒ <code>Object</code>
        * [._ingestPeeringEvent(ev, kind)](#FabricNetwork+_ingestPeeringEvent)
        * [.fillPeerSlots()](#FabricNetwork+fillPeerSlots) ⇒ <code>number</code>
        * [.maybePublishPeeringOffer([opts])](#FabricNetwork+maybePublishPeeringOffer)
        * [.publishPeeringOffer([opts])](#FabricNetwork+publishPeeringOffer)
        * [.publishGroupContract(definition)](#FabricNetwork+publishGroupContract)
        * [.publishChat(record)](#FabricNetwork+publishChat)
        * [.publishPeerAlias(nickname)](#FabricNetwork+publishPeerAlias)
        * [.publishPeerProfile(profile)](#FabricNetwork+publishPeerProfile)
        * [.publishFleetShare(shareObject)](#FabricNetwork+publishFleetShare)
        * [.publishPeerPresence(presenceObject)](#FabricNetwork+publishPeerPresence)
        * [.publishDirectChat(payload)](#FabricNetwork+publishDirectChat)
        * [.lookupPeerRegistry(address)](#FabricNetwork+lookupPeerRegistry) ⇒ <code>Object</code> \| <code>null</code>
        * [.publishGameStateSnapshot(snapshot, [opts])](#FabricNetwork+publishGameStateSnapshot)
        * [.publishGroupChat(contractId, payload)](#FabricNetwork+publishGroupChat)
        * [.publishGroupChange(contractId, payload)](#FabricNetwork+publishGroupChange)
        * [.publishGroupJournalRequest(contractId, [opts])](#FabricNetwork+publishGroupJournalRequest)
        * [.publishGroupJournalBatch(contractId, batch)](#FabricNetwork+publishGroupJournalBatch)
        * [.publishGroupStateJournal(contractId, tip)](#FabricNetwork+publishGroupStateJournal)
        * [.publishGroupShare(contractId, payload)](#FabricNetwork+publishGroupShare)
        * [.publishGroupActivityTree(contractId, payload)](#FabricNetwork+publishGroupActivityTree)
        * [.publishFederationInvite(contractId, invite)](#FabricNetwork+publishFederationInvite)
        * [.publishFederationInviteResponse(contractId, response)](#FabricNetwork+publishFederationInviteResponse)
    * _static_
        * [.connectionMatchesAddress(connectionId, rosterAddress)](#FabricNetwork.connectionMatchesAddress)

<a name="new_FabricNetwork_new"></a>

### new FabricNetwork([settings])

| Param | Type |
| --- | --- |
| [settings] | <code>Object</code> | 

<a name="FabricNetwork+_groupContractIds"></a>

### fabricNetwork.\_groupContractIds : <code>Set</code>
**Kind**: instance property of [<code>FabricNetwork</code>](#FabricNetwork)  
<a name="FabricNetwork+ready"></a>

### fabricNetwork.ready
Whether the Peer is up and has identity key material.

**Kind**: instance property of [<code>FabricNetwork</code>](#FabricNetwork)  
<a name="FabricNetwork+messageLog"></a>

### fabricNetwork.messageLog
Shared Fabric wire-message ring buffer (advanced UI).

**Kind**: instance property of [<code>FabricNetwork</code>](#FabricNetwork)  
<a name="FabricNetwork+setGroupContractKnown"></a>

### fabricNetwork.setGroupContractKnown(contractId, [known])
Register (or forget) a group Federation contract id for ingest routing.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Default |
| --- | --- | --- |
| contractId | <code>string</code> |  | 
| [known] | <code>boolean</code> | <code>true</code> | 

<a name="FabricNetwork+setKnownGroupContracts"></a>

### fabricNetwork.setKnownGroupContracts()
Replace the known group-contract id set (e.g. after loading groups).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  
<a name="FabricNetwork+recordMessage"></a>

### fabricNetwork.recordMessage(direction, messageOrBuffer, [meta])
Record a Fabric AMP Message (instance or wire buffer) in the advanced log.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| direction | <code>&#x27;in&#x27;</code> \| <code>&#x27;out&#x27;</code> | 
| messageOrBuffer | <code>object</code> \| <code>Buffer</code> | 
| [meta] | <code>Object</code> | 
| [meta.peer] | <code>string</code> \| <code>null</code> | 
| [meta.via] | <code>string</code> \| <code>null</code> | 

<a name="FabricNetwork+connectedAddresses"></a>

### fabricNetwork.connectedAddresses()
Connected Fabric addresses (connection map keys, typically host:port).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  
<a name="FabricNetwork+_signAndRelay"></a>

### fabricNetwork.\_signAndRelay(vectorType, body, [opts])
Sign a Message and optionally relay to peers. Sign-only works with an
unlocked identity even when the peer is not listening yet.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| vectorType | <code>string</code> | 
| body | <code>object</code> \| <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.to] | <code>Array.&lt;string&gt;</code> | 
| [opts.relay] | <code>boolean</code> | 
| [opts.key] | <code>object</code> | 

<a name="FabricNetwork+signContractMessage"></a>

### fabricNetwork.signContractMessage(contractId, type, object, [opts])
Sign a CONTRACT_MESSAGE without requiring peer ready (clipboard / share).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| contractId | <code>string</code> | 
| type | <code>string</code> | 
| object | <code>object</code> | 
| [opts] | <code>Object</code> | 
| [opts.relay] | <code>boolean</code> | 

<a name="FabricNetwork+encodeOpaqueMessage"></a>

### fabricNetwork.encodeOpaqueMessage(message) ⇒ <code>Object</code>
Encode a signed Message as opaque fabric:&lt;hex&gt; for copy-paste.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| message | <code>object</code> | 

<a name="FabricNetwork+_ingestPeeringEvent"></a>

### fabricNetwork.\_ingestPeeringEvent(ev, kind)
Enqueue host:port from offer/gossip and dial open slots.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| ev | <code>Object</code> | 
| [ev.message] | <code>object</code> | 
| kind | <code>&#x27;offer&#x27;</code> \| <code>&#x27;gossip&#x27;</code> | 

<a name="FabricNetwork+fillPeerSlots"></a>

### fabricNetwork.fillPeerSlots() ⇒ <code>number</code>
Dial queued peering candidates into open connection slots.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  
**Returns**: <code>number</code> - remaining candidate count  
<a name="FabricNetwork+maybePublishPeeringOffer"></a>

### fabricNetwork.maybePublishPeeringOffer([opts])
When under capacity and advertise host + opt-in broadcast are set, publish
P2P_PEERING_OFFER so hubs / peers can gossip this node into open slots.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>Object</code> |  |
| [opts.force] | <code>boolean</code> | Skip throttle; still requires advertise host.   When force=true, skips broadcastPeering gate (Announce now). |

<a name="FabricNetwork+publishPeeringOffer"></a>

### fabricNetwork.publishPeeringOffer([opts])
Force one P2P_PEERING_OFFER (Announce now). Requires advertise host.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Default |
| --- | --- | --- |
| [opts] | <code>Object</code> |  | 
| [opts.force] | <code>boolean</code> | <code>true</code> | 

<a name="FabricNetwork+publishGroupContract"></a>

### fabricNetwork.publishGroupContract(definition)
Publish a Group Federation genesis (CONTRACT_PUBLISH).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | From [groupContractDefinition](groupContractDefinition) |

<a name="FabricNetwork+publishChat"></a>

### fabricNetwork.publishChat(record)
Publish a chat record as first-class `P2P_CHAT_MESSAGE` (global only on
the LiveRelay path; group chat uses [#publishGroupChat](#publishGroupChat)).
Wire body = raw UTF-8 message text only (no JSON / handle). Author is AMP signature.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| record | <code>Object</code> | ChatManager record |

<a name="FabricNetwork+publishPeerAlias"></a>

### fabricNetwork.publishPeerAlias(nickname)
Broadcast personal nickname as first-class `P2P_PEER_ALIAS` (UTF-8 body).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| nickname | <code>string</code> | 

<a name="FabricNetwork+publishPeerProfile"></a>

### fabricNetwork.publishPeerProfile(profile)
Broadcast local social profile under the GoonCitizen contract namespace.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| profile | <code>object</code> | from [buildLocalProfile](buildLocalProfile) |

<a name="FabricNetwork+publishFleetShare"></a>

### fabricNetwork.publishFleetShare(shareObject)
Broadcast a personal Starjump fleet under the GoonCitizen contract.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| shareObject | <code>object</code> | from [buildFleetShareObject](buildFleetShareObject) |

<a name="FabricNetwork+publishPeerPresence"></a>

### fabricNetwork.publishPeerPresence(presenceObject)
Broadcast local online presence + current ship under the GoonCitizen contract.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| presenceObject | <code>object</code> | from [buildPresenceShareObject](buildPresenceShareObject) |

<a name="FabricNetwork+publishDirectChat"></a>

### fabricNetwork.publishDirectChat(payload)
Publish a 1:1 DirectChat under the GoonCitizen contract namespace.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>Object</code> | DirectChat fields (`channel`, `peerA`, `peerB`, `author`, `body`, optional `handle` / `ts` / `id`). |

<a name="FabricNetwork+lookupPeerRegistry"></a>

### fabricNetwork.lookupPeerRegistry(address) ⇒ <code>Object</code> \| <code>null</code>
Look up a peer registry entry by Fabric address (best-effort).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 

<a name="FabricNetwork+publishGameStateSnapshot"></a>

### fabricNetwork.publishGameStateSnapshot(snapshot, [opts])
Publish a compact cumulative game-state snapshot for Hub sidechain sync.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>Object</code> | from functions/gooncitizenGameState.buildGameStateSnapshot |
| [opts] | <code>Object</code> | Optional Fabric addresses; omit to broadcast |
| [opts.to] | <code>Array.&lt;string&gt;</code> |  |

<a name="FabricNetwork+publishGroupChat"></a>

### fabricNetwork.publishGroupChat(contractId, payload)
**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> | Group Federation contract id |
| payload | <code>Object</code> | GroupChat object |

<a name="FabricNetwork+publishGroupChange"></a>

### fabricNetwork.publishGroupChange(contractId, payload)
**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| payload | <code>Object</code> | GroupChange object |

<a name="FabricNetwork+publishGroupJournalRequest"></a>

### fabricNetwork.publishGroupJournalRequest(contractId, [opts])
Request missing Statechain journal rows from peers that know this contract.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| contractId | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.fromClock] | <code>number</code> | 
| [opts.groupId] | <code>string</code> | 

<a name="FabricNetwork+publishGroupJournalBatch"></a>

### fabricNetwork.publishGroupJournalBatch(contractId, batch)
Reply with replayable journal entries + tip Schnorr signatures.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| batch | <code>object</code> | GroupJournalBatch body |

<a name="FabricNetwork+publishGroupStateJournal"></a>

### fabricNetwork.publishGroupStateJournal(contractId, tip)
Publish a tip attestation (stateDigest + member Schnorr signatures).

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| tip | <code>object</code> | GroupStateJournal body |

<a name="FabricNetwork+publishGroupShare"></a>

### fabricNetwork.publishGroupShare(contractId, payload)
**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| payload | <code>Object</code> | GroupShare object `{ kind, object, … }` |

<a name="FabricNetwork+publishGroupActivityTree"></a>

### fabricNetwork.publishGroupActivityTree(contractId, payload)
Publish a Merkle activity tree into a Group Contract namespace.

**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| payload | <code>Object</code> | GroupActivityTree body (root, digests, counts, …) |

<a name="FabricNetwork+publishFederationInvite"></a>

### fabricNetwork.publishFederationInvite(contractId, invite)
**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| invite | <code>Object</code> | FederationContractInvite fields/object |

<a name="FabricNetwork+publishFederationInviteResponse"></a>

### fabricNetwork.publishFederationInviteResponse(contractId, response)
**Kind**: instance method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type | Description |
| --- | --- | --- |
| contractId | <code>string</code> |  |
| response | <code>Object</code> | FederationContractInviteResponse fields/object |

<a name="FabricNetwork.connectionMatchesAddress"></a>

### FabricNetwork.connectionMatchesAddress(connectionId, rosterAddress)
True when `connectionId` matches a roster address (exact or host match).

**Kind**: static method of [<code>FabricNetwork</code>](#FabricNetwork)  

| Param | Type |
| --- | --- |
| connectionId | <code>string</code> | 
| rosterAddress | <code>string</code> | 

<a name="MissionManager"></a>

## MissionManager
Mission Manager service.
Handles mission lifecycle, applications, and cryptographic verification.
Supports both single secp256k1 signatures and Musig2 multisig.

**Kind**: global class  

* [MissionManager](#MissionManager)
    * [new MissionManager([settings])](#new_MissionManager_new)
    * [._ensureParticipants()](#MissionManager+_ensureParticipants)
    * [._isJoinable()](#MissionManager+_isJoinable)
    * [.createMission(data)](#MissionManager+createMission) ⇒ [<code>Mission</code>](#Mission)
    * [.ingestRemote(data)](#MissionManager+ingestRemote) ⇒ <code>Object</code>
    * [.ingestApplication()](#MissionManager+ingestApplication)
    * [.ingestApplicationDecision()](#MissionManager+ingestApplicationDecision)
    * [.ingestClaim()](#MissionManager+ingestClaim)
    * [.ingestValidation()](#MissionManager+ingestValidation)
    * [.ingestCancel()](#MissionManager+ingestCancel)
    * [._normalizeAuthorities()](#MissionManager+_normalizeAuthorities)
    * [.getMission(missionId)](#MissionManager+getMission) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
    * [.getMissionApplications(missionId)](#MissionManager+getMissionApplications) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.joinMission(data)](#MissionManager+joinMission) ⇒ <code>Object</code>
    * [.acceptanceMessage(mission, claim)](#MissionManager+acceptanceMessage) ⇒ <code>String</code>
    * [.verifyAcceptance()](#MissionManager+verifyAcceptance) ⇒ <code>Boolean</code>
    * [.submitApplication(applicationData)](#MissionManager+submitApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.verifySignature(message, signature, publicKey, [multisigData])](#MissionManager+verifySignature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.verifySecp256k1Signature(message, signature, publicKey)](#MissionManager+verifySecp256k1Signature) ⇒ <code>Boolean</code>
    * [.verifyMusig2Signature(message, signature, multisigData)](#MissionManager+verifyMusig2Signature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.approveApplication(applicationId)](#MissionManager+approveApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.rejectApplication(applicationId, reason)](#MissionManager+rejectApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.completeMission(missionId, completionData)](#MissionManager+completeMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
    * [.failMission(missionId, reason)](#MissionManager+failMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
    * [.getApplicantApplications(applicantId)](#MissionManager+getApplicantApplications) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)

<a name="new_MissionManager_new"></a>

### new MissionManager([settings])
Create a MissionManager instance.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration settings. |

<a name="MissionManager+_ensureParticipants"></a>

### missionManager.\_ensureParticipants()
Ensure participantIds exists; seed from legacy assigneeId.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+_isJoinable"></a>

### missionManager.\_isJoinable()
Mission still accepts joiners / claims (not terminal).

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+createMission"></a>

### missionManager.createMission(data) ⇒ [<code>Mission</code>](#Mission)
Create a new mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Mission</code>](#Mission) - Created mission.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Mission data. |

<a name="MissionManager+ingestRemote"></a>

### missionManager.ingestRemote(data) ⇒ <code>Object</code>
Upsert a mission received from a peer broadcast. Skips the local officer
allowlist — the remote creator's pubkey is the provenance. Does not
clobber an already-assigned/completed local copy.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Mission snapshot from the wire. |

<a name="MissionManager+ingestApplication"></a>

### missionManager.ingestApplication()
Upsert a remote application (self-authored by the applicant). Idempotent by id.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+ingestApplicationDecision"></a>

### missionManager.ingestApplicationDecision()
Apply a remote officer/authority decision on an application. Idempotent.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+ingestClaim"></a>

### missionManager.ingestClaim()
Upsert a remote completion claim (self-authored by a participant). Idempotent.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+ingestValidation"></a>

### missionManager.ingestValidation()
Apply a remote claim validation. When the mission has an authorities set
and the decision is approve, the k-of-n Schnorr acceptance is re-verified
here (defense in depth) and preserved in the audit authorization. Idempotent.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+ingestCancel"></a>

### missionManager.ingestCancel()
Apply a remote mission cancel. Idempotent.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+_normalizeAuthorities"></a>

### missionManager.\_normalizeAuthorities()
Normalize the authorities field: `{ keys: [pubkey…], threshold }` or null.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+getMission"></a>

### missionManager.getMission(missionId) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
Get a mission by ID.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Mission</code>](#Mission) \| <code>null</code> - Mission instance or null.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+getMissionApplications"></a>

### missionManager.getMissionApplications(missionId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications for a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Mission applications.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+joinMission"></a>

### missionManager.joinMission(data) ⇒ <code>Object</code>
Join a mission as an accepted participant (broadcast Accept / openSignup).
Idempotent when already a participant.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Object</code> - Accepted application record  

| Param | Type |
| --- | --- |
| data | <code>Object</code> | 

<a name="MissionManager+acceptanceMessage"></a>

### missionManager.acceptanceMessage(mission, claim) ⇒ <code>String</code>
Deterministic message the mission's authorities must sign to accept a
completion claim (and release any escrowed payout).

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>String</code> - Canonical acceptance message.  

| Param | Type | Description |
| --- | --- | --- |
| mission | <code>Object</code> | Mission record. |
| claim | <code>Object</code> | Claim record. |

<a name="MissionManager+verifyAcceptance"></a>

### missionManager.verifyAcceptance() ⇒ <code>Boolean</code>
Verify a k-of-n acceptance against the mission's authorities set.
Signers sign `acceptanceMessage(mission, claim)` bytes with BIP340
Schnorr; only authority pubkeys count.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+submitApplication"></a>

### missionManager.submitApplication(applicationData) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Submit an application to accept a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Created application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationData | <code>Object</code> | Application data. |
| applicationData.missionId | <code>String</code> | Mission ID. |
| applicationData.applicantId | <code>String</code> | Combined public key (hex). |
| applicationData.signature | <code>String</code> | Application signature. |
| [applicationData.multisigData] | <code>Object</code> | Musig2 data if applicable. |

<a name="MissionManager+verifySignature"></a>

### missionManager.verifySignature(message, signature, publicKey, [multisigData]) ⇒ <code>Promise.&lt;Boolean&gt;</code>
Verify a signature (single or multisig).

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Promise.&lt;Boolean&gt;</code> - Verification result.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | <code>String</code> |  | Message hash to verify. |
| signature | <code>String</code> |  | Signature to verify. |
| publicKey | <code>String</code> |  | Public key for single sig. |
| [multisigData] | <code>Object</code> | <code></code> | Musig2 data for multisig. |

<a name="MissionManager+verifySecp256k1Signature"></a>

### missionManager.verifySecp256k1Signature(message, signature, publicKey) ⇒ <code>Boolean</code>
Verify a single secp256k1 signature.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Boolean</code> - Verification result.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>String</code> | Message hash. |
| signature | <code>String</code> | Signature hex. |
| publicKey | <code>String</code> | Public key hex. |

<a name="MissionManager+verifyMusig2Signature"></a>

### missionManager.verifyMusig2Signature(message, signature, multisigData) ⇒ <code>Promise.&lt;Boolean&gt;</code>
Verify a Musig2 multisig signature.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Promise.&lt;Boolean&gt;</code> - Verification result.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>String</code> | Message hash. |
| signature | <code>String</code> | Aggregated signature. |
| multisigData | <code>Object</code> | Musig2 data. |

<a name="MissionManager+approveApplication"></a>

### missionManager.approveApplication(applicationId) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Approve an application.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Approved application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationId | <code>String</code> | Application ID. |

<a name="MissionManager+rejectApplication"></a>

### missionManager.rejectApplication(applicationId, reason) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Reject an application.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Rejected application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationId | <code>String</code> | Application ID. |
| reason | <code>String</code> | Rejection reason. |

<a name="MissionManager+completeMission"></a>

### missionManager.completeMission(missionId, completionData) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
Complete a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;Mission&gt;</code>](#Mission) - Completed mission.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |
| completionData | <code>Object</code> | Completion data. |

<a name="MissionManager+failMission"></a>

### missionManager.failMission(missionId, reason) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
Fail a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;Mission&gt;</code>](#Mission) - Failed mission.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |
| reason | <code>String</code> | Failure reason. |

<a name="MissionManager+getApplicantApplications"></a>

### missionManager.getApplicantApplications(applicantId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications by applicant.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Applicant's applications.  

| Param | Type | Description |
| --- | --- | --- |
| applicantId | <code>String</code> | Combined public key (hex). |

<a name="SnapshotManager"></a>

## SnapshotManager
**Kind**: global class  

* [SnapshotManager](#SnapshotManager)
    * [new SnapshotManager(opts)](#new_SnapshotManager_new)
    * [.active](#SnapshotManager+active)
    * [.setCapture()](#SnapshotManager+setCapture)
    * [.configure()](#SnapshotManager+configure)
    * [.snap()](#SnapshotManager+snap)
    * [.list()](#SnapshotManager+list)
    * [.stats()](#SnapshotManager+stats)
    * [.imagePath()](#SnapshotManager+imagePath)
    * [.purge()](#SnapshotManager+purge) ⇒ <code>Number</code>
    * [.purgeAll()](#SnapshotManager+purgeAll)

<a name="new_SnapshotManager_new"></a>

### new SnapshotManager(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>Object</code> |  |
| opts.store | <code>Object</code> | Shared Fabric Store. |
| opts.dir | <code>String</code> \| <code>null</code> | Directory for image files (null = disabled). |
| [opts.capture] | <code>function</code> | async () => { buffer, width, height }. |

<a name="SnapshotManager+active"></a>

### snapshotManager.active
True when snapshots can actually be taken right now.

**Kind**: instance property of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+setCapture"></a>

### snapshotManager.setCapture()
Provide (or clear) the platform capture function; re-evaluates the timer.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+configure"></a>

### snapshotManager.configure()
Apply configuration (from operator settings). Values are clamped;
missing keys keep their current value.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+snap"></a>

### snapshotManager.snap()
Take one snapshot now: capture → write JPEG → record metadata → purge.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+list"></a>

### snapshotManager.list()
Snapshot metadata, newest first.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+stats"></a>

### snapshotManager.stats()
Aggregate stats for the settings/library UI.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+imagePath"></a>

### snapshotManager.imagePath()
Absolute path for a snapshot's image file, or null.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="SnapshotManager+purge"></a>

### snapshotManager.purge() ⇒ <code>Number</code>
Auto-purge: delete oldest snapshots until total size fits the disk cap.

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
**Returns**: <code>Number</code> - How many snapshots were removed.  
<a name="SnapshotManager+purgeAll"></a>

### snapshotManager.purgeAll()
Delete every snapshot (Library "Clear all").

**Kind**: instance method of [<code>SnapshotManager</code>](#SnapshotManager)  
<a name="StarCitizen"></a>

## StarCitizen ⇐ <code>Hub</code>
Core service for Star Citizen.
Provides a Fabric-compatible declarative API with Discord integration.

**Kind**: global class  
**Extends**: <code>Hub</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| activities | <code>Array</code> | Collection of activities from the game log. |
| players | <code>Array</code> | Collection of known players. |
| vehicles | <code>Array</code> | Collection of known vehicles. |
| logs | <code>Array</code> | Collection of log entries. |
| kills | <code>Array</code> | Collection of kill events. |
| discord | <code>Object</code> | Discord integration instance. |


* [StarCitizen](#StarCitizen) ⇐ <code>Hub</code>
    * [new StarCitizen([settings])](#new_StarCitizen_new)
    * [.postToDiscord(payload)](#StarCitizen+postToDiscord) ⇒ <code>Promise.&lt;Response&gt;</code>
    * [.getUIConfig()](#StarCitizen+getUIConfig) ⇒ <code>Object</code> \| <code>null</code>

<a name="new_StarCitizen_new"></a>

### new StarCitizen([settings])
Create an instance of the Star Citizen service.

**Returns**: [<code>StarCitizen</code>](#StarCitizen) - A new instance of the Star Citizen service.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Configuration for this instance. |
| [settings.logfile] | <code>Object</code> | <code>C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log</code> | Path to the log file for Star Citizen. |
| [settings.discord] | <code>Object</code> |  | Discord configuration. |
| [settings.discord.webhook] | <code>String</code> |  | Discord webhook URL for posting updates. |
| [settings.discord.channel] | <code>String</code> |  | Discord channel ID for posting updates. |
| [settings.discord.enable] | <code>Boolean</code> | <code>false</code> | Enable Discord integration. |

<a name="StarCitizen+postToDiscord"></a>

### starCitizen.postToDiscord(payload) ⇒ <code>Promise.&lt;Response&gt;</code>
Post a message to Discord via webhook.

**Kind**: instance method of [<code>StarCitizen</code>](#StarCitizen)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - The fetch response.  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>Object</code> | The Discord webhook payload. |

<a name="StarCitizen+getUIConfig"></a>

### starCitizen.getUIConfig() ⇒ <code>Object</code> \| <code>null</code>
Get UI component configuration for Sensemaker integration.
Services can override this method to declare their UI components.

**Kind**: instance method of [<code>StarCitizen</code>](#StarCitizen)  
**Returns**: <code>Object</code> \| <code>null</code> - UI component configuration or null  
<a name="crypto"></a>

## crypto
Group — a member-created unit backed by a k-of-n Schnorr multisig of **signers**.

`members` = all participants (readers + signers).
`validators` = signing federation (proposedPolicy.validators); tip / wallet / threshold.
Read-only members are in `members` but not `validators`.

**Kind**: global constant  
<a name="fs"></a>

## fs
Store — keyed-collection persistence for the mission register + groups.

Composes `@fabric/core` [Store](#Store) (`this.fabric`). Named collections are
stored at Fabric paths `/collections/<name>` via `fabric.set` / `fabric.get`
(not raw Level key blobs). The sync façade (`get` / `put` / `all` / `count` /
`del`) keeps MissionManager / GroupManager simple.

Data lives under the named store root `stores/gooncitizen/` (Hub-style);
the register LevelDB is `stores/gooncitizen/register`.

Call `await store.start()` before reads that must see prior sessions, and
`await store.stop()` on shutdown so pending writes flush.

Memory-only when `path` is null (tests) — no Fabric Store is constructed.

**Kind**: global constant  
<a name="crypto"></a>

## crypto
ChatManager — org chat brought forward from the Hub, on the Fabric Store.

Message types follow hub.fabric.pub conventions:
  - stored records are `@type: 'ChatMessage'`
  - `global` rides Fabric `P2P_CHAT_MESSAGE` (D-010)
  - `group:<groupId>` rides `GroupChat` under that Group's Federation
    `CONTRACT_MESSAGE` namespace (Groups-as-Federations)

Channels:
  - `global`            — network chat on this node (all local viewers)
  - `group:<groupId>`   — dedicated channel per group / subgroup, members
                          only in hosted mode (the local relay shows your groups)

Ids are content-derived (channel + author + body + ts), so merging the
same message from multiple paths (local post, peer push, peer pull) is
idempotent — the same convergence rule as the event uplink.

**Kind**: global constant  
<a name="DIRECT_CHAT_TYPE"></a>

## DIRECT\_CHAT\_TYPE
GoonCitizen CONTRACT_MESSAGE body type for 1:1 chat (mesh).

**Kind**: global constant  
<a name="EventEmitter"></a>

## EventEmitter
FabricNetwork — local `@fabric/core` Peer for GoonCitizen peering.

Wire Messages:
  - P2P_CHAT_MESSAGE     — network-wide `global` chat (Peer auto-relays)
  - CONTRACT_MESSAGE     — GoonCitizen app types + per-Group Federation types
  - CONTRACT_PUBLISH     — GoonCitizen genesis + per-Group Federation genesis

Lazy-requires Peer/Message so memory-only unit tests stay light.

**Kind**: global constant  
<a name="DEFAULT_SEED"></a>

## ~~DEFAULT\_SEED~~
***Prefer DEFAULT_SEEDS — first network hub seed.***

**Kind**: global constant  
<a name="DEFAULT_MAX_PEERS"></a>

## DEFAULT\_MAX\_PEERS
Default TCP peer cap (matches @fabric/core MAX_PEERS soft default for slot fill).

**Kind**: global constant  
<a name="APP_RELAY_TYPES"></a>

## APP\_RELAY\_TYPES
App `type` values under the GoonCitizen CONTRACT_MESSAGE namespace (core catalog + local).

**Kind**: global constant  
<a name="_dnsOwnHostCache"></a>

## \_dnsOwnHostCache : <code>Map.&lt;string, boolean&gt;</code>
**Kind**: global constant  
<a name="crypto"></a>

## crypto
GroupManager — member-created groups with k-of-n Schnorr multisig,
optional nested subgroups (`parentId`), public/private visibility,
custom page slugs, and join applications.

Groups are the sharing boundary across many GoonCitizen installations
on the Fabric mesh (not a single global "org").

Group pages live at `/groups/:id` (or `/groups/:slug` when a custom slug
is set). Public groups can be shared; visitors apply to join; the creator
accepts or rejects. Private groups are members-only.

Persistence: uses `types/Store.js` (composes `@fabric/core` Store;
`/collections/*` paths) under
`stores/gooncitizen/register` (Hub-style named store root).

**Kind**: global constant  
<a name="http"></a>

## http
Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).

Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
events, fs, readline) plus global fetch (identity/group crypto loads lazily).
This file is the SERVICE DEFINITION only — the server entry that boots it
from the environment is `scripts/node.js` (`npm start`).

Features: in-memory collections, REST endpoints, live log tailing (read-only,
optional) AND offline replay, real Game.log event parsing (functions/parser.js),
optional Discord webhook posting, and the mission/contract seam.

It edits NOTHING in the Star Citizen installation - the log is only ever read.

**Kind**: global constant  
<a name="crypto"></a>

## crypto
MissionManager — the org mission register (M5.1).

Implements D-005: a centralized, OFFICER-VALIDATED register. Lifecycle:
  open --apply--> (applications) --officer accept / joinMission--> assigned
       (many accepted participants; mission stays open for more joins)
       --claim(any participant)--> pending claims
       --authorities approve ONE claim--> completed (+ other pending → superseded)
       --authorities reject claim--> mission stays assigned (re-claim allowed)
  open|assigned --officer cancel--> cancelled

Claims may be individual or name a completionGroupId (group wallet payee).

Every mutation appends a hash-chained AuditEntry (tamper-evident; M6 adds
officer signatures over each entry). Backed by types/Store.js (in-memory
or `@fabric/core` Store / LevelDB under `stores/` when a path is configured).
Keeps the method names/events the rest of the code already uses
(createMission/getMission/missions, start/stop) so nothing else breaks.

Officer model: settings.officers is an allowlist of actor ids. If EMPTY, the
register runs in permissive "bootstrap" mode (everyone is an officer) so it is
usable before roles are wired (REST/Discord auth lands in M5.2/M5.3).

Optional `settings.isGroupMember(groupId, pubkey)` gates completionGroupId.

**Kind**: global constant  
<a name="EventEmitter"></a>

## EventEmitter
PayoutManager — Bitcoin-unlocked mission rewards.

A mission's reward can be escrowed on-chain in a k-of-n multisig address
built from the mission's AUTHORITY pubkeys (the same keys whose Schnorr
signatures accept the completion claim). Flow:

  1. createEscrow(mission)   -> k-of-n P2WSH address (bitcoind createmultisig)
  2. (creator funds address) -> checkFunding() confirms via scantxoutset
  3. claim accepted (k-of-n Schnorr on the acceptance message, MissionManager)
     -> 'payout:unlocked' -> escrow status 'payable'
  4. buildPayout()           -> PSBT paying the claimant (authorities sign
                                with their own wallets — keys never touch
                                the server)
  5. broadcastPayout(hex)    -> sendrawtransaction

Modes:
  - LEDGER (no rpc): the obligation + authorization are recorded and
    auditable; settlement happens out-of-band.
  - BITCOIN (rpc provided): full on-chain flow. Mainnet is refused unless
    `allowMainnet: true` — regtest/signet first, by decision.

`rpc` is any `(method, params) => Promise<result>` — on goon.vc it wraps
the Hub's managed bitcoind (`@fabric/core` Bitcoin `_makeRPCRequest`).

**Kind**: global constant  
<a name="fs"></a>

## fs
SnapshotManager — periodic screen snapshots of player activity.

Captures a reduced-size JPEG on a configurable interval (default 10 s,
opt-in) so a future image analyzer can parse gameplay the log does not
cover. Image files live under the named Fabric store root
(`stores/gooncitizen/snapshots/`); metadata records live in the shared
Fabric Store `snapshots` collection ({ id, ts, file, bytes, width,
height }). Auto-purge deletes the oldest snapshots once the library
exceeds a disk cap, keeping requirements low.

The capture function is injected by the host (Electron main uses
`screenshot-desktop` + `nativeImage` downscaling); without one — pure
browser/server sessions — the manager stays idle.

**Kind**: global constant  
<a name="dmChannelKey"></a>

## dmChannelKey()
Deterministic DM channel key for two Fabric pubkeys.

**Kind**: global function  
<a name="parseDmChannel"></a>

## parseDmChannel()
Parse `dm:<pkA>:<pkB>` → `{ a, b }` or null.

**Kind**: global function  
<a name="isNetworkHubAddress"></a>

## isNetworkHubAddress()
True when address is a known network hub seed (selective Fabric relays).

**Kind**: global function  
<a name="isLoopbackFabricAddress"></a>

## isLoopbackFabricAddress(address) ⇒ <code>boolean</code>
True when address uses a loopback host (localhost / 127.0.0.1 / ::1).
Local star-topology tests dial `127.0.0.1:otherPort` on purpose; only
[isSelfFabricAddress](#isSelfFabricAddress) must be excluded from the dial list.

**Kind**: global function  

| Param | Type |
| --- | --- |
| address | <code>\*</code> | 

<a name="collectOwnFabricHosts"></a>

## collectOwnFabricHosts([opts]) ⇒ <code>Set.&lt;string&gt;</code>
Hostnames / IPs that identify this node for dial filtering.
Includes advertiseHost, optional ownHosts, FABRIC_* env public host, and
(by default) addresses from os.networkInterfaces().

**Kind**: global function  

| Param | Type | Default |
| --- | --- | --- |
| [opts] | <code>Object</code> |  | 
| [opts.advertiseHost] | <code>string</code> |  | 
| [opts.ownHosts] | <code>Array.&lt;string&gt;</code> |  | 
| [opts.includeLocalInterfaces] | <code>boolean</code> | <code>true</code> | 
| [opts.env] | <code>NodeJS.ProcessEnv</code> |  | 

<a name="hostnameResolvesToOwn"></a>

## hostnameResolvesToOwn(host, ownHosts) ⇒ <code>boolean</code>
True when `host` is not an IP literal and DNS resolves it to a local interface.
Cached; failures cache as false for this process.

**Kind**: global function  

| Param | Type |
| --- | --- |
| host | <code>string</code> | 
| ownHosts | <code>Set.&lt;string&gt;</code> | 

<a name="isSelfFabricAddress"></a>

## isSelfFabricAddress(address, [listenPortOrOpts], [opts]) ⇒ <code>boolean</code>
True when dialing this address would connect to this process (self-loop).
Covers loopback+listenPort, public advertise/env hostnames, local interface
IPs, and (when interfaces are available) hub hostnames that DNS to self.

**Kind**: global function  

| Param | Type | Default |
| --- | --- | --- |
| address | <code>\*</code> |  | 
| [listenPortOrOpts] | <code>number</code> \| <code>string</code> \| <code>Object</code> |  | 
| [opts] | <code>Object</code> |  | 
| [opts.listenPort] | <code>number</code> \| <code>string</code> |  | 
| [opts.advertiseHost] | <code>string</code> |  | 
| [opts.ownHosts] | <code>Array.&lt;string&gt;</code> |  | 
| [opts.includeLocalInterfaces] | <code>boolean</code> |  | 
| [opts.resolveDns] | <code>boolean</code> | <code>true</code> | 

<a name="isFabricAddress"></a>

## isFabricAddress(value) ⇒ <code>boolean</code>
True when `value` looks like a Fabric peer address (`host:port`).

**Kind**: global function  

| Param | Type |
| --- | --- |
| value | <code>\*</code> | 

<a name="normalizeFabricAddress"></a>

## normalizeFabricAddress(value, [opts]) ⇒ <code>string</code> \| <code>null</code>
Normalize operator input to `host:port`. Rejects bare http(s) URLs for new
peers; migrates legacy `https://host[/…]` → `host:7777` when `migrate` is set.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>\*</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.migrate] | <code>boolean</code> | Migrate legacy `https://host` → `host:7777` |

<a name="attachAppHandlers"></a>

## attachAppHandlers(peer, handlers, [opts])
Subscribe app handlers to a Fabric Peer using its native message events.

Namespaces:
  - GoonCitizen contract id → MissionCreated / MissionBroadcast / SCEventBatch
  - Group Federation contracts → GroupChat / GroupChange / GroupShare / invites
    (by typed app message, and/or `handlers.isKnownGroupContract(id)`)

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| peer | <code>Object</code> | Fabric Peer instance |
| handlers | <code>Object</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.relay] | <code>boolean</code> |  |

<a name="StarCitizenActivity"></a>

## StarCitizenActivity : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the activity |
| type | <code>String</code> | Type of activity (e.g., 'StarCitizenLogEntry', 'MissionComplete') |
| actor | <code>Object</code> | The actor performing the activity |
| actor.id | <code>String</code> | Actor ID |
| [actor.name] | <code>String</code> | Actor name |
| object | <code>Object</code> | The object of the activity |
| object.id | <code>String</code> | Object ID |
| [object.content] | <code>String</code> | Object content |
| target | <code>String</code> | Target path of the activity |
| timestamp | <code>String</code> | ISO timestamp of the activity |

<a name="StarCitizenPlayer"></a>

## StarCitizenPlayer : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the player |
| name | <code>String</code> | Player name |
| timestamp | <code>String</code> | ISO timestamp when player was registered |
| [metadata] | <code>Object</code> | Additional player metadata |

<a name="StarCitizenVehicle"></a>

## StarCitizenVehicle : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the vehicle |
| name | <code>String</code> | Vehicle name |
| [type] | <code>String</code> | Vehicle type (e.g., 'fighter', 'transport') |
| [owner] | <code>String</code> | Owner player ID |
| timestamp | <code>String</code> | ISO timestamp when vehicle was registered |

<a name="StarCitizenKill"></a>

## StarCitizenKill : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the kill event |
| killer | <code>String</code> | Name or ID of the killer |
| victim | <code>String</code> | Name or ID of the victim |
| [weapon] | <code>String</code> | Weapon used for the kill |
| timestamp | <code>String</code> | ISO timestamp of the kill event |

<a name="StarCitizenLogEntry"></a>

## StarCitizenLogEntry : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the log entry |
| timestamp | <code>String</code> | Timestamp from the log file |
| parts | <code>Array.&lt;String&gt;</code> | Parsed parts of the log entry |
| [content] | <code>String</code> | Raw log content |

<a name="DiscordConfig"></a>

## DiscordConfig : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| enable | <code>Boolean</code> | Whether Discord integration is enabled |
| [webhook] | <code>String</code> | Discord webhook URL |
| [channel] | <code>String</code> | Discord channel ID |
| announceActivities | <code>Boolean</code> | Whether to announce activities to Discord |
| announceKills | <code>Boolean</code> | Whether to announce kills to Discord |
| announcePlayerJoins | <code>Boolean</code> | Whether to announce player joins to Discord |

<a name="StarCitizenSettings"></a>

## StarCitizenSettings : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| [name] | <code>String</code> | Service name |
| [authority] | <code>String</code> | Authority URL for announcements |
| [logfile] | <code>String</code> | Path to Star Citizen game log file |
| [http] | <code>Object</code> | HTTP server configuration |
| [http.enable] | <code>Boolean</code> | Whether to enable HTTP server |
| [http.port] | <code>Number</code> | HTTP server port |
| [discord] | [<code>DiscordConfig</code>](#DiscordConfig) | Discord integration configuration |

